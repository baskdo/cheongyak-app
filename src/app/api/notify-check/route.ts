import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { ReportData, ReportSite } from '@/lib/reportTypes'
import { saveSnapshot } from '@/lib/reportSnapshot'
import { defaultTitle } from '@/lib/reportImage'
import { reportToText } from '@/lib/reportText'
import { loadActiveWatches, deactivateWatch } from '@/lib/notifyWatch'
import { kstMinutesOfDay } from '@/lib/announceWindow'

// 청약결과 텔레그램 알림 — "청약홈에 결과가 뜨는 순간" 보내기
//
//   GET /api/notify-check?key=CRON_SECRET          (cron-job.org 가 19:29~19:59 KST 1분 간격 호출)
//   &dry=1   전송·기록 없이 판정만
//   &force=1 기록 무시하고 무조건 전송 (테스트용)
//
// 동작:
//   1) 감시 목록 — ?detail=&compare= 파라미터 > 화면에서 예약한 notify_watch(DB, 여러 건) > NOTIFY_WATCH 환경변수
//      예약은 여러 건이 동시에 켜져 있고, 같은 날 저녁 발표가 겹치면 "예약 접수 순서(id 오름차순)"대로 한 건씩 보낸다.
//   2) 예약별로 단지 "단계(stage)"가 지난 발송보다 진행됐고, 접수 숫자가 실제로 들어왔을 때만 보낸다.
//   3) 발송 기록은 notify_sent_v2 (예약id + 단지) — 같은 단지가 여러 예약에 있어도 예약마다 따로 받는다.
//
// 숫자 확인(0건 발송 방지) 규칙:
//   - 단계는 날짜 기준으로 넘어가지만, 19:30 직후엔 접속 폭주로 반영 전(0건) 화면이 올 수 있다 → 숫자 > 0 일 때만 발송
//   - 19:30~19:40: 0건이면 같은 실행 안에서 8초 간격 재조회 (시작 후 40초까지)
//   - 19:35 이후: 청약홈 조회가 정상인데도 그날 단계가 계속 0건이면 "실제 0건"으로 확정해 발송 (표시 붙임)
//   - 19:50 이후: 청약홈 조회 실패가 이어져도 그대로 1회 발송 (안전밸브)
//   - 0건으로 나간 단계에 숫자가 들어오면 [정정] 1회 재발송
//   - 다음 분 실행과 겹쳐도 같은 보고가 두 번 가지 않게 발송 직전에 잠금(비교 후 교체)
//
// 필요한 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CRON_SECRET, DATABASE_URL, (선택) NOTIFY_WATCH
// 함수 제한 60초(maxDuration). 평소 3~5초, 발표 직후 재시도 시 최대 약 40초 + 발송.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60   // Hobby 플랜 최대 60초 (기본 10초)

const STAGE_ORDER: Record<string, number> = { before: 0, spsply: 1, rank1: 2, rank2: 3, final: 3 }

// 시각 기준 (KST, 하루 중 분)
const RETRY_FROM = 19 * 60 + 30   // 같은 실행 안 재시도 시작 (cron은 19:29부터 돌지만 발표 전이라 재시도 의미 없음)
const RETRY_TO = 19 * 60 + 40     // 재시도 끝
const ZERO_CONFIRM_FROM = 19 * 60 + 35 // 이때까지 청약홈 정상 조회인데 0건이면 실제 0건으로 확정
const VALVE_FROM = 19 * 60 + 50   // 안전밸브: 조회 실패가 이어져도 그대로 1회 발송
const RETRY_GAP_MS = 8000         // 재조회 간격
const RETRY_BUDGET_MS = 40000     // 실행 시작 후 이 시간이 지나면 재시도 중단 (다음 분 실행과 겹치지 않게)
const SEND_BUDGET_MS = 45000      // 이 시간이 지나면 남은 예약은 다음 분 실행으로 넘김 (기록하지 않으므로 누락 없음)
const SITES_PER_WATCH = 3         // 예약 1건당 세부 단지 상한 (예약 화면과 같은 제한)
const SITES_PER_QUERY = 8         // report-data 1회 조회 상한

