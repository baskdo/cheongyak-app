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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const keyword = (searchParams.get('keyword') || '').trim()
  const region = (searchParams.get('region') || '').trim()
  const page = Number(searchParams.get('page') || '1')
  const perPage = Number(searchParams.get('perPage') || '200')

  const apiKey2 = process.env.API_KEY2
  const apiKey1 = process.env.API_KEY

  if (!apiKey2) {
    return NextResponse.json(getDummyData())
  }

  try {
    const enc2 = encodeURIComponent(apiKey2)
    const enc1 = apiKey1 ? encodeURIComponent(apiKey1) : ''

    // 1) 경쟁률 + 특별공급 현황
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

    // 공고번호 수집
    const pblancNos = Array.from(
      new Set(
        cmpetItems
          .map((i) => (i['PBLANC_NO'] || '').trim())
          .filter(Boolean)
      )
    )

    // 2) 공고 상세를 필요한 공고번호가 채워질 때까지 페이지 반복 조회
    const detailMap: Record<string, DetailInfo> =
      enc1 && pblancNos.length > 0 ? await fetchDetailMap(enc1, pblancNos) : {}

    // 3) 특별공급 맵
    const spsplyMap: Record<string, Row> = {}
    for (const item of spsplyItems) {
      const no = (item['PBLANC_NO'] || '').trim()
      const houseTy = normalizeHouseType(item['HOUSE_TY'] || '')
      if (!no) continue
      spsplyMap[`${no}_${houseTy}`] = item
    }

    // 4) 경쟁률 그룹화
    const groupMap: Record<
      string,
      {
        pblancNo: string
        houseName: string
        region: string
        rceptBgnde: string
        rceptEndde: string
        houseTypes: {
          type: string
          rate: string
          reqCnt: string
          suply: string
          rank: string
          reside: string
          spsply?: Row
        }[]
      }
    > = {}

    for (const item of cmpetItems) {
      const no = (item['PBLANC_NO'] || '').trim()
      if (!no) continue

      const detail = detailMap[no]
      const houseType = item['HOUSE_TY'] || ''
      const typeKey = `${no}_${normalizeHouseType(houseType)}`

      if (!groupMap[no]) {
        const inferredRegion =
          detail?.region ||
          extractRegion(detail?.address || '') ||
          extractRegion(item['RESIDE_SENM'] || '') ||
          '기타'

        groupMap[no] = {
          pblancNo: no,
          houseName:
            detail?.name ||
            item['HOUSE_NM'] || // 혹시 경쟁률 응답에 있을 경우 대비
            '',
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
    }

    let results = Object.values(groupMap)

    if (keyword) {
      results = results.filter((r) => r.houseName.includes(keyword))
    }

    if (region && region !== '전체') {
      results = results.filter((r) => normalizeRegion(r.region) === normalizeRegion(region))
    }

    return NextResponse.json({
      items: results,
      total: cmpetData?.totalCount || results.length,
    })
  } catch (error) {
    console.error('Fetch error:', error)
    return NextResponse.json(getDummyData())
  }
}

/**
 * 상세 API를 여러 페이지 순회하며 필요한 PBLANC_NO가 모두 채워질 때까지 가져옴
 */
async function fetchDetailMap(
  encServiceKey: string,
  targetPblancNos: string[]
): Promise<Record<string, DetailInfo>> {
  const detailMap: Record<string, DetailInfo> = {}
  const targetSet = new Set(targetPblancNos)

  let currentPage = 1
  const perPage = 500
  const maxPages = 20 // 과도한 호출 방지

  while (currentPage <= maxPages) {
    const res = await fetch(
      `${DETAIL_SVC}/getAPTLttotPblancDetail?serviceKey=${encServiceKey}&page=${currentPage}&perPage=${perPage}&returnType=JSON`,
      { next: { revalidate: 900 } }
    )

    if (!res.ok) break

    const json = await res.json()
    const items: Row[] = Array.isArray(json?.data) ? json.data : []
    if (items.length === 0) break

    for (const d of items) {
      const no = (d['PBLANC_NO'] || '').trim()
      if (!no || !targetSet.has(no)) continue
      if (detailMap[no]) continue

      const address = d['HSSPLY_ADRES'] || d['HOUSE_DTL_ADRES'] || ''
      const regionText =
        d['SUBSCRPT_AREA_CODE_NM'] ||
        d['CTPV_NM'] ||
        d['GUGUN_NM'] ||
        address

      detailMap[no] = {
        name: d['HOUSE_NM'] || '',
        address,
        region: extractRegion(regionText),
        rceptBgnde: d['RCEPT_BGNDE'] || '',
        rceptEndde: d['RCEPT_ENDDE'] || '',
      }
    }

    // 필요한 공고번호를 다 채웠으면 종료
    const resolvedCount = targetPblancNos.filter((no) => !!detailMap[no]).length
    if (resolvedCount === targetPblancNos.length) break

    // 마지막 페이지 추정
    if (items.length < perPage) break

    currentPage += 1
  }

  return detailMap
}

function normalizeHouseType(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase()
}

function normalizeRegion(value: string): string {
  return extractRegion(value)
}

function extractRegion(text: string): string {
  if (!text) return '기타'

  const normalized = text.replace(/\s+/g, '')

  const regions: [string[], string][] = [
    [['서울특별시', '서울'], '서울'],
    [['경기도', '경기'], '경기'],
    [['인천광역시', '인천'], '인천'],
    [['부산광역시', '부산'], '부산'],
    [['대구광역시', '대구'], '대구'],
    [['광주광역시', '광주'], '광주'],
    [['대전광역시', '대전'], '대전'],
    [['울산광역시', '울산'], '울산'],
    [['세종특별자치시', '세종'], '세종'],
    [['강원특별자치도', '강원도', '강원'], '강원'],
    [['충청북도', '충북'], '충북'],
    [['충청남도', '충남'], '충남'],
    [['전북특별자치도', '전라북도', '전북'], '전북'],
    [['전라남도', '전남'], '전남'],
    [['경상북도', '경북'], '경북'],
    [['경상남도', '경남'], '경남'],
    [['제주특별자치도', '제주도', '제주'], '제주'],
  ]

  for (const [aliases, label] of regions) {
    if (aliases.some((alias) => normalized.includes(alias))) {
      return label
    }
  }

  return '기타'
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