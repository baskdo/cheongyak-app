import { NextResponse } from 'next/server'

const BASE_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = searchParams.get('page') || '1'
  const perPage = searchParams.get('perPage') || '20'

  const apiKey = process.env.API_KEY
  if (!apiKey || apiKey === '여기에_API키_입력') {
    return NextResponse.json(getDummyData())
  }

  try {
    // 메인 공고 API
    const url = `${BASE_URL}/getAPTLttotPblancDetail?serviceKey=${encodeURIComponent(apiKey)}&page=${page}&perPage=${perPage}&returnType=JSON`
    const res = await fetch(url, { next: { revalidate: 3600 } })

    if (!res.ok) {
      console.error('API error:', res.status)
      return NextResponse.json(getDummyData())
    }

    const data = await res.json()
    const items = data?.data || []

    // 주택형+분양가 API
    let typeMap: Record<string, { houseTypes: string; minPrice: string; maxPrice: string }> = {}
    try {
      const typeUrl = `${BASE_URL}/getAPTLttotPblancMdl?serviceKey=${encodeURIComponent(apiKey)}&page=${page}&perPage=100&returnType=JSON`
      const typeRes = await fetch(typeUrl, { next: { revalidate: 3600 } })
      if (typeRes.ok) {
        const typeData = await typeRes.json()
        const typeItems: Record<string, string>[] = typeData?.data || []
        typeItems.forEach((t) => {
          const no = t['PBLANC_NO']
          if (!no) return
          if (!typeMap[no]) typeMap[no] = { houseTypes: '', minPrice: '', maxPrice: '' }
          const ty = t['HOUSE_TY'] || ''
          if (ty && !typeMap[no].houseTypes.includes(ty)) {
            typeMap[no].houseTypes = typeMap[no].houseTypes ? typeMap[no].houseTypes + ', ' + ty : ty
          }
          const price = parseInt(t['LTTOT_TOP_AMOUNT'] || '0')
          if (price > 0) {
            const curMin = typeMap[no].minPrice ? parseInt(typeMap[no].minPrice) : Infinity
            const curMax = typeMap[no].maxPrice ? parseInt(typeMap[no].maxPrice) : 0
            if (price < curMin) typeMap[no].minPrice = String(price)
            if (price > curMax) typeMap[no].maxPrice = String(price)
          }
        })
      }
    } catch (e) {
      console.error('type API error:', e)
    }

    const transformed = items.map((item: Record<string, string>) => {
      const no = item['PBLANC_NO'] || String(Math.random())
      const typeInfo = typeMap[no] || { houseTypes: '', minPrice: '', maxPrice: '' }
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
      }
    })

    return NextResponse.json({ items: transformed, total: data?.totalCount || 0 })
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
      },
    ],
    total: 1,
    isDummy: true,
  }
}
