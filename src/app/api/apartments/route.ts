import { NextResponse } from 'next/server'
import { loadCSV, pick } from '@/lib/csvLoader'

function normalizeRegion(value: string): string {
  if (!value) return '기타'
  const text = value.trim()

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

  return text
}

function determineStatus(start: string, end: string): '접수예정' | '접수중' | '접수마감' {
  const today = new Date()
  const now = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

  const s = (start || '').replace(/[-./]/g, '')
  const e = (end || '').replace(/[-./]/g, '')

  if (!s || !e) return '접수마감'
  if (now < s) return '접수예정'
  if (now > e) return '접수마감'
  return '접수중'
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const perPage = Number(searchParams.get('perPage') || '30')

    const supplyRows = loadCSV('apt_supply_info.csv')
    const houseTypeRows = loadCSV('apt_house_type_info.csv')

    console.log('[apartments] supplyRows:', supplyRows.length)
    console.log('[apartments] houseTypeRows:', houseTypeRows.length)

    const houseTypeMap = new Map<string, string[]>()

    for (const row of houseTypeRows) {
      const key = pick(row, ['HOUSE_MANAGE_NO', 'PBLANC_NO'])
      const typeValue = pick(row, ['HOUSE_TY', 'MODEL_NO', 'SUPLY_AR'])

      if (!key || !typeValue) continue

      if (!houseTypeMap.has(key)) houseTypeMap.set(key, [])
      const arr = houseTypeMap.get(key)!
      if (!arr.includes(typeValue)) arr.push(typeValue)
    }

    const items = supplyRows.map((r, idx) => {
      const id = pick(r, ['HOUSE_MANAGE_NO', 'PBLANC_NO']) || String(idx)
      const houseTypes = houseTypeMap.get(id) || []

      const name = pick(r, ['HOUSE_NM', 'HSSPLY_NM'])
      const address = pick(r, ['HSSPLY_ADRES', 'ADRES'])
      const regionRaw = pick(r, ['SUBSCRPT_AREA_CODE_NM', 'CNP_CD_NM', 'HSSPLY_ADRES'])
      const type = pick(r, ['HOUSE_SECD_NM', 'HOUSE_SECD']) || 'APT'
      const totalUnits = pick(r, ['TOT_SUPLY_HSHLDCO']) || '0'
      const rceptBgnde = pick(r, ['RCEPT_BGNDE'])
      const rceptEndde = pick(r, ['RCEPT_ENDDE'])
      const przwnerPresnatnDe = pick(r, ['PRZWNER_PRESNATN_DE'])
      const pblancDe = pick(r, ['PBLANC_DE'])
      const hompageUrl = pick(r, ['HMPG_ADRES'])
      const constructor = pick(r, ['BSNS_MBY_NM', 'CNSTRCT_ENTRPS_NM'])
      const moveInDate = pick(r, ['MVIN_PREDT_YM'])
      const pdfUrl = pick(r, ['PBLANC_URL'])
      const minPrice = pick(r, ['MIN_PRICE', 'LWMN_HOUSE_DTL_AMOUNT'])
      const maxPrice = pick(r, ['MAX_PRICE', 'TOP_HOUSE_DTL_AMOUNT'])

      return {
        id,
        name,
        address,
        region: normalizeRegion(regionRaw),
        type,
        totalUnits,
        rceptBgnde,
        rceptEndde,
        przwnerPresnatnDe,
        pblancDe,
        status: determineStatus(rceptBgnde, rceptEndde),
        hompageUrl,
        constructor,
        moveInDate,
        pdfUrl,
        minPrice,
        maxPrice,
        houseTypes: houseTypes.join(','),
        cmpetRate: '',
      }
    }).filter(item => item.name)

    items.sort((a, b) => (b.pblancDe || '').localeCompare(a.pblancDe || ''))

    console.log('[apartments] final items:', items.length)
    console.log('[apartments] sample:', items[0])

    return NextResponse.json({
      items: items.slice(0, perPage),
      isDummy: false,
    })
  } catch (error) {
    console.error('[apartments GET] error:', error)
    return NextResponse.json({
      items: [],
      isDummy: true,
      error: String(error),
    })
  }
}