type Watch = { id: number; title: string; detail: string[]; compare: string[] }   // id 0 = 파라미터/환경변수
type SentRec = { stage: string; ready: boolean; snapshotId: string | null; imageSent: boolean }

function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// 숫자가 실제로 들어왔는가 (단계는 날짜로도 넘어가므로 숫자로 다시 확인)
function stageDataReady(s: ReportSite): boolean {
  const t = s.totals
  if (s.stage === 'spsply') return t.spsplyApplied > 0
  if (s.stage === 'rank1') return t.rank1Applied > 0
  if (s.stage === 'rank2') return t.rank2Applied > 0
  if (s.stage === 'final') return t.rank1Applied > 0 || t.rank2Applied > 0
  return false
}

// 실제 0건 확정 — 그 단계 접수일이 오늘이고, 19:35가 지났고, 청약홈에서 정상으로 받아온 값인데도 0건
function zeroConfirmed(s: ReportSite, nowMin: number): boolean {
  if (nowMin < ZERO_CONFIRM_FROM) return false
  const today = todayKST()
  if (s.stage === 'spsply') return s.dates.spsply === today && s.source.spsply === 'applyhome'
  if (s.stage === 'rank1') return s.dates.rank1 === today && s.source.rank === 'applyhome'
  if (s.stage === 'rank2') return s.dates.rank2 === today && s.source.rank === 'applyhome'
  return false
}

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
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}

