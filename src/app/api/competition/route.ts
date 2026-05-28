import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'

// ===================== TYPES (응답 구조 — 기존과 100% 동일) =====================
type HouseTypeRate = {
  type: string
  rate: string
  reqCnt: string
  suply: string
  rank: string
  reside: string
  spsply?: Record<string, string>
}

type CompetitionItem = {
  pblancNo: string
  houseName: string
  region: string
  rceptBgnde: string
  rceptEndde: string
  houseTypes: HouseTypeRate[]
}

// DB 한 행의 형태
type DbRow = {
  item: CompetitionItem
}

// ===================== GET =====================
// 방식 A: 청약홈 API를 직접 부르지 않고, Python 배치가 채워둔 DB만 읽는다.
// 필터(keyword/region/yearMonth)는 SQL WHERE 로 처리 → 빠름.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    const keyword = (searchParams.get('keyword') || '').trim()
    const region = (searchParams.get('region') || '').trim()
    const yearMonthFrom = (searchParams.get('yearMonthFrom') || '').trim()
    const yearMonthTo = (searchParams.get('yearMonthTo') || '').trim()

    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) {
      throw new Error('DATABASE_URL not set')
    }

    const sql = neon(dbUrl)

    // 동적 WHERE 절 구성 (파라미터 바인딩으로 안전하게)
    const conditions: string[] = []
    const params: (string | null)[] = []
    let idx = 1

    if (region && region !== '전체') {
      conditions.push(`region = $${idx++}`)
      params.push(region)
    }
    if (yearMonthFrom) {
      conditions.push(`ym >= $${idx++}`)
      params.push(yearMonthFrom)
    }
    if (yearMonthTo) {
      conditions.push(`ym <= $${idx++}`)
      params.push(yearMonthTo)
    }
    if (keyword) {
      conditions.push(`house_name ILIKE $${idx++}`)
      params.push(`%${keyword}%`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const query = `
      SELECT item
      FROM competition_items
      ${whereClause}
      ORDER BY rcept_bgnde DESC NULLS LAST
    `

    // neon() 의 query() 메서드로 파라미터 바인딩 쿼리 실행
    const rows = (await sql.query(query, params)) as DbRow[]

    const items: CompetitionItem[] = rows.map((r) => r.item)

    return NextResponse.json({
      items,
      total: items.length,
    })
  } catch (error) {
    console.error('[competition GET] error:', error)

    return NextResponse.json({
      items: [],
      total: 0,
      error: String(error),
    })
  }
}
