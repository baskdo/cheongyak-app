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
  const perPage = Number(searchParams.get('perPage') || '200')
  const samePeriod = searchParams.get('samePeriod') === 'true'
  const startDate = (searchParams.get('startDate') || '').trim()
  const endDate = (searchParams.get('endDate') || '').trim()

  const apiKey2 = process.env.API_KEY2
  const apiKey1 = process.env.API_KEY

  if (!apiKey2) {
    return NextResponse.json(getDummyData())
  }

  try {
    const enc2 = encodeURIComponent(apiKey2)
    const enc1 = apiKey1 ? encodeURIComponent(apiKey1) : ''

    // 1) 실시간 경쟁률 + 특별공급 신청현황
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

    // Set 스프레드 대신 Array.from 사용
    const pblancNos = Array.from(
      new Set(
        cmpetItems
          .map((item) => (item['PBLANC_NO'] || '').trim())
          .filter(Boolean)
      )
    )

    // 2) 상세 API 조회해서 단지명/주소/기간 보강
    const detailMap: Record<string, DetailInfo> =
      enc1 && pblancNos.length > 0 ? await fetchDetailMap(enc1, pblancNos) : {}

    // 3) 특별공급 데이터 맵핑 (공고번호 + 주택형)
    const spsplyMap: Record<string, Row> = {}
    spsplyItems.forEach((item) => {
      const no = (item['PBLANC_NO'] || '').trim()
      const houseTy = normalizeHouseType(item['HOUSE_TY'] || '')
      if (!no) return
      spsplyMap[`${no}_${houseTy}`] = item
    })

    // 4) 경쟁률 데이터 그룹화
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

    if (keyword) {
      results = results.filter((r) => r.houseName.includes(keyword))
    }

    if (region && region !== '전체') {
      results = results.filter((r) => normalizeRegion(r.region) === normalizeRegion(region))
    }

    // 명시적 기간 필터
    if (startDate || endDate) {
      results = results.filter((r) => {
        const bg = normalizeDate(r.rceptBgnde)
        const ed = normalizeDate(r.rceptEndde)

        if (!bg || !ed) return false

        if (startDate && endDate) {
          return isOverlapped(bg, ed, normalizeDate(startDate), normalizeDate(endDate))
        }

        if (startDate) {
          return isDateInRange(normalizeDate(startDate), bg, ed)
        }

        if (endDate) {
          return isDateInRange(normalizeDate(endDate), bg, ed)
        }

        return true
      })
    }

    // 같은 시기 단지 자동 확장
    if (samePeriod && results.length > 0) {
      const base = results.find((r) => r.rceptBgnde && r.rceptEndde)

      if (base) {
        const baseStart = normalizeDate(base.rceptBgnde)
        const baseEnd = normalizeDate(base.rceptEndde)

        results = Object.values(groupMap).filter((r) => {
          const bg = normalizeDate(r.rceptBgnde)
          const ed = normalizeDate(r.rceptEndde)

          const matchedRegion =
            !region || region === '전체'
              ? true
              : normalizeRegion(r.region) === normalizeRegion(region)

          return matchedRegion && isOverlapped(bg, ed, baseStart, baseEnd)
        })
      }
    }

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

function isDateInRange(target: string, start: string, end: string): boolean {
  if (!target || !start || !end) return false
  return start <= target && target <= end
}

function isOverlapped(start1: string, end1: string, start2: string, end2: string): boolean {
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