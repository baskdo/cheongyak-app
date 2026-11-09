import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { ReportData, ReportSite } from '@/lib/reportTypes'
import { reportToText } from '@/lib/reportText'
import { loadActiveWatch, deactivateWatch } from '@/lib/notifyWatch'

// 청약결과 텔레그램 알림 — "청약홈에 결과가 뜨는 순간" 보내기
//
//   GET /api/notify-check?key=CRON_SECRET
//   (외부 스케줄러가 19:25~20:45 KST 사이 1분 간격으로 호출)
//
// 동작:
//   1) 감시 목록 — 우선순위: ?detail=&compare= 파라미터 > 화면에서 예약한 notify_watch(DB) > NOTIFY_WATCH 환경변수
//   2) 단지별 "단계(stage)"가 이전 전송 기록보다 진행됐으면(없음→특공, 특공→1순위, 1순위→2순위) 텔레그램 전송
//   3) 전송 기록은 Neon 테이블 notify_sent 에 저장 → 같은 단계는 두 번 보내지 않음
//
// 필요한 환경변수 (Vercel → Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN  : BotFather가 준 토큰
//   TELEGRAM_CHAT_ID    : 받을 채팅 ID (개인 또는 그룹)
//   CRON_SECRET         : 외부 호출 인증키 (아무 문자열)
//   NOTIFY_WATCH        : 감시 단지. 예) "detail=2026000530,2026000532;compare=2026000124"
//                         (/report 페이지 주소의 detail=…&compare=… 부분을 ; 로 이어 붙이면 됨)
//   DATABASE_URL        : 이미 설정됨
//
// Hobby 플랜 10초 제한: report-data 호출(최대 8단지) + 텔레그램 1건. 보통 3~5초.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 10

const STAGE_ORDER: Record<string, number> = { before: 0, spsply: 1, rank1: 2, rank2: 3, final: 3 }


function originOf(request: Request): string {
  const h = request.headers
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || (host && host.startsWith('localhost') ? 'http' : 'https')
  if (host) return `${proto}://${host}`
  return new URL(request.url).origin
}

function parseWatch(raw: string): { detail: string[]; compare: string[] } {
  const out = { detail: [] as string[], compare: [] as string[] }
  for (const part of (raw || '').split(/[;&]/)) {
    const m = part.trim().match(/^(detail|compare)=(.*)$/)
    if (!m) continue
    const list = m[2].split(',').map((s) => s.trim()).filter((s) => /^\d{6,12}$/.test(s))
    out[m[1] as 'detail' | 'compare'].push(...list)
  }
  return out
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // 인증
  const secret = process.env.CRON_SECRET
  const given = searchParams.get('key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!secret || given !== secret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || ''
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  const dbUrl = process.env.DATABASE_URL || ''
  const dryRun = searchParams.get('dry') === '1' // 전송·기록 없이 판정만
  const force = searchParams.get('force') === '1' // 기록 무시하고 무조건 전송 (테스트용)

  // 감시 목록: 파라미터 > 화면 예약(DB) > 환경변수
  let watch: { detail: string[]; compare: string[] }
  let watchId: number | null = null
  let watchSource: 'param' | 'db' | 'env' = 'env'
  if (searchParams.get('detail') || searchParams.get('compare')) {
    watch = { detail: (searchParams.get('detail') || '').split(',').filter(Boolean), compare: (searchParams.get('compare') || '').split(',').filter(Boolean) }
    watchSource = 'param'
  } else {
    const reserved = dbUrl ? await loadActiveWatch().catch(() => null) : null
    if (reserved) {
      watch = { detail: reserved.detail, compare: reserved.compare }
      watchId = reserved.id
      watchSource = 'db'
    } else {
      watch = parseWatch(process.env.NOTIFY_WATCH || '')
    }
  }
  if (watch.detail.length === 0 && watch.compare.length === 0) {
    return NextResponse.json({ ok: false, error: '감시 단지 없음 — 접수현황 화면 [보고서 구성]에서 알림 예약을 하거나 NOTIFY_WATCH 를 설정하세요' })
  }

  // 1) 데이터 조회
  const q = new URLSearchParams()
  if (watch.detail.length) q.set('detail', watch.detail.join(','))
  if (watch.compare.length) q.set('compare', watch.compare.join(','))
  let data: ReportData | null = null
  try {
    const res = await fetch(`${originOf(request)}/api/report-data?${q.toString()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    data = (await res.json()) as ReportData
  } catch (e) {
    return NextResponse.json({ ok: false, error: `report-data 실패: ${String(e)}` })
  }
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.error || 'report-data 실패' })

  // 2) 전송 기록 조회 (pblancNo → 마지막 전송 stage)
  const sql = dbUrl ? neon(dbUrl) : null
  const sent = new Map<string, string>()
  if (sql) {
    try {
      await sql`CREATE TABLE IF NOT EXISTS notify_sent (pblanc_no text PRIMARY KEY, stage text NOT NULL, sent_at timestamptz DEFAULT now())`
      const rows = (await sql`SELECT pblanc_no, stage FROM notify_sent`) as Array<{ pblanc_no: string; stage: string }>
      for (const r of rows) sent.set(r.pblanc_no, r.stage)
    } catch (e) {
      console.error('[notify-check] DB read fail', e)
    }
  }

  // 3) 진행된 단지 판정 — 세부조회 단지만 알림 대상 (비교단지는 본문에 같이 실림)
  // 도배 상한: 한 번에 세부 3개 단지까지만 (예약 화면도 같은 제한)
  const sites: ReportSite[] = (data.detail.length > 0 ? data.detail : data.compare).slice(0, 3)
  const advanced = sites.filter((s) => {
    if (s.stage === 'before') return false
    if (force) return true
    const prev = sent.get(s.pblancNo) || 'before'
    return (STAGE_ORDER[s.stage] ?? 0) > (STAGE_ORDER[prev] ?? 0)
  })

  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    watchSource,
    sites: sites.map((s) => ({ pblancNo: s.pblancNo, name: s.houseName, stage: s.stage, prevSent: sent.get(s.pblancNo) || null })),
    advanced: advanced.map((s) => s.pblancNo),
    sent: false as boolean | string,
  }
  if (advanced.length === 0 || dryRun) return NextResponse.json(result)

  // 4) 텔레그램 전송 — 보고서 전체 텍스트 + 링크
  const reportLink = `${originOf(request)}/report?${q.toString()}`
  const text = `${reportToText(data.detail, data.compare)}\n\n📄 ${reportLink}`.slice(0, 3900)
  if (!token || !chatId) {
    return NextResponse.json({ ...result, sent: 'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 미설정', preview: text })
  }
  const ok = await sendTelegram(token, chatId, text)

  // 5) 기록 (+ 모든 세부 단지가 2순위까지 발송됐으면 예약 자동 종료)
  if (ok && sql) {
    try {
      for (const s of advanced) {
        await sql`INSERT INTO notify_sent (pblanc_no, stage, sent_at) VALUES (${s.pblancNo}, ${s.stage}, now())
                  ON CONFLICT (pblanc_no) DO UPDATE SET stage = EXCLUDED.stage, sent_at = now()`
        sent.set(s.pblancNo, s.stage)
      }
      if (watchId !== null && sites.every((s) => (STAGE_ORDER[sent.get(s.pblancNo) || 'before'] ?? 0) >= 3)) {
        await deactivateWatch(watchId)
      }
    } catch (e) {
      console.error('[notify-check] DB write fail', e)
    }
  }
  return NextResponse.json({ ...result, sent: ok ? true : '텔레그램 전송 실패 (토큰/채팅ID 확인)' })
}
