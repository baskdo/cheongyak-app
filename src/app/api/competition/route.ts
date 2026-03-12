import { NextResponse } from 'next/server'

const CMPET_SVC = 'https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1'
const DETAIL_SVC = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const keyword = searchParams.get('keyword') || ''
  const region = searchParams.get('region') || ''
  const page = searchParams.get('page') || '1'

  const apiKey2 = process.env.API_KEY2
  const apiKey1 = process.env.API_KEY

  if (!apiKey2) {
    return NextResponse.json(getDummyData())
  }

  try {
    const enc2 = encodeURIComponent(apiKey2)
    const enc1 = apiKey1 ? encodeURIComponent(apiKey1) : ''

    // 1. 경쟁률(1·2순위) + 특별공급 신청현황 병렬 호출
    const [cmpetRes, spsplyRes] = await Promise.all([
      fetch(`${CMPET_SVC}/getAPTLttotPblancCmpet?serviceKey=${enc2}&page=${page}&perPage=200&returnType=JSON`, { next: { revalidate: 900 } }),
      fetch(`${CMPET_SVC}/getAPTSpsplyReqstStus?serviceKey=${enc2}&page=${page}&perPage=200&returnType=JSON`, { next: { revalidate: 900 } }),
    ])

    if (!cmpetRes.ok) return NextResponse.json(getDummyData())

    const cmpetData = await cmpetRes.json()
    const spsplyData = spsplyRes.ok ? await spsplyRes.json() : null

    const cmpetItems: Record<string, string>[] = cmpetData?.data || []
    const spsplyItems: Record<string, string>[] = spsplyData?.data || []

    // 공고번호 목록
    const pblancNos = Array.from(new Set(cmpetItems.map(i => i['PBLANC_NO']).filter(Boolean)))

    // 2. 공고 상세 API에서 단지명/주소/기간 가져오기 (API_KEY1 사용)
    const detailMap: Record<string, { name: string; address: string; rceptBgnde: string; rceptEndde: string }> = {}

    if (enc1 && pblancNos.length > 0) {
      // 공고번호로 직접 조회 시도
      try {
        const detailRes = await fetch(
          `${DETAIL_SVC}/getAPTLttotPblancDetail?serviceKey=${enc1}&page=1&perPage=500&returnType=JSON`,
          { next: { revalidate: 900 } }
        )
        if (detailRes.ok) {
          const detailData = await detailRes.json()
          const detailItems: Record<string, string>[] = detailData?.data || []
          detailItems.forEach(d => {
            const no = d['PBLANC_NO']
            if (!no) return
            detailMap[no] = {
              name: d['HOUSE_NM'] || '',
              address: d['HSSPLY_ADRES'] || '',
              rceptBgnde: d['RCEPT_BGNDE'] || '',
              rceptEndde: d['RCEPT_ENDDE'] || '',
            }
          })
        }
      } catch (e) { /* 실패해도 계속 진행 */ }
    }

    // 특별공급 데이터를 공고번호+주택형으로 맵핑
    const spsplyMap: Record<string, Record<string, string>> = {}
    spsplyItems.forEach(item => {
      const key = `${item['PBLANC_NO']}_${(item['HOUSE_TY'] || '').trim()}`
      spsplyMap[key] = item
    })

    // 3. 경쟁률 데이터 공고번호별 그룹화
    const groupMap: Record<string, {
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
        spsply?: Record<string, string>
      }[]
    }> = {}

    cmpetItems.forEach((item) => {
      const no = item['PBLANC_NO'] || ''
      if (!no) return
      const detail = detailMap[no]
      const typeKey = `${no}_${(item['HOUSE_TY'] || '').trim()}`

      if (!groupMap[no]) {
        groupMap[no] = {
          pblancNo: no,
          houseName: detail?.name || '',
          region: extractRegion(detail?.address || ''),
          rceptBgnde: detail?.rceptBgnde || '',
          rceptEndde: detail?.rceptEndde || '',
          houseTypes: [],
        }
      }

      groupMap[no].houseTypes.push({
        type: item['HOUSE_TY'] || '',
        rate: item['CMPET_RATE'] || '',
        reqCnt: item['REQ_CNT'] || '0',
        suply: String(item['SUPLY_HSHLDCO'] || '0'),
        rank: String(item['SUBSCRPT_RANK_CODE'] || ''),
        reside: item['RESIDE_SENM'] || '',
        spsply: spsplyMap[typeKey],
      })
    })

    let results = Object.values(groupMap)

    if (keyword) results = results.filter(r => r.houseName.includes(keyword))
    if (region && region !== '전체') results = results.filter(r => r.region === region)

    return NextResponse.json({
      items: results,
      total: cmpetData?.totalCount || 0,
    })
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
          { type: '084.9800A', rate: '189', reqCnt: '2835', suply: '15', rank: '1', reside: '해당지역',
            spsply: { MNYCH_HSHLDCO: '2', NWWDS_NMTW_HSHLDCO: '3', LFE_FRST_HSHLDCO: '2',
              CRSPAREA_MNYCH_CNT: '45', CRSPAREA_NWWDS_NMTW_CNT: '120', CRSPAREA_LFE_FRST_CNT: '88' }
          },
        ],
      },
    ],
    total: 1,
    isDummy: true,
  }
}
