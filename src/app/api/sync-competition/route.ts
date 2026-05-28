import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

// Vercel Cron 전용 수집 route.
// 매일 새벽(KST) 청약홈 공공 API → 가공 → Neon DB upsert.
// 무료 플랜 함수 시간제한(10초) 대응: 기본은 최근분(소수 페이지)만 수집.
//   - competition/special/notice 를 병렬 호출, 페이지 수 제한(maxPage)
//   - ?full=1 (+ 토큰) 으로 호출하면 전체 재적재 (수동/초기용, 로컬에서 길게)
export const dynamic = 'force-dynamic'
// Hobby 플랜 함수 시간제한이 10초이므로 그에 맞춤. 일일 수집은 maxPage=2라 충분.
export const maxDuration = 10

// ===================== TYPES =====================
type AnyRow = Record<string, string | number | undefined>

type HouseTypeRate = {
  type: string
  rate: string
  reqCnt: string
  suply: string
  rank: string
  reside: string
}

type SpecialSupplyCategory = {
  name: string
  suply: number
  areaData?: { 해당: number; 기타경기: number; 기타지역: number }
  instData?: { 결정: number; 미결: number }
}
type SpecialSupplyHouseType = {
  type: string
  typeLabel: string
  spsplyHshldco: number
  categories: SpecialSupplyCategory[]
}
type SpecialSupplyItem = {
  pblancNo: string
  houseName: string
  region: string
  rceptBgnde: string
  rceptEndde: string
  subscrptResultNm: string
  houseTypes: SpecialSupplyHouseType[]
}
type CompetitionItem = {
  pblancNo: string
  houseName: string
  region: string
  rceptBgnde: string
  rceptEndde: string
  houseTypes: HouseTypeRate[]
  spsplyDetail?: SpecialSupplyItem
}

// ===================== 유틸 (competition route.ts 와 동일 로직) =====================
function n(v: string | number | undefined): number {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}

function parseDate(value: string | number | undefined): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const normalized = text.replace(/\./g, '-').replace(/\//g, '-')
  if (/^\d{8}$/.test(normalized)) {
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized
  return text
}

function toYm(dateStr: string): string {
  const text = (dateStr || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 7)
  if (/^\d{4}-\d{2}$/.test(text)) return text
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}`
  return ''
}

const REGION_KEYWORDS = ['서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
function normalizeRegionFromText(source: string): string {
  const text = (source || '').trim()
  for (const kw of REGION_KEYWORDS) if (text.includes(kw)) return kw
  return ''
}
function normalizeRegion(houseName: string, address = '', regionName = ''): string {
  return normalizeRegionFromText(regionName) || normalizeRegionFromText(address) || normalizeRegionFromText(houseName) || '기타'
}

function pickHouseName(row: AnyRow): string {
  return String(row.HOUSE_NM || row.HSSPLY_NM || row.PBLANC_NM || '').trim()
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
  if (text.includes('기타')) return '기타지역'
  if (text.includes('해당')) return '해당지역'
  return text
}

function normalizeRate(rawRate: string | number | undefined, reqCnt: string | number | undefined, suply: string | number | undefined): string {
  const text = String(rawRate ?? '').trim()
  if (text && text !== 'null' && text !== 'undefined') return text
  const req = Number(reqCnt || 0)
  const supply = Number(suply || 0)
  if (!supply) return '-'
  const rate = req / supply
  if (!Number.isFinite(rate)) return '-'
  return rate.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function toItemKey(pblancNo: string, houseManageNo: string): string {
  return pblancNo || houseManageNo
}

function typeLabel(ty: string): string {
  const t = (ty || '').trim()
  const m = t.match(/^0*(\d+)\.?\d*([A-Za-z]*)$/)
  if (!m) return t
  return `${m[1]}${(m[2] || '').toUpperCase()}`
}

// ===================== 특공 → SpecialSupplyItem houseType (special-supply route 포팅) =====================
function buildSpsplyHouseType(row: AnyRow): SpecialSupplyHouseType | null {
  const totalAssigned =
    n(row.MNYCH_HSHLDCO) + n(row.NWWDS_NMTW_HSHLDCO) + n(row.LFE_FRST_HSHLDCO) +
    n(row.YGMN_HSHLDCO) + n(row.OLD_PARNTS_SUPORT_HSHLDCO) + n(row.NWBB_NWBBSHR_HSHLDCO) +
    n(row.INSTT_RECOMEND_HSHLDCO) + n(row.TRANSR_INSTT_ENFSN_HSHLDCO)
  if (totalAssigned === 0) return null

  const ty = String(row.HOUSE_TY || '').trim()
  if (!ty) return null

  const categories: SpecialSupplyCategory[] = []

  const general: Array<[string, string, string]> = [
    ['다자녀', 'MNYCH_HSHLDCO', 'MNYCH'],
    ['신혼부부', 'NWWDS_NMTW_HSHLDCO', 'NWWDS_NMTW'],
    ['생애최초', 'LFE_FRST_HSHLDCO', 'LFE_FRST'],
    ['청년', 'YGMN_HSHLDCO', 'YGMN'],
    ['노부모', 'OLD_PARNTS_SUPORT_HSHLDCO', 'OPS'],
    ['신생아', 'NWBB_NWBBSHR_HSHLDCO', 'NWBB_NWBBSHR'],
  ]
  for (const [name, suplyField, cntKey] of general) {
    const suply = n(row[suplyField])
    if (suply > 0) {
      categories.push({
        name,
        suply,
        areaData: {
          해당: n(row[`CRSPAREA_${cntKey}_CNT`]),
          기타경기: n(row[`CTPRVN_${cntKey}_CNT`]),
          기타지역: n(row[`ETC_AREA_${cntKey}_CNT`]),
        },
      })
    }
  }

  const inst: Array<[string, string, number, number]> = [
    ['기관추천', 'INSTT_RECOMEND_HSHLDCO', n(row.INSTT_RECOMEND_DCSN_CNT), n(row.INSTT_RECOMEND_PREPAR_CNT)],
    ['이전기관', 'TRANSR_INSTT_ENFSN_HSHLDCO', n(row.TRANSR_INSTT_ENFSN_CNT), 0],
  ]
  for (const [name, suplyField, dcsn, prepar] of inst) {
    const suply = n(row[suplyField])
    if (suply > 0) {
      categories.push({ name, suply, instData: { 결정: dcsn, 미결: prepar } })
    }
  }

  return {
    type: ty,
    typeLabel: typeLabel(ty),
    spsplyHshldco: n(row.SPSPLY_HSHLDCO),
    categories,
  }
}

// ===================== API 호출 =====================
async function fetchPaged(endpoint: string, maxPage: number): Promise<AnyRow[]> {
  const key = process.env.ODCLOUD_API_KEY
  if (!key) throw new Error('ODCLOUD_API_KEY not set')
  const perPage = 1000
  const rows: AnyRow[] = []
  let page = 1
  while (page <= maxPage) {
    const url =
      `https://api.odcloud.kr/api/${endpoint}` +
      `?serviceKey=${encodeURIComponent(key)}&page=${page}&perPage=${perPage}&returnType=JSON`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`API fetch failed: ${endpoint} ${res.status}`)
    const json = await res.json()
    const data: AnyRow[] = json.data || []
    rows.push(...data)
    if (data.length < perPage) break
    page += 1
  }
  return rows
}

