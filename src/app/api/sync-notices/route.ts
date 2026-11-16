import { NextResponse } from 'next/server'
import { syncNotices, loadNoticeCache } from '@/lib/notices'

// 공고 목록 동기화 — 공공데이터 → Neon(notices_cache)
//   GET /api/sync-notices?key=CRON_SECRET        (cron-job.org: 06~23시 30분 간격, www 주소로)
//   Vercel cron 은 Authorization: Bearer CRON_SECRET 헤더로 호출
//   소요 3~6초 (병렬 페이징). 성공 시 저장 건수와 소요시간 반환.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 10

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = process.env.CRON_SECRET
  const given = searchParams.get('key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!secret || given !== secret) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const r = await syncNotices()
  const cache = r.ok ? await loadNoticeCache() : null
  return NextResponse.json({ ...r, updatedAt: cache?.updatedAt || null }, { status: r.ok ? 200 : 500 })
}
