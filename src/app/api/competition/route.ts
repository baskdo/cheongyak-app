import { NextResponse } from 'next/server'

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
    const url = `${CMPET_URL}/getAPTLttotPblancCmpet?serviceKey=${encodeURIComponent(apiKey)}&page=${page}&perPage=100&returnType=JSON`
    const res = await fetch(url, { next: { revalidate: 1800 } })

    if (!res.ok) {
      console.error('competition API error:', res.status)
      return NextResponse.json(getDummyData())
    }

    const data = await res.json()
    const items: Record<string, string>[] = data?.data || []

    // 공고번호별로 그룹화
    const groupMap: Record<string, {
      pblancNo: string
      houseName: string
      houseTypes: { type: string; rate: string; reqCnt: string; suply: string; rank: string; reside: string }[]
      region: string
      rceptBgnde: string
      rceptEndde: string
    }> = {}

    items.forEach((item) => {
      const no = item['PBLANC_NO'] || ''
      const houseName = item['HOUSE_NM'] || ''
      const addr = item['HSSPLY_ADRES'] || ''
      if (!no) return

      if (!groupMap[no]) {
        groupMap[no] = {
          pblancNo: no,
          houseName,
          houseTypes: [],
          region: extractRegion(addr),
          rceptBgnde: item['RCEPT_BGNDE'] || '',
          rceptEndde: item['RCEPT_ENDDE'] || '',
        }
      }

      groupMap[no].houseTypes.push({
        type: item['HOUSE_TY'] || '',
        rate: item['CMPET_RATE'] || '',
        reqCnt: item['REQ_CNT'] || '0',
        suply: item['SUPLY_HSHLDCO'] || '0',
        rank: item['SUBSCRPT_RANK_CODE'] || '',
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

    return NextResponse.json({ items: results, total: data?.totalCount || 0 })
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
          { type: '084.9800A', rate: '312', reqCnt: '7488', suply: '24', rank: '1', reside: '해당지역' },
          { type: '114.9700A', rate: '189', reqCnt: '2835', suply: '15', rank: '1', reside: '해당지역' },
        ],
      },
      {
        pblancNo: 'D002',
        houseName: '디에이치 퍼스티어 아이파크',
        region: '서울',
        rceptBgnde: '2025-05-15',
        rceptEndde: '2025-05-17',
        houseTypes: [
          { type: '059.9800A', rate: '443', reqCnt: '10632', suply: '24', rank: '1', reside: '해당지역' },
          { type: '084.9700B', rate: '(△3)', reqCnt: '0', suply: '24', rank: '1', reside: '해당지역' },
        ],
      },
      {
        pblancNo: 'D003',
        houseName: '힐스테이트 동탄 레이크시티',
        region: '경기',
        rceptBgnde: '2025-04-20',
        rceptEndde: '2025-04-22',
        houseTypes: [
          { type: '074.0000A', rate: '28', reqCnt: '1568', suply: '56', rank: '1', reside: '해당지역' },
          { type: '084.9900A', rate: '15', reqCnt: '1050', suply: '70', rank: '1', reside: '해당지역' },
        ],
      },
    ],
    total: 3,
    isDummy: true,
  }
}
