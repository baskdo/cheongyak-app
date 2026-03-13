import { NextResponse } from 'next/server'

type CmpetRow = {
  HOUSE_MANAGE_NO?: string
  PBLANC_NO?: string
  HOUSE_NM?: string
  HOUSE_TY?: string
  SUPLY_HSHLDCO?: string | number
  REQ_CNT?: string | number
  CMPET_RATE?: string | number
  SUBSCRPT_RANK_CODE?: string | number
  RESIDE_SECD?: string | number
  RESIDE_SENM?: string
  RCEPT_BGNDE?: string
  RCEPT_ENDDE?: string
}

type SpsplyRow = {
  HOUSE_MANAGE_NO?: string
  PBLANC_NO?: string
  HOUSE_NM?: string
  HOUSE_TY?: string

  MNYCH_HSHLDCO?: string | number
  NWWDS_NMTW_HSHLDCO?: string | number
  LFE_FRST_HSHLDCO?: string | number
  NWBB_NWBBSHR_HSHLDCO?: string | number
  YGMN_HSHLDCO?: string | number
  OLD_PARNTS_SUPORT_HSHLDCO?: string | number

  CRSPAREA_MNYCH_CNT?: string | number
  CRSPAREA_NWWDS_NMTW_CNT?: string | number
  CRSPAREA_LFE_FRST_CNT?: string | number
  CRSPAREA_NWBB_NWBBSHR_CNT?: string | number
  CRSPAREA_YGMN_CNT?: string | number
  CRSPAREA_OPS_CNT?: string | number
}

type HouseTypeRate = {
  type: string
  rate: string
  reqCnt: string
  suply: string
  rank: string
  reside: string
  spsply?: Record<string, string>
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
  const fromAddress = normalizeRegionFromText(address)
  if (fromAddress) return fromAddress

  const text = (value || '').trim()
  if (text && !/^\d+$/.test(text)) {
    const fromText = normalizeRegionFromText(text)
    if (fromText) return fromText
  }

  const fromHouseName = normalizeRegionFromText(houseName)
  if (fromHouseName) return fromHouseName

  return '기타'
}

function normalizeRank(value: string | number | undefined): string {
  const text = String(value ?? '').trim()

  if (text === '00') return '3'
  if (text === '01' || text === '1') return '1'
  if (text === '02' || text === '2') return '2'
  if (text === '03' || text === '3') return '3'

  return text
}

function normalizeResideFromCode(code: string | number | undefined): string {
  const text = String(code ?? '').trim()

  if (text === '01') return '해당지역'
  if (text === '02') return '기타지역'
  if (text === '03') return '기타경기'

  return ''
}

