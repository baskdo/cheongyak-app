import { NextResponse } from 'next/server'

const CMPET_SVC = 'https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1'
const DETAIL_SVC = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'

type Row = Record<string, string>

type DetailInfo = {
  name: string
  address: string
  region: string
  rceptBgnde: string
  rceptEndde: string
}

type HouseTypeItem = {
  type: string
  rate: string
  reqCnt: string
  suply: string
  rank: string
  reside: string
  spsply?: Row
}

type GroupItem = {
  pblancNo: string
  houseName: string
  region: string
  rceptBgnde: string
  rceptEndde: string
  houseTypes: HouseTypeItem[]
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const keyword = (searchParams.get('keyword') || '').trim()
  const region = (searchParams.get('region') || '').trim()
  const page = Number(searchParams.get('page') || '1')
  const perPage = Number(searchParams.get('perPage') || '300')

  // page.tsx에서 전달하는 월 단위 조회범위
  const yearMonthFrom = (searchParams.get('yearMonthFrom') || '').trim()
  const yearMonthTo = (searchParams.get('yearMonthTo') || '').trim()

  const apiKey2 = process.env.API_KEY2
  const apiKey1 = process.env.API_KEY

  if (!apiKey2) {
    return NextResponse.json(getDummyData())
  }

  try {
    const enc2 = encodeURIComponent(apiKey2)
    const enc1 = apiKey1 ? encodeURIComponent(apiKey1) : ''

    const [cmpetRes, spsplyRes] = await Promise.all([
      fetch(
        `${CMPET_SVC}/getAPTLttotPblancCmpet?serviceKey=${enc2}&page=${page}&perPage=${perPage}&returnType=JSON`,
        { next: { revalidate: 900 } }
      ),
      fetch(
        `${CMPET_SVC}/getAPTSpsplyReqstStus?serviceKey=${enc2}&page=${page}&perPage=${perPage}&returnType=JSON`,
        { next: { revalidate: 900 } }
      ),
    ])

    if (!cmpetRes.ok) {
      return NextResponse.json(getDummyData())
    }

    const cmpetData = await cmpetRes.json()
    const spsplyData = spsplyRes.ok ? await spsplyRes.json() : null

    const cmpetItems: Row[] = Array.isArray(cmpetData?.data) ? cmpetData.data : []
    const spsplyItems: Row[] = Array.isArray(spsplyData?.data) ? spsplyData.data : []

    const pblancNos = Array.from(
      new Set(
        cmpetItems
          .map((item) => (item['PBLANC_NO'] || '').trim())
          .filter(Boolean)
      )
    )

    const detailMap: Record<string, DetailInfo> =
      enc1 && pblancNos.length > 0 ? await fetchDetailMap(enc1, pblancNos) : {}

    const spsplyMap: Record<string, Row> = {}
    spsplyItems.forEach((item) => {
      const no = (item['PBLANC_NO'] || '').trim()
      const houseTy = normalizeHouseType(item['HOUSE_TY'] || '')
      if (!no) return
      spsplyMap[`${no}_${houseTy}`] = item
    })

    const groupMap: Record<string, GroupItem> = {}

    cmpetItems.forEach((item) => {
      const no = (item['PBLANC_NO'] || '').trim()
      if (!no) return

      const detail = detailMap[no]
      const houseType = item['HOUSE_TY'] || ''
      const typeKey = `${no}_${normalizeHouseType(houseType)}`

      const inferredRegion =
        normalizeRegion(detail?.region || '') !== '기타'
          ? normalizeRegion(detail?.region || '')
          : normalizeRegion(detail?.address || '') !== '기타'
            ? normalizeRegion(detail?.address || '')
            : normalizeRegion(item['RESIDE_SENM'] || '')

      if (!groupMap[no]) {
        groupMap[no] = {
          pblancNo: no,
          houseName: detail?.name || item['HOUSE_NM'] || '',
          region: inferredRegion,
          rceptBgnde: detail?.rceptBgnde || '',
          rceptEndde: detail?.rceptEndde || '',
          houseTypes: [],
        }
      }

      groupMap[no].houseTypes.push({
        type: houseType,
        rate: item['CMPET_RATE'] || '',
        reqCnt: item['REQ_CNT'] || '0',
        suply: String(item['SUPLY_HSHLDCO'] || '0'),
        rank: String(item['SUBSCRPT_RANK_CODE'] || ''),
        reside: item['RESIDE_SENM'] || '',
        spsply: spsplyMap[typeKey],
      })
    })

    let results = Object.values(groupMap)

    // 1) 월 단위 기간 필터
    if (yearMonthFrom || yearMonthTo) {
      results = results.filter((r) => {
        const bg = normalizeYearMonth(r.rceptBgnde)
        const ed = normalizeYearMonth(r.rceptEndde)

        if (!bg || !ed) return false

        const from = yearMonthFrom || bg
        const to = yearMonthTo || ed

        return isMonthOverlapped(bg, ed, from, to)
      })
    }

    // 2) 키워드 필터
    if (keyword) {
      results = results.filter((r) => r.houseName.includes(keyword))
    }

    // 3) 지역 필터
    if (region && region !== '전체') {
      results = results.filter((r) => normalizeRegion(r.region) === normalizeRegion(region))
    }

    // 4) 최신 접수일 기준 내림차순
    results.sort((a, b) => {
      const aDate = normalizeDate(a.rceptBgnde)
      const bDate = normalizeDate(b.rceptBgnde)
      return bDate.localeCompare(aDate)
    })

    return NextResponse.json({
      items: results,
      total: results.length,
    })
  } catch (error) {
    console.error('competition fetch error:', error)
    return NextResponse.json(getDummyData())
  }
}

