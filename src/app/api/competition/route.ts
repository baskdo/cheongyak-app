import { NextResponse } from 'next/server'
import { loadCSV, pick } from '@/lib/csvLoader'

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

function toYm(dateStr: string): string {
  const cleaned = (dateStr || '').replace(/[./]/g, '-')

  if (/^\d{8}$/.test(cleaned)) return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned.slice(0, 7)
  if (/^\d{4}-\d{2}$/.test(cleaned)) return cleaned
  return ''
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    const keyword = (searchParams.get('keyword') || '').trim()
    const region = (searchParams.get('region') || '').trim()
    const yearMonthFrom = (searchParams.get('yearMonthFrom') || '').trim()
    const yearMonthTo = (searchParams.get('yearMonthTo') || '').trim()

    const rows = loadCSV('apt_competition_history.csv')
    console.log('[competition] raw rows:', rows.length)

    const filtered = rows.filter(r => {
      const houseName = pick(r, ['HOUSE_NM', 'HOUSE_NAME'])
      const rowRegion = normalizeRegion(pick(r, ['SUBSCRPT_AREA_CODE_NM', 'REGION']))
      const baseDate = pick(r, ['RCEPT_BGNDE', 'PBLANC_DE'])
      const ym = toYm(baseDate)

      const keywordMatch = !keyword || houseName.includes(keyword)
      const regionMatch = !region || region === '전체' || rowRegion === region
      const fromMatch = !yearMonthFrom || (ym && ym >= yearMonthFrom)
      const toMatch = !yearMonthTo || (ym && ym <= yearMonthTo)

      return keywordMatch && regionMatch && fromMatch && toMatch
    })

    console.log('[competition] filtered rows:', filtered.length)

    const grouped = new Map<string, CompetitionItem>()

    for (const r of filtered) {
      const pblancNo = pick(r, ['PBLANC_NO', 'HOUSE_MANAGE_NO'])
      if (!pblancNo) continue

      if (!grouped.has(pblancNo)) {
        grouped.set(pblancNo, {
          pblancNo,
          houseName: pick(r, ['HOUSE_NM', 'HOUSE_NAME']),
          region: normalizeRegion(pick(r, ['SUBSCRPT_AREA_CODE_NM', 'REGION'])),
          rceptBgnde: pick(r, ['RCEPT_BGNDE']),
          rceptEndde: pick(r, ['RCEPT_ENDDE']),
          houseTypes: [],
        })
      }

      const item = grouped.get(pblancNo)!

      const row: HouseTypeRate = {
        type: pick(r, ['HOUSE_TY', 'MODEL_NO']),
        rate: pick(r, ['CMPET_RATE']) || '-',
        reqCnt: pick(r, ['REQ_CNT']) || '0',
        suply: pick(r, ['SUPLY_HSHLDCO']) || '0',
        rank: String(pick(r, ['SUBSCRPT_RANK_CODE']) || ''),
        reside: pick(r, ['RESIDE_SENM']) || '',
      }

      const specialKeys = [
        'MNYCH_HSHLDCO',
        'NWWDS_NMTW_HSHLDCO',
        'LFE_FRST_HSHLDCO',
        'NWBB_NWBBSHR_HSHLDCO',
        'YGMN_HSHLDCO',
        'OLD_PARNTS_SUPORT_HSHLDCO',
        'CRSPAREA_MNYCH_CNT',
        'CRSPAREA_NWWDS_NMTW_CNT',
        'CRSPAREA_LFE_FRST_CNT',
        'CRSPAREA_NWBB_NWBBSHR_CNT',
        'CRSPAREA_YGMN_CNT',
        'CRSPAREA_OPS_CNT',
      ]

      const spsply: Record<string, string> = {}
      let hasSpecial = false

      for (const key of specialKeys) {
        if (r[key] !== undefined && r[key] !== '') {
          spsply[key] = r[key]
          hasSpecial = true
        }
      }

      if (hasSpecial) row.spsply = spsply

      item.houseTypes.push(row)
    }

    const items = Array.from(grouped.values()).sort((a, b) =>
      (b.rceptBgnde || '').localeCompare(a.rceptBgnde || '')
    )

    console.log('[competition] final items:', items.length)
    console.log('[competition] sample:', items[0])

    return NextResponse.json({ items })
  } catch (error) {
    console.error('[competition GET] error:', error)
    return NextResponse.json({ items: [], error: String(error) })
  }
}