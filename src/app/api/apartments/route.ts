import { NextResponse } from 'next/server'

const BASE_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = searchParams.get('page') || '1'
  const perPage = searchParams.get('perPage') || '20'

  const apiKey = process.env.API_KEY
  if (!apiKey || apiKey === '여기에_API키_입력') {
    // API 키가 없으면 더미 데이터 반환 (개발/테스트용)
    return NextResponse.json(getDummyData())
  }

  try {
    const url = `${BASE_URL}/getAPTLttotPblancDetail?serviceKey=${encodeURIComponent(apiKey)}&page=${page}&perPage=${perPage}&returnType=JSON`
    const res = await fetch(url, { next: { revalidate: 3600 } }) // 1시간 캐시

    if (!res.ok) {
      console.error('API error:', res.status)
      return NextResponse.json(getDummyData())
    }

    const data = await res.json()
    const items = data?.data || []

    const transformed = items.map((item: Record<string, string>) => ({
      id: item['PBLANC_NO'] || String(Math.random()),
      name: item['HOUSE_NM'] || '단지명 없음',
      address: item['HSSPLY_ADRES'] || '',
      region: extractRegion(item['HSSPLY_ADRES'] || ''),
      type: item['HOUSE_SECD_NM'] || 'APT',
      totalUnits: item['TOT_SUPLY_HSHLDCO'] || '0',
      rceptBgnde: item['RCEPT_BGNDE'] || '',
      rceptEndde: item['RCEPT_ENDDE'] || '',
      przwnerPresnatnDe: item['PRZWNER_PRESNATN_DE'] || '',
      pblancDe: item['PBLANC_DE'] || '',
      status: getStatus(item['RCEPT_BGNDE'], item['RCEPT_ENDDE']),
      hompageUrl: item['HMPG_ADRES'] || 'https://www.applyhome.co.kr',
    }))

    return NextResponse.json({ items: transformed, total: data?.totalCount || 0 })
  } catch (error) {
    console.error('Fetch error:', error)
    return NextResponse.json(getDummyData())
  }
}

function extractRegion(address: string): string {
  const regions: Record<string, string> = {
    '서울': '서울', '경기': '경기', '인천': '인천', '부산': '부산',
    '대구': '대구', '광주': '광주', '대전': '대전', '울산': '울산',
    '세종': '세종', '강원': '강원', '충북': '충북', '충남': '충남',
    '전북': '전북', '전남': '전남', '경북': '경북', '경남': '경남', '제주': '제주',
  }
  for (const [key, val] of Object.entries(regions)) {
    if (address.includes(key)) return val
  }
  return '기타'
}

function getStatus(start: string, end: string): string {
  if (!start || !end) return '접수예정'
  const now = new Date()
  const startDate = parseDate(start)
  const endDate = parseDate(end)
  if (now < startDate) return '접수예정'
  if (now > endDate) return '접수마감'
  return '접수중'
}

function parseDate(dateStr: string): Date {
  if (dateStr.includes('-')) return new Date(dateStr)
  // YYYYMMDD 포맷 처리
  const y = dateStr.substring(0, 4)
  const m = dateStr.substring(4, 6)
  const d = dateStr.substring(6, 8)
  return new Date(`${y}-${m}-${d}`)
}

function getDummyData() {
  return {
    items: [
      {
        id: '1',
        name: '래미안 엘라비네',
        address: '서울특별시 강서구 방화동 608-97번지 일대',
        region: '서울',
        type: 'APT',
        totalUnits: '272',
        rceptBgnde: '20250316',
        rceptEndde: '20250319',
        przwnerPresnatnDe: '20250325',
        pblancDe: '20250306',
        status: '접수예정',
        hompageUrl: 'https://www.applyhome.co.kr',
      },
      {
        id: '2',
        name: '마곡지구 17단지 토지임대부(본청약)',
        address: '서울특별시 강서구 마곡동 747-1, 마곡지구 17단지',
        region: '서울',
        type: 'APT',
        totalUnits: '381',
        rceptBgnde: '20250312',
        rceptEndde: '20250318',
        przwnerPresnatnDe: '20250402',
        pblancDe: '20250227',
        status: '접수중',
        hompageUrl: 'https://www.applyhome.co.kr',
      },
      {
        id: '3',
        name: '해링턴플레이스 노원 센트럴',
        address: '서울특별시 노원구 노원로 495 (상계동 690)',
        region: '서울',
        type: 'APT',
        totalUnits: '61',
        rceptBgnde: '20250303',
        rceptEndde: '20250306',
        przwnerPresnatnDe: '20250312',
        pblancDe: '20250220',
        status: '접수마감',
        hompageUrl: 'https://www.applyhome.co.kr',
      },
      {
        id: '4',
        name: '힐스테이트 동탄 레이크시티',
        address: '경기도 화성시 동탄2신도시 A-79블록',
        region: '경기',
        type: 'APT',
        totalUnits: '534',
        rceptBgnde: '20250318',
        rceptEndde: '20250321',
        przwnerPresnatnDe: '20250328',
        pblancDe: '20250308',
        status: '접수예정',
        hompageUrl: 'https://www.applyhome.co.kr',
      },
      {
        id: '5',
        name: '검단 푸르지오 더파크',
        address: '인천광역시 서구 검단신도시 AA13블록',
        region: '인천',
        type: 'APT',
        totalUnits: '892',
        rceptBgnde: '20250310',
        rceptEndde: '20250314',
        przwnerPresnatnDe: '20250321',
        pblancDe: '20250228',
        status: '접수중',
        hompageUrl: 'https://www.applyhome.co.kr',
      },
      {
        id: '6',
        name: '부산 에코델타시티 2단지',
        address: '부산광역시 강서구 에코델타시티 2-1블록',
        region: '부산',
        type: 'APT',
        totalUnits: '440',
        rceptBgnde: '20250301',
        rceptEndde: '20250305',
        przwnerPresnatnDe: '20250315',
        pblancDe: '20250219',
        status: '접수마감',
        hompageUrl: 'https://www.applyhome.co.kr',
      },
    ],
    total: 6,
    isDummy: true,
  }
}
