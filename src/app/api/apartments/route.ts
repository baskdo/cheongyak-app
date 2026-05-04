import { NextResponse } from 'next/server'

const BASE_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'
const COMPETITION_BASE_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1'

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
type CmpetRow = Record<string, string | number>

// ===== 페이징 유틸: 끝까지 또는 maxPage까지 가져오기 =====
async function fetchAllPages<T>(
  endpoint: string,
  apiKey: string,
  fresh = false,
  maxPage = 30, // 안전장치 (1000건 × 30 = 최대 30,000건)
  baseUrl: string = BASE_URL
): Promise<T[]> {
  const perPage = 1000
  const rows: T[] = []
  let page = 1
  let done = false

  while (!done && page <= maxPage) {
    const url = `${baseUrl}/${endpoint}?serviceKey=${encodeURIComponent(apiKey)}&page=${page}&perPage=${perPage}&returnType=JSON`
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

// ===== 1순위 결과 분석 =====
// pblancNo별로 "1순위에서 모든 주택형이 마감되었는지" 판정
// 결과:
//   'sold_out'  - 전 주택형 1순위 마감 (2순위 안 열림 → 1순위 종료일까지만 접수중)
//   'has_short' - 일부 주택형 미달 (2순위 열림 → 2순위 종료일까지 접수중)
//   'no_data'   - competition API 데이터 없음 (발표 전 → 시간 기반 판정 폴백)
type Rank1Status = 'sold_out' | 'has_short' | 'no_data'

function buildRank1StatusMap(cmpetRows: CmpetRow[]): Map<string, Rank1Status> {
  // pblancNo → 주택형별 (suply, reqCnt 합계) 집계
  // 동일 주택형이라도 해당지역/기타로 행이 분리되니 reqCnt는 누적, suply는 max값 사용
  type TypeAgg = { suply: number; reqCnt: number }
  const grouped = new Map<string, Map<string, TypeAgg>>()  // pblancNo → (type → agg)

  for (const row of cmpetRows) {
    const pblancNo = String(row['PBLANC_NO'] || '').trim()
    if (!pblancNo) continue

    // 1순위만 분석 (RANK 정규화: '1', '01' 모두 1순위)
    const rankRaw = String(row['SUBSCRPT_RANK_CODE'] ?? '').trim()
    if (rankRaw !== '1' && rankRaw !== '01') continue

    const type = String(row['HOUSE_TY'] || '').trim()
    if (!type) continue

    const reqCnt = Number(row['REQ_CNT'] ?? 0) || 0
    const suply = Number(row['SUPLY_HSHLDCO'] ?? 0) || 0

    if (!grouped.has(pblancNo)) grouped.set(pblancNo, new Map())
    const typeMap = grouped.get(pblancNo)!

    if (!typeMap.has(type)) {
      typeMap.set(type, { suply, reqCnt: 0 })
    }
    const agg = typeMap.get(type)!
    if (suply > agg.suply) agg.suply = suply
    agg.reqCnt += reqCnt
  }

  // pblancNo별 판정
  const result = new Map<string, Rank1Status>()
  for (const [pblancNo, typeMap] of Array.from(grouped.entries())) {
    if (typeMap.size === 0) {
      result.set(pblancNo, 'no_data')
      continue
    }
    // 모든 주택형이 마감(reqCnt >= suply)인지 검사
    let allSoldOut = true
    for (const agg of Array.from(typeMap.values())) {
      if (agg.suply === 0) continue  // 공급 0인 주택형은 무시
      if (agg.reqCnt < agg.suply) {
        allSoldOut = false
        break
      }
    }
    result.set(pblancNo, allSoldOut ? 'sold_out' : 'has_short')
  }
  return result
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
    // competition API는 ODCLOUD_API_KEY(=API_KEY2) 또는 API_KEY 둘 중 사용 가능
    const cmpetKey = process.env.ODCLOUD_API_KEY || process.env.API_KEY2 || apiKey

    const [apartments, types, cmpetRows] = await Promise.all([
      limit === 'recent'
        ? fetchAllPages<ApartmentRow>('getAPTLttotPblancDetail', apiKey, fresh, 1)
        : fetchAllPages<ApartmentRow>('getAPTLttotPblancDetail', apiKey, fresh),
      fetchAllPages<TypeRow>('getAPTLttotPblancMdl', apiKey, fresh),
      // 1순위 마감 판정용 (실패해도 무시 — 시간 기반 폴백)
      fetchAllPages<CmpetRow>('getAPTLttotPblancCmpet', cmpetKey, fresh, 30, COMPETITION_BASE_URL).catch((e) => {
        console.error('[apartments] competition fetch failed (will fallback to time-based):', e)
        return [] as CmpetRow[]
      }),
    ])

    // 1순위 결과 맵 (pblancNo → 'sold_out' | 'has_short' | 'no_data')
    const rank1StatusMap = buildRank1StatusMap(cmpetRows)

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

      // 청약홈 API 공식 필드 (기술문서 260129 기준)
      // 특별공급: SPSPLY_RCEPT_BGNDE / SPSPLY_RCEPT_ENDDE
      // 1순위: 해당지역(CRSPAREA) 우선, 없으면 경기(ETC_GG) → 기타지역(ETC_AREA) 순
      const spsplyBgnde = item['SPSPLY_RCEPT_BGNDE'] || ''
      const spsplyEndde = item['SPSPLY_RCEPT_ENDDE'] || ''
      const rank1Bgnde =
        item['GNRL_RNK1_CRSPAREA_RCPTDE'] ||
        item['GNRL_RNK1_ETC_GG_RCPTDE'] ||
        item['GNRL_RNK1_ETC_AREA_RCPTDE'] ||
        ''
      const rank1Endde =
        item['GNRL_RNK1_CRSPAREA_ENDDE'] ||
        item['GNRL_RNK1_ETC_GG_ENDDE'] ||
        item['GNRL_RNK1_ETC_AREA_ENDDE'] ||
        ''

      // 2순위 (1순위 미달 시 추가 접수). 모든 지역 중 가장 늦은 종료일을 실제 접수마감으로 간주
      const rank2Bgnde =
        item['GNRL_RNK2_CRSPAREA_RCPTDE'] ||
        item['GNRL_RNK2_ETC_GG_RCPTDE'] ||
        item['GNRL_RNK2_ETC_AREA_RCPTDE'] ||
        ''
      const rank2Endde =
        item['GNRL_RNK2_ETC_AREA_ENDDE'] ||
        item['GNRL_RNK2_ETC_GG_ENDDE'] ||
        item['GNRL_RNK2_CRSPAREA_ENDDE'] ||
        ''

      // ===== status 판정 (B안: 1순위 결과 반영) =====
      // 1순위 결과 맵에서 단지별 마감 여부 조회
      const rank1Status = rank1StatusMap.get(no) || 'no_data'

      // 실제 접수 종료일 결정:
      //   - 1순위에서 모두 마감(sold_out): RCEPT_ENDDE(=1순위 종료일)까지만 접수중
      //   - 1순위 미달(has_short): 2순위 종료일까지 접수중
      //   - 데이터 없음(no_data, 발표 전): 2순위 종료일까지 접수중으로 가정 (보수적)
      //     ※ 발표 후에도 데이터가 안 들어오면 잘못 판정될 수 있으나, 그땐 사용자가 카드 눌러서 확인
      let realEndDate: string
      if (rank1Status === 'sold_out') {
        // 1순위 마감 → 1순위 종료일 기준
        realEndDate = pickLatestDate([rank1Endde, item['RCEPT_ENDDE'] || ''])
      } else {
        // has_short 또는 no_data → 2순위 종료일까지
        realEndDate = pickLatestDate([
          rank2Endde,
          rank1Endde,
          item['RCEPT_ENDDE'] || '',
        ])
      }

      return {
        id: no,
        name: item['HOUSE_NM'] || '단지명 없음',
        address: item['HSSPLY_ADRES'] || '',
        region: extractRegion(item['SUBSCRPT_AREA_CODE_NM'] || item['HSSPLY_ADRES'] || ''),
        type: item['HOUSE_SECD_NM'] || 'APT',
        totalUnits: item['TOT_SUPLY_HSHLDCO'] || '0',
        rceptBgnde: item['RCEPT_BGNDE'] || '',
        rceptEndde: item['RCEPT_ENDDE'] || '',
        // 특별공급 / 1순위 접수일 (정확한 공식 필드)
        spsplyRceptBgnde: spsplyBgnde,
        spsplyRceptEndde: spsplyEndde,
        rank1RceptBgnde: rank1Bgnde,
        rank1RceptEndde: rank1Endde,
        rank2RceptBgnde: rank2Bgnde,
        rank2RceptEndde: rank2Endde,
        rank1Status,  // 'sold_out' | 'has_short' | 'no_data' (1순위 결과 분류)
        przwnerPresnatnDe: item['PRZWNER_PRESNATN_DE'] || '',
        pblancDe: item['RCRIT_PBLANC_DE'] || '',
        status: getStatus(item['RCEPT_BGNDE'], realEndDate || item['RCEPT_ENDDE']),
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
  // 종료일은 그날 23:59:59까지 접수중으로 간주 (날짜만 들어와도 당일은 접수중)
  endDate.setHours(23, 59, 59, 999)
  if (now < startDate) return '접수예정'
  if (now > endDate) return '접수마감'
  return '접수중'
}

// 여러 날짜 중 가장 늦은 날짜를 반환 (빈 값/잘못된 값은 무시)
function pickLatestDate(dates: string[]): string {
  let latest = ''
  for (const d of dates) {
    if (!d) continue
    const trimmed = d.trim()
    if (!trimmed) continue
    if (!latest || trimmed > latest) latest = trimmed
  }
  return latest
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