// 보고서 이미지 — 파일을 올리지 않고 주소만 넘기면 텔레그램 서버가 가져간다 (sendPhoto by URL)
async function sendTelegramPhoto(token: string, chatId: string, photoUrl: string, caption: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: caption.slice(0, 1000) }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) console.error('[notify-check] sendPhoto', res.status, (await res.text().catch(() => '')).slice(0, 200))
    return res.ok
  } catch (e) {
    console.error('[notify-check] sendPhoto fail', String(e))
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
  const dryRun = searchParams.get('dry') === '1'
  const force = searchParams.get('force') === '1'
  const started = Date.now()
  const elapsed = () => Date.now() - started
  const sql = dbUrl ? neon(dbUrl, { fetchOptions: { cache: 'no-store' } }) : null

  // ---------- 1) 감시 목록 ----------
  let watches: Watch[] = []
  let watchSource: 'param' | 'db' | 'env' = 'env'
  if (searchParams.get('detail') || searchParams.get('compare')) {
    watches = [{
      id: 0, title: '',
      detail: (searchParams.get('detail') || '').split(',').filter(Boolean),
      compare: (searchParams.get('compare') || '').split(',').filter(Boolean),
    }]
    watchSource = 'param'
  } else {
    const reserved = dbUrl ? await loadActiveWatches().catch(() => []) : []
    if (reserved.length > 0) {
      watches = reserved.map((w) => ({ id: w.id, title: w.title, detail: w.detail, compare: w.compare }))
      watchSource = 'db'
    } else {
      const env = parseWatch(process.env.NOTIFY_WATCH || '')
      if (env.detail.length || env.compare.length) watches = [{ id: 0, title: '', ...env }]
    }
  }
  // 예약 접수 순서대로 (id 오름차순). 세부 단지가 없으면 비교 단지를 대상으로.
  watches.sort((a, b) => a.id - b.id)
  for (const w of watches) {
    if (w.detail.length === 0) w.detail = w.compare.slice(0, SITES_PER_WATCH)
    w.detail = w.detail.slice(0, SITES_PER_WATCH)
    w.compare = w.compare.filter((n) => !w.detail.includes(n))
  }
  let watchRows: unknown = undefined
  if (dryRun && sql) {
    try { watchRows = await sql`SELECT id, title, detail, compare, active, created_at FROM notify_watch ORDER BY id` } catch (e) { watchRows = String(e) }
  }
  if (watches.length === 0) {
    return NextResponse.json({ ok: false, error: '감시 단지 없음 — 접수현황 화면 [보고서 구성]에서 알림 예약을 하거나 NOTIFY_WATCH 를 설정하세요', watchRows })
  }

  // ---------- 2) 데이터 조회 (모든 예약의 세부 단지를 중복 없이 한 번에) ----------
  const origin = originOf(request)
  const allDetail = Array.from(new Set(watches.flatMap((w) => w.detail)))
  const reportTimeout = () => Math.max(3000, Math.min(25000, 52000 - elapsed()))
  const fetchReport = async (params: URLSearchParams, timeoutMs: number): Promise<ReportData | null> => {
    try {
      const res = await fetch(`${origin}/api/report-data?${params.toString()}&t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
      return (await res.json()) as ReportData
    } catch { return null }
  }
  const siteMap = new Map<string, ReportSite>()
  const fetchSites = async (nos: string[], timeoutMs: number): Promise<number> => {
    const chunks: string[][] = []
    for (let i = 0; i < nos.length; i += SITES_PER_QUERY) chunks.push(nos.slice(i, i + SITES_PER_QUERY))
    const results = await Promise.all(chunks.map((c) => {
      const p = new URLSearchParams(); p.set('detail', c.join(','))
      return fetchReport(p, timeoutMs)
    }))
    let got = 0
    for (const r of results) {
      if (!r?.ok) continue
      for (const s of r.detail) { siteMap.set(s.pblancNo, s); got++ }
    }
    return got
  }
  const firstGot = await fetchSites(allDetail, reportTimeout())
  if (firstGot === 0) return NextResponse.json({ ok: false, error: 'report-data 실패(1차)' })

  // ---------- 3) 발송 기록 (예약id + 단지) ----------
  const sentMap = new Map<string, SentRec>()
  const keyOf = (wid: number, no: string) => `${wid}:${no}`
  if (sql) {
    try {
      await sql`CREATE TABLE IF NOT EXISTS notify_sent_v2 (
        watch_id integer NOT NULL,
        pblanc_no text NOT NULL,
        stage text NOT NULL,
        data_ready boolean NOT NULL DEFAULT true,
        snapshot_id text,
        image_sent boolean NOT NULL DEFAULT true,
        sent_at timestamptz DEFAULT now(),
        PRIMARY KEY (watch_id, pblanc_no)
      )`
      // 최초 1회: 예전 기록(단지 기준)을 지금 켜진 예약에 옮겨 둔다 → 이미 보낸 단계를 다시 보내지 않게
      const cnt = (await sql`SELECT count(*)::int AS n FROM notify_sent_v2`) as Array<{ n: number }>
      if ((cnt[0]?.n ?? 0) === 0) {
        try {
          await sql`INSERT INTO notify_sent_v2 (watch_id, pblanc_no, stage, data_ready, snapshot_id, image_sent, sent_at)
                    SELECT w.id, s.pblanc_no, s.stage, true, NULL, true, s.sent_at
                    FROM notify_sent s JOIN notify_watch w
                      ON w.active = true AND (',' || coalesce(w.detail, '') || ',') LIKE ('%,' || s.pblanc_no || ',%')
                    ON CONFLICT DO NOTHING`
        } catch { /* 예전 테이블이 없으면 건너뜀 */ }
      }
      const rows = (await sql`SELECT watch_id, pblanc_no, stage, data_ready, snapshot_id, image_sent FROM notify_sent_v2`) as Array<{
        watch_id: number; pblanc_no: string; stage: string; data_ready: boolean; snapshot_id: string | null; image_sent: boolean
      }>
      for (const r of rows) {
        sentMap.set(keyOf(r.watch_id, r.pblanc_no), { stage: r.stage, ready: r.data_ready !== false, snapshotId: r.snapshot_id, imageSent: r.image_sent })
      }
    } catch (e) {
      console.error('[notify-check] DB read fail', e)
    }
  }

  // 발표 직후(19:30~19:40): 단계는 넘어갔는데 숫자가 아직 0인 단지만 8초 간격으로 다시 받는다.
  const nowMin = kstMinutesOfDay()
  const inHotWindow = nowMin >= RETRY_FROM && nowMin <= RETRY_TO
  const ready = (s: ReportSite) => stageDataReady(s) || zeroConfirmed(s, kstMinutesOfDay())
  // 재조회 대상: 숫자가 아직 0이고, 그 단계를 아직 보고하지 않은 예약이 하나라도 있는 단지
  const pendingNos = () => allDetail.filter((n) => {
    const s = siteMap.get(n)
    if (!s || s.stage === 'before' || ready(s)) return false
    const cur = STAGE_ORDER[s.stage] ?? 0
    return watches.some((w) => w.detail.includes(n) && (STAGE_ORDER[sentMap.get(keyOf(w.id, n))?.stage || 'before'] ?? 0) < cur)
  })
  let recheck = 0
  while (!dryRun && inHotWindow && pendingNos().length > 0 && elapsed() + RETRY_GAP_MS < RETRY_BUDGET_MS) {
    await new Promise((r) => setTimeout(r, RETRY_GAP_MS))
    await fetchSites(pendingNos(), Math.min(reportTimeout(), 15000))
    recheck++
  }

  // ---------- 4) 예약별 발송 대상 판정 ----------
  const valve = kstMinutesOfDay() >= VALVE_FROM
  const today = todayKST()
  type Plan = { watch: Watch; sites: ReportSite[]; advanced: ReportSite[]; correction: boolean; zeroNote: boolean; valveNote: boolean }
  const plans: Plan[] = watches.map((w) => {
    const sites = w.detail.map((n) => siteMap.get(n)).filter((s): s is ReportSite => !!s)
    const advanced = sites.filter((s) => {
      if (s.stage === 'before') return false
      if (force) return true
      const rec = sentMap.get(keyOf(w.id, s.pblancNo))
      const cur = STAGE_ORDER[s.stage] ?? 0
      const pv = STAGE_ORDER[rec?.stage || 'before'] ?? 0
      const ok = ready(s)
      if (cur > pv) return ok || valve
      if (cur === pv && rec && rec.ready === false && stageDataReady(s)) return true   // 0건으로 나갔던 단계 → 정정
      return false
    })
    const correction = advanced.some((s) => {
      const rec = sentMap.get(keyOf(w.id, s.pblancNo))
      return !!rec && rec.stage === s.stage && rec.ready === false
    })
    const zeroNote = advanced.some((s) => !stageDataReady(s) && zeroConfirmed(s, kstMinutesOfDay()))
    const valveNote = advanced.some((s) => !stageDataReady(s) && !zeroConfirmed(s, kstMinutesOfDay()))
    return { watch: w, sites, advanced, correction, zeroNote, valveNote }
  })

  const summary = plans.map((p) => ({
    watchId: p.watch.id,
    title: p.watch.title,
    sites: p.sites.map((s) => ({ pblancNo: s.pblancNo, name: s.houseName, stage: s.stage, ready: stageDataReady(s), prevSent: sentMap.get(keyOf(p.watch.id, s.pblancNo))?.stage || null })),
    advanced: p.advanced.map((s) => s.pblancNo),
    sent: false as boolean | string,
    imageSent: undefined as boolean | string | undefined,
  }))
  const base = { ok: true, checkedAt: new Date().toISOString(), watchSource, watchRows, recheck }

  // 지난 실행에서 문자만 가고 이미지는 못 보낸 것 이어서 보내기
  const flushPendingImages = async (): Promise<string[]> => {
    const done: string[] = []
    if (!token || !chatId || !sql) return done
    const seen = new Set<string>()
    for (const [k, rec] of Array.from(sentMap.entries())) {
      if (!rec.snapshotId || rec.imageSent || seen.has(rec.snapshotId)) continue
      if (elapsed() > SEND_BUDGET_MS) break
      seen.add(rec.snapshotId)
      const ok = await sendTelegramPhoto(token, chatId, `${origin}/api/report-image?id=${rec.snapshotId}`, '📊 청약결과 보고서 (이미지)')
      if (!ok) break
      try { await sql`UPDATE notify_sent_v2 SET image_sent = true WHERE snapshot_id = ${rec.snapshotId}` } catch {}
      done.push(k)
    }
    return done
  }

  if (dryRun) return NextResponse.json({ ...base, watches: summary })
  if (!token || !chatId) {
    return NextResponse.json({ ...base, watches: summary, error: 'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 미설정' })
  }

  // ---------- 5) 예약 접수 순서대로 발송 ----------
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]
    const sum = summary[i]
    if (p.advanced.length === 0) continue
    if (elapsed() > SEND_BUDGET_MS) { sum.sent = '시간 부족 — 다음 실행에서 발송'; continue }

    // 5-1) 중복 잠금 — 내가 읽은 기록 그대로일 때만 발송권을 가져간다
    let claimed: ReportSite[] = p.advanced
    if (sql && !force) {
      claimed = []
      for (const s of p.advanced) {
        const rec = sentMap.get(keyOf(p.watch.id, s.pblancNo))
        try {
          const r = rec
            ? (await sql`UPDATE notify_sent_v2 SET stage = ${s.stage}, data_ready = ${stageDataReady(s)}, snapshot_id = NULL, image_sent = false, sent_at = now()
                         WHERE watch_id = ${p.watch.id} AND pblanc_no = ${s.pblancNo} AND stage = ${rec.stage} AND data_ready = ${rec.ready}
                         RETURNING pblanc_no`) as unknown[]
            : (await sql`INSERT INTO notify_sent_v2 (watch_id, pblanc_no, stage, data_ready, snapshot_id, image_sent)
                         VALUES (${p.watch.id}, ${s.pblancNo}, ${s.stage}, ${stageDataReady(s)}, NULL, false)
                         ON CONFLICT DO NOTHING RETURNING pblanc_no`) as unknown[]
          if (r.length > 0) claimed.push(s)
        } catch (e) {
          console.error('[notify-check] claim fail', e)
          claimed.push(s)   // DB 오류로 잠금을 못 걸면 누락보다 발송을 택한다
        }
      }
      if (claimed.length === 0) { sum.sent = '다른 실행이 이미 발송 중 — 건너뜀'; continue }
    }

    // 5-2) 비교 단지 (시간이 남을 때만)
    let compareSites: ReportSite[] = []
    if (p.watch.compare.length > 0 && elapsed() < 30000) {
      const cq = new URLSearchParams(); cq.set('compare', p.watch.compare.join(','))
      const extra = await fetchReport(cq, Math.max(1500, 40000 - elapsed()))
      if (extra?.ok) compareSites = extra.compare
    }

    // 5-3) 텍스트
    const q = new URLSearchParams()
    q.set('detail', p.watch.detail.join(','))
    if (p.watch.compare.length) q.set('compare', p.watch.compare.join(','))
    const reportLink = `${origin}/report?${q.toString()}`
    const head =
      (p.correction ? '🔁 [정정] 앞서 접수 0건으로 전송된 결과를 바로잡습니다\n\n' : '') +
      (p.zeroNote ? '※ 접수 0건 — 19:35 이후 청약홈 조회 기준으로 확인된 결과입니다\n\n' : '') +
      (p.valveNote ? '⚠️ 청약홈 조회 지연으로 접수 숫자를 아직 확인하지 못했습니다 — 숫자가 확인되면 정정본을 다시 보냅니다\n\n' : '')
    const text = `${head}${reportToText(p.sites, compareSites)}\n\n📄 ${reportLink}`.slice(0, 3900)
    const ok = await sendTelegram(token, chatId, text)

    if (!ok) {
      // 발송 실패 → 발송권을 되돌려 다음 실행이 다시 보내게 한다
      if (sql && !force) {
        for (const s of claimed) {
          const rec = sentMap.get(keyOf(p.watch.id, s.pblancNo))
          try {
            if (rec) await sql`UPDATE notify_sent_v2 SET stage = ${rec.stage}, data_ready = ${rec.ready}, snapshot_id = ${rec.snapshotId}, image_sent = true WHERE watch_id = ${p.watch.id} AND pblanc_no = ${s.pblancNo}`
            else await sql`DELETE FROM notify_sent_v2 WHERE watch_id = ${p.watch.id} AND pblanc_no = ${s.pblancNo}`
          } catch (e) { console.error('[notify-check] rollback fail', e) }
        }
      }
      sum.sent = '텔레그램 전송 실패 (토큰/채팅ID 확인)'
      continue
    }
    sum.sent = true

    // 5-4) 이미지 — 발송 시점 데이터를 스냅샷으로 저장. 시간이 모자라면 다음 실행이 이어서 보낸다.
    let imageSent: boolean | string = false
    const snapId = await saveSnapshot({ detail: p.sites, compare: compareSites, title: p.watch.title || defaultTitle(p.sites) })
    if (snapId && elapsed() < SEND_BUDGET_MS) {
      imageSent = await sendTelegramPhoto(token, chatId, `${origin}/api/report-image?id=${snapId}`, `📊 청약결과 보고서 (이미지)${p.correction ? ' — 정정본' : ''}`)
    } else if (snapId) {
      imageSent = '시간 부족 — 다음 실행에서 전송'
    } else {
      imageSent = '스냅샷 저장 실패'
    }
    sum.imageSent = imageSent

    // 5-5) 기록
    if (sql) {
      for (const s of claimed) {
        try {
          await sql`INSERT INTO notify_sent_v2 (watch_id, pblanc_no, stage, data_ready, snapshot_id, image_sent, sent_at)
                    VALUES (${p.watch.id}, ${s.pblancNo}, ${s.stage}, ${stageDataReady(s)}, ${snapId}, ${imageSent === true || !snapId}, now())
                    ON CONFLICT (watch_id, pblanc_no) DO UPDATE SET stage = EXCLUDED.stage, data_ready = EXCLUDED.data_ready,
                      snapshot_id = EXCLUDED.snapshot_id, image_sent = EXCLUDED.image_sent, sent_at = now()`
          sentMap.set(keyOf(p.watch.id, s.pblancNo), { stage: s.stage, ready: stageDataReady(s), snapshotId: snapId, imageSent: imageSent === true || !snapId })
        } catch (e) { console.error('[notify-check] DB write fail', e) }
      }
    }
  }

  // ---------- 6) 예약 자동 종료 (예약별) ----------
  //   - 세부 단지 전부 2순위(또는 최종)까지 발송됨
  //   - 또는 1순위 발송이 끝났고 2순위 접수일이 지남 (1순위에서 전 타입 마감 → 2순위 접수 자체가 없는 경우)
  const ended: number[] = []
  if (sql && watchSource === 'db') {
    for (const p of plans) {
      if (p.sites.length === 0) continue
      const done = p.sites.every((s) => {
        const rec = sentMap.get(keyOf(p.watch.id, s.pblancNo))
        const sentStage = STAGE_ORDER[rec?.stage || 'before'] ?? 0
        if (sentStage >= 3) return true
        return sentStage >= 2 && !!s.dates.rank2 && today > s.dates.rank2
      })
      if (done) {
        try { await deactivateWatch(p.watch.id); ended.push(p.watch.id) } catch (e) { console.error('[notify-check] deactivate fail', e) }
      }
    }
  }

  const flushed = elapsed() < SEND_BUDGET_MS ? await flushPendingImages() : []
  return NextResponse.json({ ...base, watches: summary, ended, imageFlushed: flushed, elapsedMs: elapsed() })
}