function normalizeReside(name: string | undefined, code?: string | number): string {
  const text = (name || '').trim()

  if (!text) return normalizeResideFromCode(code)
  if (text === '해당지역' || text === '기타지역' || text === '기타경기') return text

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

function normalizeRate(
  rawRate: string | number | undefined,
  reqCnt: string | number | undefined,
  suply: string | number | undefined
): string {
  const text = String(rawRate ?? '').trim()
  if (text && text !== 'null' && text !== 'undefined') return text

  const req = Number(reqCnt || 0)
  const supply = Number(suply || 0)

  if (!supply) return '-'

  const rate = req / supply
  if (!Number.isFinite(rate)) return '-'

  return rate.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function parseDate(value: string | undefined): string {
  const text = (value || '').trim()
  if (!text) return ''

  const normalized = text.replace(/\./g, '-').replace(/\//g, '-')
  if (/^\d{8}$/.test(normalized)) {
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized

  return text
}

function toYm(dateStr: string): string {
  const cleaned = (dateStr || '').replace(/[./]/g, '-')

  if (/^\d{8}$/.test(cleaned)) return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned.slice(0, 7)
  if (/^\d{4}-\d{2}$/.test(cleaned)) return cleaned

  return ''
}

function toTypeKey(typeValue: string | undefined): string {
  return String(typeValue || '').trim()
}

function toItemKey(pblancNo: string, houseManageNo: string): string {
  return pblancNo || houseManageNo
}

function toSpsplyMap(row: SpsplyRow): Record<string, string> | undefined {
  const out: Record<string, string> = {
    MNYCH_HSHLDCO: String(row.MNYCH_HSHLDCO ?? '0'),
    NWWDS_NMTW_HSHLDCO: String(row.NWWDS_NMTW_HSHLDCO ?? '0'),
    LFE_FRST_HSHLDCO: String(row.LFE_FRST_HSHLDCO ?? '0'),
    NWBB_NWBBSHR_HSHLDCO: String(row.NWBB_NWBBSHR_HSHLDCO ?? '0'),
    YGMN_HSHLDCO: String(row.YGMN_HSHLDCO ?? '0'),
    OLD_PARNTS_SUPORT_HSHLDCO: String(row.OLD_PARNTS_SUPORT_HSHLDCO ?? '0'),

    CRSPAREA_MNYCH_CNT: String(row.CRSPAREA_MNYCH_CNT ?? '0'),
    CRSPAREA_NWWDS_NMTW_CNT: String(row.CRSPAREA_NWWDS_NMTW_CNT ?? '0'),
    CRSPAREA_LFE_FRST_CNT: String(row.CRSPAREA_LFE_FRST_CNT ?? '0'),
    CRSPAREA_NWBB_NWBBSHR_CNT: String(row.CRSPAREA_NWBB_NWBBSHR_CNT ?? '0'),
    CRSPAREA_YGMN_CNT: String(row.CRSPAREA_YGMN_CNT ?? '0'),
    CRSPAREA_OPS_CNT: String(row.CRSPAREA_OPS_CNT ?? '0'),
  }

  const hasAny = Object.values(out).some((v) => Number(v) > 0)
  return hasAny ? out : undefined
}

async function fetchPaged<ApiType>(
  endpoint: string
): Promise<ApiType[]> {
  const key = process.env.ODCLOUD_API_KEY
  if (!key) throw new Error('ODCLOUD_API_KEY not set')

  const perPage = 1000
  let page = 1
  let done = false
  const rows: ApiType[] = []

  while (!done) {
    const url =
      `https://api.odcloud.kr/api/${endpoint}` +
      `?serviceKey=${encodeURIComponent(key)}` +
      `&page=${page}&perPage=${perPage}&returnType=JSON`

    const res = await fetch(url, {
      next: { revalidate: 600 },
    })

    if (!res.ok) {
      throw new Error(`API fetch failed: ${endpoint} ${res.status}`)
    }

    const json = await res.json()
    const data: ApiType[] = json.data || []

    rows.push(...data)

    if (data.length < perPage) {
      done = true
    } else {
      page += 1
    }
  }

  return rows
}

async function fetchCompetitionRows(): Promise<CmpetRow[]> {
  return fetchPaged<CmpetRow>('ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet')
}

async function fetchSpecialSupplyRows(): Promise<SpsplyRow[]> {
  return fetchPaged<SpsplyRow>('ApplyhomeInfoCmpetRtSvc/v1/getAPTSpsplyReqstStus')
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    const keyword = (searchParams.get('keyword') || '').trim()
    const region = (searchParams.get('region') || '').trim()
    const yearMonthFrom = (searchParams.get('yearMonthFrom') || '').trim()
    const yearMonthTo = (searchParams.get('yearMonthTo') || '').trim()

    const [competitionRows, specialRows] = await Promise.all([
      fetchCompetitionRows(),
      fetchSpecialSupplyRows(),
    ])

      if (houseManageNo) supplyMap.set(houseManageNo, info)
      if (pblancNo) supplyMap.set(pblancNo, info)
    }

    const specialMap = new Map<string, Record<string, string>>()

    for (const row of specialRows) {
      const pblancNo = String(row.PBLANC_NO || '').trim()
      const houseManageNo = String(row.HOUSE_MANAGE_NO || '').trim()
      const typeKey = toTypeKey(row.HOUSE_TY)
      const itemKey = toItemKey(pblancNo, houseManageNo)

      if (!itemKey) continue

      const spsply = toSpsplyMap(row)
      if (!spsply) continue

      const key = `${itemKey}__${typeKey}`
      specialMap.set(key, spsply)
    }

    const grouped = new Map<string, CompetitionItem>()

    for (const row of competitionRows) {
      const houseManageNo = String(row.HOUSE_MANAGE_NO || '').trim()
      const pblancNo = String(row.PBLANC_NO || '').trim()
      const houseNameRaw = String(row.HOUSE_NM || '').trim()
      const itemKey = toItemKey(pblancNo, houseManageNo)

      if (!itemKey) continue

      const supplyInfo =
        supplyMap.get(pblancNo) ||
        supplyMap.get(houseManageNo) || {
          houseName: houseNameRaw,
          region: normalizeRegion('', '', houseNameRaw),
          address: '',
          rceptBgnde: parseDate(String(row.RCEPT_BGNDE || '')),
          rceptEndde: parseDate(String(row.RCEPT_ENDDE || '')),
        }

      const houseName = supplyInfo.houseName || houseNameRaw || itemKey
      const rowRegion = normalizeRegion(
        supplyInfo.region,
        supplyInfo.address,
        houseName
      )
      const ym = toYm(supplyInfo.rceptBgnde)

      const keywordMatch = !keyword || houseName.includes(keyword)
      const regionMatch = !region || region === '전체' || rowRegion === region
      const fromMatch = !yearMonthFrom || (ym && ym >= yearMonthFrom)
      const toMatch = !yearMonthTo || (ym && ym <= yearMonthTo)

      if (!keywordMatch || !regionMatch || !fromMatch || !toMatch) {
        continue
      }

      if (!grouped.has(itemKey)) {
        grouped.set(itemKey, {
          pblancNo: itemKey,
          houseName,
          region: rowRegion,
          rceptBgnde: supplyInfo.rceptBgnde,
          rceptEndde: supplyInfo.rceptEndde,
          houseTypes: [],
        })
      }

      const typeKey = toTypeKey(row.HOUSE_TY)
      const reqCnt = String(row.REQ_CNT ?? '0')
      const suply = String(row.SUPLY_HSHLDCO ?? '0')
      const rank = normalizeRank(row.SUBSCRPT_RANK_CODE)
      const reside = normalizeReside(row.RESIDE_SENM, row.RESIDE_SECD)
      const rate = normalizeRate(row.CMPET_RATE, row.REQ_CNT, row.SUPLY_HSHLDCO)

      const houseTypeRow: HouseTypeRate = {
        type: typeKey,
        rate,
        reqCnt,
        suply,
        rank,
        reside,
      }

      const spsply = specialMap.get(`${itemKey}__${typeKey}`)
      if (spsply) {
        houseTypeRow.spsply = spsply
      }

      grouped.get(itemKey)!.houseTypes.push(houseTypeRow)
    }

    const items = Array.from(grouped.values())
      .map((item) => {
        item.houseTypes.sort((a, b) => {
          const typeCompare = a.type.localeCompare(b.type)
          if (typeCompare !== 0) return typeCompare

          const rankCompare = Number(a.rank || 0) - Number(b.rank || 0)
          if (rankCompare !== 0) return rankCompare

          return a.reside.localeCompare(b.reside)
        })

        return item
      })
      .sort((a, b) => (b.rceptBgnde || '').localeCompare(a.rceptBgnde || ''))

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