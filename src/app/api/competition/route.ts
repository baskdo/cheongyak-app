import { NextResponse } from 'next/server'

const BASE_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'
const CMPET_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const keyword = searchParams.get('keyword') || ''
  const region = searchParams.get('region') || ''
  const page = searchParams.get('page') || '1'

  const apiKey = process.env.API_KEY
  if (!apiKey || apiKey === '여기에_API키_입력') {
    return NextResponse.json(getDummyData())
  }

  try {
    // 1. 경쟁률 데이터 가져오기
    const cmpetUrl = `${CMPET_URL}/getAPTLttotPblancCmpet?serviceKey=${encodeURIComponent(apiKey)}&page=${page}&perPage=200&returnType=JSON`
    const cmpetRes = await fetch(cmpetUrl, { next: { revalidate: 1800 } })
    if (!cmpetRes.ok) return NextResponse.json(getDummyData())

    const cmpetData = await cmpetRes.json()
    const cmpetItems: Record<string, string>[] = cmpetData?.data || []

    // 공고번호 목록 추출
    const pblancNos = [...new Set(cmpetItems.map(i => i['PBLANC_NO']).filter(Boolean))]

    // 2. 메인 공고 API에서 단지명/기간/주소 가져오기 (같은 페이지 기준)
    const detailUrl = `${BASE_URL}/getAPTLttotPblancDetail?serviceKey=${encodeURIComponent(apiKey)}&page=${page}&perPage=200&returnType=JSON`
    const detailRes = await fetch(detailUrl, { next: { revalidate: 1800 } })
    
    // 공고번호 → 단지정보 맵
    const detailMap: Record<string, { name: string; address: string; rceptBgnde: string; rceptEndde: string }> = {}
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

    // 3. 경쟁률 데이터를 공고번호별로 그룹화
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
      }[]
    }> = {}

    cmpetItems.forEach((item) => {
      const no = item['PBLANC_NO'] || ''
      if (!no) return

      const detail = detailMap[no]

      if (!groupMap[no]) {
        groupMap[no] = {
          pblancNo: no,
          houseName: detail?.name || `공고번호 ${no}`,
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
      })
    })

    let results = Object.values(groupMap)

    // 키워드 필터
    if (keyword) {
      results = results.filter(r => r.houseName.includes(keyword))
    }
    // 지역 필터
    if (region && region !== '전체') {
      results = results.filter(r => r.region === region)
    }

    return NextResponse.json({ items: results, total: cmpetData?.totalCount || 0 })
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
          { type: '084.9800A', rate: '189', reqCnt: '2835', suply: '15', rank: '1', reside: '해당지역' },
          { type: '084.9800A', rate: '95', reqCnt: '1425', suply: '15', rank: '2', reside: '해당지역' },
        ],
      },
      {
        pblancNo: 'D002',
        houseName: '힐스테이트 동탄 레이크시티',
        region: '경기',
        rceptBgnde: '2025-04-20',
        rceptEndde: '2025-04-22',
        houseTypes: [
          { type: '074.0000A', rate: '28', reqCnt: '1568', suply: '56', rank: '1', reside: '해당지역' },
          { type: '084.9900A', rate: '(△5)', reqCnt: '0', suply: '70', rank: '1', reside: '해당지역' },
        ],
      },
    ],
    total: 2,
    isDummy: true,
  }
}