async function fetchDetailMap(
  encServiceKey: string,
  targetPblancNos: string[]
): Promise<Record<string, DetailInfo>> {
  const detailMap: Record<string, DetailInfo> = {}
  const targetSet = new Set(targetPblancNos)

  let currentPage = 1
  const perPage = 500
  const maxPages = 20

  while (currentPage <= maxPages) {
    const res = await fetch(
      `${DETAIL_SVC}/getAPTLttotPblancDetail?serviceKey=${encServiceKey}&page=${currentPage}&perPage=${perPage}&returnType=JSON`,
      { next: { revalidate: 900 } }
    )

    if (!res.ok) break

    const json = await res.json()
    const items: Row[] = Array.isArray(json?.data) ? json.data : []

    if (items.length === 0) break

    items.forEach((d) => {
      const no = (d['PBLANC_NO'] || '').trim()
      if (!no || !targetSet.has(no) || detailMap[no]) return

      const address = d['HSSPLY_ADRES'] || d['HOUSE_DTL_ADRES'] || ''
      const regionText =
        d['SUBSCRPT_AREA_CODE_NM'] ||
        d['CTPV_NM'] ||
        d['GUGUN_NM'] ||
        address

      detailMap[no] = {
        name: d['HOUSE_NM'] || '',
        address,
        region: normalizeRegion(regionText),
        rceptBgnde: d['RCEPT_BGNDE'] || '',
        rceptEndde: d['RCEPT_ENDDE'] || '',
      }
    })

    const resolvedCount = targetPblancNos.filter((no) => !!detailMap[no]).length
    if (resolvedCount === targetPblancNos.length) break

    if (items.length < perPage) break
    currentPage += 1
  }

  return detailMap
}

function normalizeHouseType(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase()
}

function normalizeRegion(value: string): string {
  if (!value) return '기타'

  const text = value.replace(/\s+/g, '')

  if (text.includes('서울')) return '서울'
  if (text.includes('경기')) return '경기'
  if (text.includes('인천')) return '인천'
  if (text.includes('부산')) return '부산'
  if (text.includes('대구')) return '대구'
  if (text.includes('광주')) return '광주'
  if (text.includes('대전')) return '대전'
  if (text.includes('울산')) return '울산'
  if (text.includes('세종')) return '세종'
  if (text.includes('강원')) return '강원'
  if (text.includes('충청북도') || text.includes('충북')) return '충북'
  if (text.includes('충청남도') || text.includes('충남')) return '충남'
  if (text.includes('전라북도') || text.includes('전북')) return '전북'
  if (text.includes('전라남도') || text.includes('전남')) return '전남'
  if (text.includes('경상북도') || text.includes('경북')) return '경북'
  if (text.includes('경상남도') || text.includes('경남')) return '경남'
  if (text.includes('제주')) return '제주'

  return '기타'
}

function normalizeDate(value: string): string {
  if (!value) return ''
  const onlyNum = value.replace(/[^\d]/g, '')
  if (onlyNum.length !== 8) return ''
  return `${onlyNum.slice(0, 4)}-${onlyNum.slice(4, 6)}-${onlyNum.slice(6, 8)}`
}

function normalizeYearMonth(value: string): string {
  if (!value) return ''
  const onlyNum = value.replace(/[^\d]/g, '')
  if (onlyNum.length < 6) return ''
  return `${onlyNum.slice(0, 4)}-${onlyNum.slice(4, 6)}`
}

function isMonthOverlapped(start1: string, end1: string, start2: string, end2: string): boolean {
  if (!start1 || !end1 || !start2 || !end2) return false
  return start1 <= end2 && start2 <= end1
}

function getDummyData() {
  return {
    items: [
      {
        pblancNo: 'D001',
        houseName: '래미안 원베일리',
        region: '서울',
        rceptBgnde: '2025-06-10',
        rceptEndde: '2025-06-12',
        houseTypes: [
          { type: '059.9900A', rate: '521', reqCnt: '12504', suply: '24', rank: '1', reside: '해당지역' },
          { type: '059.9900A', rate: '312', reqCnt: '7488', suply: '24', rank: '1', reside: '기타지역' },
          { type: '059.9900A', rate: '95', reqCnt: '2280', suply: '24', rank: '2', reside: '해당지역' },
          {
            type: '084.9800A',
            rate: '189',
            reqCnt: '2835',
            suply: '15',
            rank: '1',
            reside: '해당지역',
            spsply: {
              MNYCH_HSHLDCO: '2',
              NWWDS_NMTW_HSHLDCO: '3',
              LFE_FRST_HSHLDCO: '2',
              CRSPAREA_MNYCH_CNT: '45',
              CRSPAREA_NWWDS_NMTW_CNT: '120',
              CRSPAREA_LFE_FRST_CNT: '88',
            },
          },
        ],
      },
    ],
    total: 1,
    isDummy: true,
  }
}