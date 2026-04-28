import { NextResponse } from 'next/server'

const BASE_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'

type HouseTypeDetail = {
  type: string        // 주택형 원본 (예: "059.9000A")
  typeLabel: string   // 표시용 (예: "59A")
  supplyArea: number  // 공급면적 (㎡)
  pyeong: number      // 공급평형 (평, 소수점 2자리)
  topAmount: number   // 최고 분양가 (만원)
  pyeongPrice: number // 평당가 (만원/평)
  suplyHshldco: number // 공급세대수
}

type ApartmentRow = Record<string, string>
type TypeRow = Record<string, string | number>

// ===== 페이징 유틸: 끝까지 또는 maxPage까지 가져오기 =====
async function fetchAllPages<T>(
  endpoint: string,
  apiKey: string,
  fresh = false,
  maxPage = 30 // 안전장치 (1000건 × 30 = 최대 30,000건)
): Promise<T[]> {
  const perPage = 1000
  const rows: T[] = []
  let page = 1
  let done = false

  while (!done && page <= maxPage) {
    const url = `${BASE_URL}/${endpoint}?serviceKey=${encodeURIComponent(apiKey)}&page=${page}&perPage=${perPage}&returnType=JSON`
    const res = await fetch(url, fresh
      ? { cache: 'no-store' }
      : { next: { revalidate: 600 } } // 10분 캐시
    )
    if (!res.ok) {
      console.error(`API error: ${endpoint} page=${page} status=${res.status}`)
      break
    }
    const json = await res.json()
    const data: T[] = json?.data || []
    rows.push(...data)
    if (data.length < perPage) {
      done = true
    } else {
      page += 1
    }
  }
  return rows
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fresh = searchParams.get('fresh') === '1'
  const limit = searchParams.get('limit') // 옵션: 'recent' = 최신 1페이지(1000건)만 (구버전 호환)

  const apiKey = process.env.API_KEY
  if (!apiKey || apiKey === '여기에_API키_입력') {
    return NextResponse.json(getDummyData())
  }

  try {
    // limit=recent면 1페이지만, 아니면 끝까지 (최대 30페이지 = 30,000건)
    const apartments = limit === 'recent'
      ? await fetchAllPages<ApartmentRow>('getAPTLttotPblancDetail', apiKey, fresh, 1)
      : await fetchAllPages<ApartmentRow>('getAPTLttotPblancDetail', apiKey, fresh)

    // 주택형/분양가/공급면적 — 끝까지 가져옴
    const types = await fetchAllPages<TypeRow>('getAPTLttotPblancMdl', apiKey, fresh)

    const typeMap: Record<string, {
      houseTypes: string
      minPrice: string
      maxPrice: string
      details: HouseTypeDetail[]
    }> = {}

    types.forEach((t) => {
      const no = String(t['PBLANC_NO'] || '')
      if (!no) return
      if (!typeMap[no]) typeMap[no] = { houseTypes: '', minPrice: '', maxPrice: '', details: [] }

      const ty = String(t['HOUSE_TY'] || '').trim()
      const supplyArea = parseFloat(String(t['SUPLY_AR'] || '0'))
      const topAmount = parseInt(String(t['LTTOT_TOP_AMOUNT'] || '0'))
      const suplyHshldco = parseInt(String(t['SUPLY_HSHLDCO'] || '0'))

      const typeLabel = ty.replace(/^0*(\d+)\.?\d*([A-Za-z]*)$/, (_, _num, suffix) => {
        return Math.floor(parseFloat(ty)) + String(suffix).toUpperCase()
      })

      const pyeong = Math.round(supplyArea * 0.3025 * 100) / 100
      const pyeongPrice = pyeong > 0 ? Math.round(topAmount / pyeong) : 0

      if (ty && !typeMap[no].houseTypes.includes(ty)) {
        typeMap[no].houseTypes = typeMap[no].houseTypes ? typeMap[no].houseTypes + ', ' + ty : ty
      }

      if (topAmount > 0) {
        const curMin = typeMap[no].minPrice ? parseInt(typeMap[no].minPrice) : Infinity
        const curMax = typeMap[no].maxPrice ? parseInt(typeMap[no].maxPrice) : 0
        if (topAmount < curMin) typeMap[no].minPrice = String(topAmount)
        if (topAmount > curMax) typeMap[no].maxPrice = String(topAmount)
      }

      if (supplyArea > 0) {
        typeMap[no].details.push({
          type: ty,
          typeLabel,
          supplyArea,
          pyeong,
          topAmount,
          pyeongPrice,
          suplyHshldco,
        })
      }
    })

    Object.values(typeMap).forEach((v) => {
      v.details.sort((a, b) => a.supplyArea - b.supplyArea)
    })

    const transformed = apartments.map((item: ApartmentRow) => {
      const no = item['PBLANC_NO'] || String(Math.random())
      const typeInfo = typeMap[no] || { houseTypes: '', minPrice: '', maxPrice: '', details: [] }
      return {
        id: no,
        name: item['HOUSE_NM'] || '단지명 없음',
        address: item['HSSPLY_ADRES'] || '',
        region: extractRegion(item['SUBSCRPT_AREA_CODE_NM'] || item['HSSPLY_ADRES'] || ''),
        type: item['HOUSE_SECD_NM'] || 'APT',
        totalUnits: item['TOT_SUPLY_HSHLDCO'] || '0',
        rceptBgnde: item['RCEPT_BGNDE'] || '',
        rceptEndde: item['RCEPT_ENDDE'] || '',
        przwnerPresnatnDe: item['PRZWNER_PRESNATN_DE'] || '',
        pblancDe: item['RCRIT_PBLANC_DE'] || '',
        status: getStatus(item['RCEPT_BGNDE'], item['RCEPT_ENDDE']),
        hompageUrl: item['HMPG_ADRES'] || 'https://www.applyhome.co.kr',
        constructor: item['CNSTRCT_ENTRPS_NM'] || '',
        moveInDate: item['MVN_PREARNGE_YM'] || '',
        pdfUrl: item['PBLANC_URL'] || '',
        minPrice: typeInfo.minPrice,
        maxPrice: typeInfo.maxPrice,
        houseTypes: typeInfo.houseTypes,
        typeDetails: typeInfo.details,
      }
    })

    // 공고일 내림차순 정렬 (최신 먼저)
    transformed.sort((a, b) => (b.pblancDe || '').localeCompare(a.pblancDe || ''))

    return NextResponse.json({ items: transformed, total: transformed.length })
  } catch (error) {
    console.error('Fetch error:', error)
    return NextResponse.json(getDummyData())
  }
}

function extractRegion(text: string): string {
  const regions: Record<string, string> = {
    '서울': '서울', '경기': '경기', '인천': '인천', '부산': '부산',
    '대구': '대구', '광주': '광주', '대전': '대전', '울산': '울산',
    '세종': '세종', '강원': '강원', '충북': '충북', '충남': '충남',
    '전북': '전북', '전남': '전남', '경북': '경북', '경남': '경남', '제주': '제주',
  }
  for (const [key, val] of Object.entries(regions)) {
    if (text.includes(key)) return val
  }
  return '기타'
}

function getStatus(start: string, end: string): string {
  if (!start || !end) return '접수예정'
  const now = new Date()
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (now < startDate) return '접수예정'
  if (now > endDate) return '접수마감'
  return '접수중'
}

function getDummyData() {
  return {
    items: [
      {
        id: '1', name: '래미안 엘라비네',
        address: '서울특별시 강서구 방화동 608-97번지 일대',
        region: '서울', type: 'APT', totalUnits: '272',
        rceptBgnde: '2026-03-16', rceptEndde: '2026-03-19',
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
