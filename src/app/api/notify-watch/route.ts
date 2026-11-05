import { NextResponse } from 'next/server'
import { getSql, loadActiveWatch, split, toWatch, Row } from '@/lib/notifyWatch'

// 텔레그램 알림 "예약" — 접수현황 화면의 [보고서 구성](세부/비교 선택)을 서버(Neon)에 저장
//
//   GET    /api/notify-watch            → 현재 활성 예약 (없으면 null)
//   POST   /api/notify-watch            → 예약 등록/교체  body: { detail: string[], compare: string[], title?: string }
//   DELETE /api/notify-watch            → 예약 해제
//   인증: 헤더 x-admin-key = CRON_SECRET (사이트가 공개라 아무나 예약 못 하게)
//
// /api/notify-check 가 이 예약을 읽어 발표 시각에 텔레그램을 보낸다 (환경변수 NOTIFY_WATCH 보다 우선).
// 예약은 한 번에 1건(활성)만 유지 — 새로 저장하면 이전 예약은 비활성화.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  const given = request.headers.get('x-admin-key') || ''
  return !!secret && given === secret
}

export async function GET() {
  try {
    const watch = await loadActiveWatch()
    return NextResponse.json({ ok: true, watch }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ ok: false, watch: null, error: String(e) })
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: '관리 키가 맞지 않습니다' }, { status: 401 })
  try {
    const body = (await request.json().catch(() => ({}))) as { detail?: unknown; compare?: unknown; title?: unknown }
    const detail = Array.isArray(body.detail) ? split(body.detail.map(String).join(',')) : []
    const compare = Array.isArray(body.compare) ? split(body.compare.map(String).join(',')).filter((n) => !detail.includes(n)) : []
    const title = typeof body.title === 'string' ? body.title.slice(0, 100) : ''
    if (detail.length === 0) return NextResponse.json({ ok: false, error: '세부조회 단지를 1개 이상 선택하세요' }, { status: 400 })

    const sql = await getSql()
    await sql`UPDATE notify_watch SET active = false WHERE active = true`
    const rows = (await sql`INSERT INTO notify_watch (title, detail, compare, active)
                             VALUES (${title}, ${detail.join(',')}, ${compare.join(',')}, true) RETURNING *`) as Row[]
    return NextResponse.json({ ok: true, watch: toWatch(rows[0]) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) })
  }
}

export async function DELETE(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: '관리 키가 맞지 않습니다' }, { status: 401 })
  try {
    const sql = await getSql()
    await sql`UPDATE notify_watch SET active = false WHERE active = true`
    return NextResponse.json({ ok: true, watch: null })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) })
  }
}
