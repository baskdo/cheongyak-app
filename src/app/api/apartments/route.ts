import { NextResponse } from 'next/server'
import { loadNoticeCache, syncNotices, applyStatus, apiKeys, fetchAllPagesParallel, buildNoticeItems } from '@/lib/notices'

// 공고 목록 API — DB 캐시 우선 (첫 화면이 공공데이터 API 상태에 흔들리지 않도록)
//
//   GET /api/apartments                → 전체 목록 (DB)
//   GET /api/apartments?limit=recent   → 최신 1,000건 (DB에서 슬라이스)
//   GET /api/apartments?fresh=1        → 🔄 새로고침: 캐시가 10분 넘었으면 그 자리에서 동기화 후 응답
//
//   캐시 없음(최초) → 라이브 1페이지로 즉시 응답 (동기화는 /api/sync-notices 크론이 수행)
//   캐시가 오래돼도 기다리게 하지 않고 캐시로 응답 (fresh=1 일 때만 그 자리에서 동기화)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 10

const STALE_FOR_FRESH_MS = 10 * 60 * 1000        // fresh=1 일 때 이보다 오래됐으면 동기화

function respond(items: ReturnType<typeof applyStatus>, limit: string | null, meta: Record<string, unknown>) {
  const out = limit === 'recent' ? items.slice(0, 1000) : items
  return NextResponse.json({ items: out, total: out.length, ...meta }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fresh = searchParams.get('fresh') === '1'
  const limit = searchParams.get('limit')

  if (apiKeys().length === 0) return NextResponse.json(getDummyData())

  let cache = await loadNoticeCache()
  const age = cache ? Date.now() - new Date(cache.updatedAt).getTime() : Infinity
  // 🔄 새로고침(fresh=1)일 때만 그 자리에서 동기화 (사용자 의도). 그 외엔 절대 기다리게 하지 않음.
  if (fresh && age > STALE_FOR_FRESH_MS) {
    const r = await syncNotices(6000)
    if (r.ok) cache = await loadNoticeCache()
    else console.error('[apartments] sync failed:', r.error)
  }

  if (cache && cache.items.length > 0) {
    return respond(applyStatus(cache.items), limit, { source: 'db', updatedAt: cache.updatedAt })
  }

  // 최후 폴백: 라이브 1페이지 (DB 없거나 비었을 때)
  //   10초 제한을 넘기지 않도록 7초 안에 못 받으면 빈 목록으로 응답 (화면은 "불러오는 중"이 아니라 재시도 안내)
  try {
    const live = Promise.all([
      fetchAllPagesParallel<Record<string, string>>('getAPTLttotPblancDetail', 1),
      fetchAllPagesParallel<Record<string, string | number>>('getAPTLttotPblancMdl', 1),
    ])
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 7000))
    const got = await Promise.race([live, timeout])
    if (!got) return respond([], limit, { source: 'timeout' })
    const [apartments, types] = got
    const items = applyStatus(buildNoticeItems(apartments, types, new Map()))
    return respond(items, limit, { source: 'live' })
  } catch (error) {
    console.error('Fetch error:', error)
    return NextResponse.json(getDummyData())
  }
}

function getDummyData() {
  return {
    items: [
      {
        id: '1', name: '래미안 엘라비네',
        address: '서울특별시 강서구 방화동 608-97번지 일대',
        region: '서울', type: 'APT', totalUnits: '272',
        rceptBgnde: '2026-03-16', rceptEndde: '2026-03-19',
        spsplyRceptBgnde: '2026-03-16', spsplyRceptEndde: '2026-03-16',
        rank1RceptBgnde: '2026-03-17', rank1RceptEndde: '2026-03-17',
        rank2RceptBgnde: '2026-03-18', rank2RceptEndde: '2026-03-18',
        rank1Status: 'no_data' as const,
        przwnerPresnatnDe: '2026-03-25', pblancDe: '2026-03-06', status: '접수예정',
        hompageUrl: 'https://www.applyhome.co.kr',
        constructor: '삼성물산', moveInDate: '202712',
        pdfUrl: 'https://www.applyhome.co.kr', minPrice: '85000', maxPrice: '120000',
        houseTypes: '59A, 59B, 84A, 84B',
        typeDetails: [
          { type: '059.9000A', typeLabel: '59A', supplyArea: 81.48, pyeong: 24.64, topAmount: 87080, pyeongPrice: 3533, suplyHshldco: 169 },
          { type: '059.7700B', typeLabel: '59B', supplyArea: 82.13, pyeong: 24.84, topAmount: 85610, pyeongPrice: 3446, suplyHshldco: 47 },
          { type: '074.6300A', typeLabel: '74A', supplyArea: 100.52, pyeong: 30.41, topAmount: 101960, pyeongPrice: 3353, suplyHshldco: 92 },
        ],
      },
    ],
    total: 1,
    isDummy: true,
  }
}