// ===================== 가공 (sync_competition.py 포팅) =====================
function buildItems(competitionRows: AnyRow[], specialRows: AnyRow[], noticeRows: AnyRow[]): CompetitionItem[] {
  const noticeMap = new Map<string, { houseName: string; address: string; regionName: string; rceptBgnde: string; rceptEndde: string }>()
  for (const row of noticeRows) {
    const key = toItemKey(String(row.PBLANC_NO || '').trim(), String(row.HOUSE_MANAGE_NO || '').trim())
    if (!key) continue
    noticeMap.set(key, {
      houseName: pickHouseName(row),
      address: String(row.HSSPLY_ADRES || row.ADRES || '').trim(),
      regionName: String(row.SUBSCRPT_AREA_CODE_NM || '').trim(),
      rceptBgnde: parseDate(row.RCEPT_BGNDE),
      rceptEndde: parseDate(row.RCEPT_ENDDE),
    })
  }

  const spsplyHouseTypes = new Map<string, SpecialSupplyHouseType[]>()
  const spsplyMeta = new Map<string, { subscrptResultNm: string }>()
  const metaMap = new Map<string, { houseName: string; rceptBgnde: string; rceptEndde: string }>()
  for (const row of specialRows) {
    const key = toItemKey(String(row.PBLANC_NO || '').trim(), String(row.HOUSE_MANAGE_NO || '').trim())
    if (!key) continue
    const ht = buildSpsplyHouseType(row)
    if (ht) {
      if (!spsplyHouseTypes.has(key)) spsplyHouseTypes.set(key, [])
      spsplyHouseTypes.get(key)!.push(ht)
      if (!spsplyMeta.has(key)) spsplyMeta.set(key, { subscrptResultNm: String(row.SUBSCRPT_RESULT_NM || '').trim() })
    }
    if (!metaMap.has(key)) {
      metaMap.set(key, { houseName: pickHouseName(row), rceptBgnde: parseDate(row.RCEPT_BGNDE), rceptEndde: parseDate(row.RCEPT_ENDDE) })
    }
  }

  const grouped = new Map<string, CompetitionItem>()
  for (const row of competitionRows) {
    const key = toItemKey(String(row.PBLANC_NO || '').trim(), String(row.HOUSE_MANAGE_NO || '').trim())
    if (!key) continue
    const notice = noticeMap.get(key)
    const meta = metaMap.get(key)
    const houseName = notice?.houseName || meta?.houseName || pickHouseName(row) || '단지명 확인중'
    const rceptBgnde = notice?.rceptBgnde || meta?.rceptBgnde || parseDate(row.RCEPT_BGNDE)
    const rceptEndde = notice?.rceptEndde || meta?.rceptEndde || parseDate(row.RCEPT_ENDDE)
    const rowRegion = normalizeRegion(houseName, notice?.address || '', notice?.regionName || '')

    if (!grouped.has(key)) {
      grouped.set(key, { pblancNo: key, houseName, region: rowRegion, rceptBgnde, rceptEndde, houseTypes: [] })
    }
    grouped.get(key)!.houseTypes.push({
      type: String(row.HOUSE_TY || '').trim(),
      rate: normalizeRate(row.CMPET_RATE, row.REQ_CNT, row.SUPLY_HSHLDCO),
      reqCnt: String(row.REQ_CNT ?? '0'),
      suply: String(row.SUPLY_HSHLDCO ?? '0'),
      rank: normalizeRank(row.SUBSCRPT_RANK_CODE),
      reside: normalizeReside(row.RESIDE_SENM as string, row.RESIDE_SECD),
    })
  }

  const items: CompetitionItem[] = []
  for (const item of Array.from(grouped.values())) {
    const hts = spsplyHouseTypes.get(item.pblancNo)
    if (hts) {
      const sorted = [...hts].sort((a, b) => a.type.localeCompare(b.type))
      item.spsplyDetail = {
        pblancNo: item.pblancNo,
        houseName: item.houseName,
        region: item.region,
        rceptBgnde: item.rceptBgnde,
        rceptEndde: item.rceptEndde,
        subscrptResultNm: spsplyMeta.get(item.pblancNo)?.subscrptResultNm || '',
        houseTypes: sorted,
      }
    }
    item.houseTypes.sort((a, b) => {
      const t = a.type.localeCompare(b.type)
      if (t !== 0) return t
      const r = (Number(a.rank) || 0) - (Number(b.rank) || 0)
      if (r !== 0) return r
      return a.reside.localeCompare(b.reside)
    })
    items.push(item)
  }
  items.sort((a, b) => (b.rceptBgnde || '').localeCompare(a.rceptBgnde || ''))
  return items
}

