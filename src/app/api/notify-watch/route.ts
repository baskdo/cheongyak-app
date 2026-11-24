import { NextResponse } from 'next/server'
import { getSql, loadActiveWatch, loadActiveWatches, split, toWatch, Row } from '@/lib/notifyWatch'

// 텔레그램 알림 "예약" — 접수현황 화면의 [보고서 구성](세부/비교 선택)을 서버(Neon)에 저장
//
//   GET    /api/notify-watch            → 활성 예약 목록 { watches: [...] } (+ 호환용 watch: 가장 최근 1건)
//   POST   /api/notify-watch            → 예약 추가  body: { detail: string[], compare: string[], title?: string }
//   DELETE /api/notify-watch?id=N       → 해당 예약만 해제 (id 없으면 전체 해제)
//   인증: 헤더 x-admin-key = CRON_SECRET. 화면에서는 관리자 링크(/?admin=키)로 한 번 열면 브라우저가 기억해 자동 전송.
//   도배 방지: 예약 변경(POST/DELETE) 하루 20회 제한.
//
// /api/notify-check 가 이 예약을 읽어 발표 시각에 텔레그램을 보낸다 (환경변수 NOTIFY_WATCH 보다 우선).
// 예약은 여러 건을 동시에 유지한다 (현장별 예약). 같은 날 저녁 발표가 겹치면 예약 접수 순서대로 발송.
// 같은 세부 단지 조합의 예약이 이미 켜져 있으면 새로 만들지 않고 내용(비교·제목)만 갱신한다.
const MAX_ACTIVE = 10

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  const given = request.headers.get('x-admin-key') || ''
  return !!secret && given === secret
}

// 하루 변경 횟수 제한 (notify_watch 테이블의 오늘 생성 건수로 판단)
const DAILY_CHANGE_LIMIT = 20
async function overDailyLimit(): Promise<boolean> {
  try {
    const sql = await getSql()
    const rows = (await sql`SELECT count(*)::int AS n FROM notify_watch WHERE created_at > now() - interval '1 day'`) as Array<{ n: number }>
    return (rows[0]?.n ?? 0) >= DAILY_CHANGE_LIMIT
  } catch { return false }
}

export async function GET() {
  try {
    const [watch, watches] = await Promise.all([loadActiveWatch(), loadActiveWatches()])
    return NextResponse.json({ ok: true, watch, watches }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ ok: false, watch: null, watches: [], error: String(e) })
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: '관리자 링크로 열어야 예약할 수 있습니다' }, { status: 401 })
  if (await overDailyLimit()) return NextResponse.json({ ok: false, error: '오늘 예약 변경 횟수 한도(20회)를 넘었습니다' }, { status: 429 })
  try {
    const body = (await request.json().catch(() => ({}))) as { detail?: unknown; compare?: unknown; title?: unknown }
    const detail = Array.isArray(body.detail) ? split(body.detail.map(String).join(',')) : []
    const compare = Array.isArray(body.compare) ? split(body.compare.map(String).join(',')).filter((n) => !detail.includes(n)) : []
    const title = typeof body.title === 'string' ? body.title.slice(0, 100) : ''
    if (detail.length === 0) return NextResponse.json({ ok: false, error: '세부조회 단지를 1개 이상 선택하세요' }, { status: 400 })

    const sql = await getSql()
    const active = await loadActiveWatches()
    // 같은 세부 단지 조합이 이미 예약돼 있으면 갱신 (중복 예약 방지 — 발송 기록도 그대로 이어짐)
    const key = [...detail].sort().join(',')
    const same = active.find((w) => [...w.detail].sort().join(',') === key)
    if (same) {
      const rows = (await sql`UPDATE notify_watch SET title = ${title}, compare = ${compare.join(',')} WHERE id = ${same.id} RETURNING *`) as Row[]
      return NextResponse.json({ ok: true, watch: toWatch(rows[0]), watches: await loadActiveWatches(), updated: true })
    }
    if (active.length >= MAX_ACTIVE) {
      return NextResponse.json({ ok: false, error: `동시에 켜 둘 수 있는 예약은 ${MAX_ACTIVE}건까지입니다 — 끝난 예약을 해제하세요` }, { status: 429 })
    }
    const rows = (await sql`INSERT INTO notify_watch (title, detail, compare, active)
                             VALUES (${title}, ${detail.join(',')}, ${compare.join(',')}, true) RETURNING *`) as Row[]
    return NextResponse.json({ ok: true, watch: toWatch(rows[0]), watches: await loadActiveWatches() })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) })
  }
}

export async function DELETE(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: '관리자 링크로 열어야 해제할 수 있습니다' }, { status: 401 })
  try {
    const sql = await getSql()
    const idParam = new URL(request.url).searchParams.get('id')
    const id = idParam ? parseInt(idParam, 10) : NaN
    if (Number.isFinite(id)) await sql`UPDATE notify_watch SET active = false WHERE id = ${id}`
    else await sql`UPDATE notify_watch SET active = false WHERE active = true`
    const watches = await loadActiveWatches()
    return NextResponse.json({ ok: true, watch: watches[watches.length - 1] || null, watches })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) })
  }
}
