import { NextResponse } from 'next/server'
import { syncNotices, noticeCacheMeta } from '@/lib/notices'

// 공고 목록 동기화 — 공공데이터 → Neon(notices_raw → notices_cache)
//   GET /api/sync-notices?key=CRON_SECRET        (cron-job.org: 06~23시 10~30분 간격, www 주소로)
//   Vercel cron 은 Authorization: Bearer CRON_SECRET 헤더로 호출
//   함수 60초 중 40초 예산 안에서 페이지 단위로 받아 저장하고, 못 받은 페이지는 다음 호출이 이어받음.
//   모든 페이지가 모이면 화면용 캐시를 조립해 저장. 응답: { ok, count, fetched[], pending, assembled, ms }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60   // Hobby 플랜 최대 60초 (기본 10초)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = process.env.CRON_SECRET
  const given = searchParams.get('key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!secret || given !== secret) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const t0 = Date.now()
  console.log('[sync-notices] request start')
  // 60초 함수 안에서 40초 예산 → 한 번에 전체 페이지(≈18) 수신 + 조립까지 보통 끝남
  const r = await syncNotices(40000)
  const cache = await noticeCacheMeta()
  console.log('[sync-notices] respond', Date.now() - t0, 'ms', JSON.stringify({ ok: r.ok, fetched: r.fetched, pending: r.pending, error: r.error }))
  return NextResponse.json({ ...r, cacheCount: cache?.count ?? null, updatedAt: cache?.updatedAt || null }, { status: r.ok ? 200 : 500 })
}
