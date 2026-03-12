import { NextResponse } from 'next/server'
import { loadCSV } from '@/lib/csvLoader'

type HouseTypeRate = {
  type: string
  rate: string
  reqCnt: string
  suply: string
  rank: string
  reside: string
}

type CompetitionItem = {
  pblancNo: string
  houseName: string
  region: string
  rceptBgnde: string
  rceptEndde: string
  houseTypes: HouseTypeRate[]
}

function valuesOf(row: Record<string, string>): string[] {
  return Object.values(row)
}

function getByKeys(
  row: Record<string, string>,
  keys: string[],
  fallbackIndex?: number
): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key]
  }

  if (fallbackIndex !== undefined) {
    const vals = valuesOf(row)
    return vals[fallbackIndex] ?? ''
  }

  return ''
}

function normalizeRegionFromText(source: string): string {
  const text = (source || '').trim()

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
  if (text.includes('충북')) return '충북'
  if (text.includes('충남')) return '충남'
  if (text.includes('전북')) return '전북'
  if (text.includes('전남')) return '전남'
  if (text.includes('경북')) return '경북'
  if (text.includes('경남')) return '경남'
  if (text.includes('제주')) return '제주'

  return ''
}

function normalizeRegion(value: string, address = '', houseName = ''): string {
  // 1순위: 주소에서 직접 판별
  const fromAddress = normalizeRegionFromText(address)
  if (fromAddress) return fromAddress

  // 2순위: 텍스트 값이 숫자가 아니면 직접 판별
  const text = (value || '').trim()
  if (text && !/^\d+$/.test(text)) {
    const fromText = normalizeRegionFromText(text)
    if (fromText) return fromText
  }

  // 3순위: 단지명으로 보조 판별
  const fromHouseName = normalizeRegionFromText(houseName)
  if (fromHouseName) return fromHouseName

  return '기타'
}

function normalizeReside(value: string): string {
  const text = (value || '').trim()

  if (!text) return ''

  if (text === '해당지역' || text === '기타지역') return text

  if (
    text.includes('기타') ||
    text.includes('湲고') ||
    text.includes('湲') ||
    (text.includes('吏  뿭') && text.includes('湲'))
  ) {
    return '기타지역'
  }

  if (
    text.includes('해당') ||
    text.includes(' 빐') ||
    text.includes('빐') ||
    text.includes('떦') ||
    text.includes('吏  뿭') ||
    text.includes('當')
  ) {
    return '해당지역'
  }

  return text
}

function normalizeRank(value: string): string {
  const text = String(value || '').trim()

  if (text === '01' || text === '1') return '1'
  if (text === '02' || text === '2') return '2'
  if (text === '03' || text === '3') return '3'

  return text
}

function normalizeRate(value: string): string {
  const text = String(value || '').trim()
  if (!text) return '-'
  return text
}

function toYm(dateStr: string): string {
  const cleaned = (dateStr || '').replace(/[./]/g, '-')

  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}`
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned.slice(0, 7)
  }

  if (/^\d{4}-\d{2}$/.test(cleaned)) {
    return cleaned
  }

  return ''
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    const keyword = (searchParams.get('keyword') || '').trim()
    const region = (searchParams.get('region') || '').trim()
    const yearMonthFrom = (searchParams.get('yearMonthFrom') || '').trim()
    const yearMonthTo = (searchParams.get('yearMonthTo') || '').trim()

    const competitionRows = loadCSV('apt_competition_history.csv')
    const supplyRows = loadCSV('apt_supply_info.csv')

    const supplyMap = new Map<
      string,
      {
        houseName: string
        region: string
        address: string
        rceptBgnde: string
        rceptEndde: string
      }
    >()

    for (const row of supplyRows) {
      const houseManageNo = getByKeys(row, ['HOUSE_MANAGE_NO'], 0)
      const pblancNo = getByKeys(row, ['PBLANC_NO'], 1)
      const houseName = getByKeys(row, ['HOUSE_NM', 'HSSPLY_NM'], 2)
      const regionRaw = getByKeys(row, ['SUBSCRPT_AREA_CODE_NM', 'CNP_CD_NM'], 11)
      const address = getByKeys(row, ['HSSPLY_ADRES', 'ADRES'], 12)
      const rceptBgnde = getByKeys(row, ['RCEPT_BGNDE'], 15)
      const rceptEndde = getByKeys(row, ['RCEPT_ENDDE'], 16)

      const info = {
        houseName: houseName || '',
        region: normalizeRegion(regionRaw, address, houseName),
        address: address || '',
        rceptBgnde: rceptBgnde || '',
        rceptEndde: rceptEndde || '',
      }

      if (houseManageNo) supplyMap.set(houseManageNo, info)
      if (pblancNo) supplyMap.set(pblancNo, info)
    }

    const grouped = new Map<string, CompetitionItem>()

    for (const row of competitionRows) {
      const houseManageNo = getByKeys(row, ['HOUSE_MANAGE_NO'], 0)
      const pblancNo = getByKeys(row, ['PBLANC_NO'], 1)
      const modelNo = getByKeys(row, ['MODEL_NO'], 2)
      const houseType = getByKeys(row, ['HOUSE_TY'], 3)
      const suply = getByKeys(row, ['SUPLY_HSHLDCO'], 4)
      const rate = getByKeys(row, ['CMPET_RATE'], 5)
      const rank = getByKeys(row, ['SUBSCRPT_RANK_CODE'], 6)
      const reside = getByKeys(row, ['RESIDE_SENM'], 7)
      const reqCnt = getByKeys(row, ['REQ_CNT'], 8)

      const matchKey = pblancNo || houseManageNo
      if (!matchKey) continue

      const supplyInfo =
        supplyMap.get(pblancNo) ||
        supplyMap.get(houseManageNo) || {
          houseName: '',
          region: '기타',
          address: '',
          rceptBgnde: '',
          rceptEndde: '',
        }

      const houseName = supplyInfo.houseName || matchKey
      const rowRegion = normalizeRegion('', supplyInfo.address, houseName)
      const ym = toYm(supplyInfo.rceptBgnde)

      const keywordMatch = !keyword || houseName.includes(keyword)
      const regionMatch = !region || region === '전체' || rowRegion === region
      const fromMatch = !yearMonthFrom || (ym && ym >= yearMonthFrom)
      const toMatch = !yearMonthTo || (ym && ym <= yearMonthTo)

      if (!keywordMatch || !regionMatch || !fromMatch || !toMatch) {
        continue
      }

      if (!grouped.has(matchKey)) {
        grouped.set(matchKey, {
          pblancNo: matchKey,
          houseName,
          region: rowRegion,
          rceptBgnde: supplyInfo.rceptBgnde,
          rceptEndde: supplyInfo.rceptEndde,
          houseTypes: [],
        })
      }

      grouped.get(matchKey)!.houseTypes.push({
        type: houseType || modelNo || '',
        rate: normalizeRate(rate),
        reqCnt: reqCnt || '0',
        suply: suply || '0',
        rank: normalizeRank(rank),
        reside: normalizeReside(reside),
      })
    }

    const items = Array.from(grouped.values()).sort((a, b) =>
      (b.rceptBgnde || '').localeCompare(a.rceptBgnde || '')
    )

    return NextResponse.json({
      items,
      total: items.length,
    })
  } catch (error) {
    console.error('[competition GET] error:', error)

    return NextResponse.json({
      items: [],
      total: 0,
      error: String(error),
    })
  }
}