// ===================== GET (Cron 진입점) =====================
export async function GET(request: Request) {
  const started = Date.now()
  try {
    // --- 인증: CRON_SECRET 토큰 확인 (아무나 못 부르게) ---
    const secret = process.env.CRON_SECRET
    if (secret) {
      const auth = request.headers.get('authorization') || ''
      const { searchParams } = new URL(request.url)
      const tokenParam = searchParams.get('token') || ''
      const ok = auth === `Bearer ${secret}` || tokenParam === secret
      if (!ok) {
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
      }
    }

    const { searchParams } = new URL(request.url)
    const full = searchParams.get('full') === '1'
    // 일일 cron: 최근분만(페이지 소수). full=1: 전체 재적재.
    const maxPage = full ? 60 : 2

    const dbUrl = process.env.DATABASE_URL
    if (!dbUrl) throw new Error('DATABASE_URL not set')

    const [competitionRows, specialRows, noticeRows] = await Promise.all([
      fetchPaged('ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet', maxPage),
      fetchPaged('ApplyhomeInfoCmpetRtSvc/v1/getAPTSpsplyReqstStus', maxPage),
      fetchPaged('ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail', maxPage),
    ])

    const items = buildItems(competitionRows, specialRows, noticeRows)

    const sql = neon(dbUrl)
    let saved = 0
    // upsert (행마다; 최근분이라 수십~수백 건 수준)
    for (const it of items) {
      await sql`
        INSERT INTO competition_items
          (pblanc_no, house_name, region, rcept_bgnde, rcept_endde, ym, item, updated_at)
        VALUES (
          ${it.pblancNo}, ${it.houseName}, ${it.region},
          ${it.rceptBgnde || null}, ${it.rceptEndde || null},
          ${toYm(it.rceptBgnde || '') || null}, ${JSON.stringify(it)}::jsonb, now()
        )
        ON CONFLICT (pblanc_no) DO UPDATE SET
          house_name = EXCLUDED.house_name,
          region = EXCLUDED.region,
          rcept_bgnde = EXCLUDED.rcept_bgnde,
          rcept_endde = EXCLUDED.rcept_endde,
          ym = EXCLUDED.ym,
          item = EXCLUDED.item,
          updated_at = now()
      `
      saved += 1
    }

    await sql`INSERT INTO competition_sync_log (item_count, note) VALUES (${saved}, ${full ? 'cron-full' : 'cron-daily'})`

    return NextResponse.json({
      ok: true,
      mode: full ? 'full' : 'daily',
      maxPage,
      fetched: { competition: competitionRows.length, special: specialRows.length, notice: noticeRows.length },
      saved,
      elapsedMs: Date.now() - started,
    })
  } catch (error) {
    console.error('[sync-competition] error:', error)
    return NextResponse.json({ ok: false, error: String(error), elapsedMs: Date.now() - started }, { status: 500 })
  }
}
