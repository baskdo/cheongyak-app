import { NextResponse } from 'next/server'
import { syncNotices, loadNoticeCache } from '@/lib/notices'

// 공고 목록 동기화 — 공공데이터 → Neon(notices_raw → notices_cache)
//   GET /api/sync-notices?key=CRON_SECRET        (cron-job.org: 06~23시 10~30분 간격, www 주소로)
//   Vercel cron 은 Authorization: Bearer CRON_SECRET 헤더로 호출
//   Vercel Hobby 10초 제한 → 한 번에 약 7초치만 받고(페이지 단위 저장), 못 받은 페이지는 다음 호출이 이어받음.
//   모든 페이지가 모이면 화면용 캐시를 조립해 저장. 응답: { ok, count, fetched[], pending, assembled, ms }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 10

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = process.env.CRON_SECRET
  const given = searchParams.get('key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!secret || given !== secret) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const r = await syncNotices(7000)
  const cache = await loadNoticeCache()
  return NextResponse.json({ ...r, cacheCount: cache?.count ?? 0, updatedAt: cache?.updatedAt || null }, { status: r.ok ? 200 : 500 })
}
