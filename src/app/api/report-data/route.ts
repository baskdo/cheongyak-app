import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import {
  ReportData, ReportSite, ReportRow, ReportStage, sumRows, emptyTotals,
} from '@/lib/reportTypes'

// 청약결과 보고서 데이터 — 세부조회(detail) + 비교조회(compare) 단지를 한 번에
//
//   GET /api/report-data?detail=2026000530,2026000532&compare=2026000124,2026000201
//
// 단지 1건당 수집 순서 (전부 병렬):
//   1) 공고 메타 + 주택형별 공급세대  : 공공데이터 Detail/Mdl API (cond[PBLANC_NO::EQ] 단건 조회)
//   2) 특별공급 접수                  : /api/spsply-scrape (청약홈 직접) → 없으면 DB(competition_items.spsplyDetail)
//   3) 1·2순위 접수                   : /api/applyhome-competition (청약홈 직접) → 없으면 DB(competition_items.houseTypes)
//
// 청약홈 직접 조회를 1순위로 두는 이유: 공공 API/DB는 발표 다음 날 반영되지만 보고는 발표 당일 19:30에 해야 한다.
// 과거 비교단지는 청약홈 팝업이 비어 있을 수 있어 DB로 폴백한다.
//
// Hobby 플랜 함수 제한(10초) 대응: 단지당 외부 호출 4건을 모두 병렬, 각 6초 타임아웃.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 10

const DETAIL_BASE = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'
const MAX_SITES = 8

type AnyRow = Record<string, string | number | undefined>

// ---------- 소형 헬퍼 ----------
function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function typeLabelOf(ty: string): string {
  const trimmed = (ty || '').trim()
  const m = trimmed.match(/^0*(\d+)\.?\d*/)
  const n = m ? parseInt(m[1], 10) : 0
  const suffix = trimmed.match(/[A-Za-z]+$/)?.[0] || ''
  return `${n}${suffix.toUpperCase()}`
}
function typeKey(ty: string): string {
  return (ty || '').trim()
}
// 주택형 정렬: 면적 숫자 → 접미사(A,B,C…) 순 ("084.9594A" 같은 원문은 면적 소수점이 달라 문자열 정렬이 섞임)
function byType(a: { type: string }, b: { type: string }): number {
  const parse = (t: string) => {
    const m = (t || '').trim().match(/^0*(\d+)(?:\.(\d+))?([A-Za-z]*)$/)
    return m ? { n: parseInt(m[1], 10), d: parseInt(m[2] || '0', 10), s: (m[3] || '').toUpperCase() } : { n: 0, d: 0, s: t }
  }
  const x = parse(a.type), y = parse(b.type)
  if (x.n !== y.n) return x.n - y.n
  if (x.s !== y.s) return x.s < y.s ? -1 : 1
  return x.d - y.d
}
function extractRegion(text: string): string {
  const regions = ['서울','경기','인천','부산','대구','광주','대전','울산','세종','강원','충북','충남','전북','전남','경북','경남','제주']
  for (const r of regions) if ((text || '').includes(r)) return r
  return '기타'
}
function firstNonEmpty(...vals: Array<string | number | undefined>): string {
  for (const v of vals) {
    const s = String(v ?? '').trim()
    if (s) return s
  }
  return ''
}
async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ---------- 1) 공공 API: 메타 + 공급 ----------
type Meta = {
  houseName: string
  region: string
  address: string
  dates: ReportSite['dates']
}
async function fetchMeta(key: string, pblancNo: string): Promise<Meta | null> {
  const url =
    `${DETAIL_BASE}/getAPTLttotPblancDetail?serviceKey=${encodeURIComponent(key)}` +
    `&page=1&perPage=5&returnType=JSON&cond%5BPBLANC_NO%3A%3AEQ%5D=${encodeURIComponent(pblancNo)}`
  const json = await fetchJson<{ data?: AnyRow[] }>(url)
  const row = json?.data?.[0]
  if (!row) return null
  return {
    houseName: String(row['HOUSE_NM'] || ''),
    region: extractRegion(String(row['SUBSCRPT_AREA_CODE_NM'] || row['HSSPLY_ADRES'] || '')),
    address: String(row['HSSPLY_ADRES'] || ''),
    dates: {
      spsply: firstNonEmpty(row['SPSPLY_RCEPT_BGNDE']),
      rank1: firstNonEmpty(row['GNRL_RNK1_CRSPAREA_RCPTDE'], row['GNRL_RNK1_ETC_GG_RCPTDE'], row['GNRL_RNK1_ETC_AREA_RCPTDE']),
      rank2: firstNonEmpty(row['GNRL_RNK2_CRSPAREA_RCPTDE'], row['GNRL_RNK2_ETC_GG_RCPTDE'], row['GNRL_RNK2_ETC_AREA_RCPTDE']),
      announce: firstNonEmpty(row['PRZWNER_PRESNATN_DE']),
    },
  }
}

type SupplyMap = Record<string, { total: number; spsply: number }>
async function fetchSupply(key: string, pblancNo: string): Promise<SupplyMap> {
  const url =
    `${DETAIL_BASE}/getAPTLttotPblancMdl?serviceKey=${encodeURIComponent(key)}` +
    `&page=1&perPage=100&returnType=JSON&cond%5BPBLANC_NO%3A%3AEQ%5D=${encodeURIComponent(pblancNo)}`
  const json = await fetchJson<{ data?: AnyRow[] }>(url)
  const map: SupplyMap = {}
  for (const r of json?.data || []) {
    const ty = typeKey(String(r['HOUSE_TY'] || ''))
    if (!ty) continue
    const gen = num(r['SUPLY_HSHLDCO'])
    const sp = num(r['SPSPLY_HSHLDCO'])
    const cur = map[ty] || { total: 0, spsply: 0 }
    map[ty] = { total: cur.total + gen + sp, spsply: cur.spsply + sp }
  }
  return map
}

// ---------- 2) 특공: 청약홈 직접 ----------
type SpsplyScrape = {
  ok: boolean
  houseTypes: Array<{ type: string; spsplyHshldco: number; totalApplied: number }>
}
type SpsplyMap = Record<string, { assigned: number; applied: number }>
async function fetchSpsplyScrape(origin: string, pblancNo: string, houseNm: string): Promise<SpsplyMap | null> {
  const params = new URLSearchParams({ pblancNo })
  if (houseNm) params.set('houseNm', houseNm)
  const json = await fetchJson<SpsplyScrape>(`${origin}/api/spsply-scrape?${params.toString()}`)
  if (!json?.ok || !json.houseTypes?.length) return null
  const map: SpsplyMap = {}
  for (const h of json.houseTypes) {
    map[typeKey(h.type)] = { assigned: num(h.spsplyHshldco), applied: num(h.totalApplied) }
  }
  return map
}

// ---------- 3) 1·2순위: 청약홈 직접 ----------
type RankScrape = {
  ok: boolean
  rank1ByType: Array<{ type: string; suply: number; local: number; ggOther?: number; etc: number; total: number }>
  rank2ByType?: Array<{ type: string; hasData: boolean; total: number }>
}
type RankMap = Record<string, {
  assigned: number; applied: number; local: number; gg: number; etc: number
  rank2Applied: number; rank2HasData: boolean
}>
async function fetchRankScrape(origin: string, pblancNo: string): Promise<RankMap | null> {
  const json = await fetchJson<RankScrape>(`${origin}/api/applyhome-competition?pblancNo=${pblancNo}`)
  if (!json?.ok || !json.rank1ByType?.length) return null
  const map: RankMap = {}
  for (const r of json.rank1ByType) {
    const gg = num(r.ggOther)
    map[typeKey(r.type)] = {
      assigned: num(r.suply), applied: num(r.total), local: num(r.local),
      gg, etc: Math.max(0, num(r.etc) - gg),
      rank2Applied: 0, rank2HasData: false,
    }
  }
  for (const r2 of json.rank2ByType || []) {
    const e = map[typeKey(r2.type)]
    if (e && r2.hasData) { e.rank2Applied = num(r2.total); e.rank2HasData = true }
  }
  return map
}

// ---------- DB 폴백 (competition_items) ----------
type DbItem = {
  houseName?: string
  region?: string
  rceptBgnde?: string
  houseTypes?: Array<{ type: string; reqCnt: string; suply: string; rank: string; reside: string }>
  spsplyDetail?: {
    houseTypes?: Array<{
      type: string
      spsplyHshldco: number
      categories: Array<{ areaData?: { 해당: number; 기타경기: number; 기타지역: number }; instData?: { 결정: number; 미결: number } }>
    }>
  }
}
async function fetchDbItem(pblancNo: string): Promise<DbItem | null> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return null
  try {
    const sql = neon(dbUrl)
    const rows = (await sql.query('SELECT item FROM competition_items WHERE pblanc_no = $1 LIMIT 1', [pblancNo])) as Array<{ item: DbItem }>
    return rows[0]?.item || null
  } catch {
    return null
  }
}
function rankMapFromDb(item: DbItem | null): RankMap | null {
  const hts = item?.houseTypes || []
  if (hts.length === 0) return null
  const map: RankMap = {}
  for (const h of hts) {
    const ty = typeKey(h.type)
    if (!ty) continue
    const e = map[ty] || { assigned: 0, applied: 0, local: 0, gg: 0, etc: 0, rank2Applied: 0, rank2HasData: false }
    const cnt = num(h.reqCnt)
    if (h.rank === '1') {
      e.assigned = Math.max(e.assigned, num(h.suply))
      e.applied += cnt
      if (h.reside === '해당지역') e.local += cnt
      else if ((h.reside || '').includes('기타경기')) e.gg += cnt
      else e.etc += cnt
    } else if (h.rank === '2') {
      e.rank2Applied += cnt
      if (cnt > 0) e.rank2HasData = true
    }
    map[ty] = e
  }
  return Object.values(map).some((e) => e.applied > 0) ? map : null
}
function spsplyMapFromDb(item: DbItem | null): SpsplyMap | null {
  const hts = item?.spsplyDetail?.houseTypes || []
  if (hts.length === 0) return null
  const map: SpsplyMap = {}
  for (const h of hts) {
    let applied = 0
    for (const c of h.categories || []) {
      if (c.areaData) applied += num(c.areaData.해당) + num(c.areaData.기타경기) + num(c.areaData.기타지역)
      else if (c.instData) applied += num(c.instData.결정) + num(c.instData.미결)
    }
    map[typeKey(h.type)] = { assigned: num(h.spsplyHshldco), applied }
  }
  return map
}

// ---------- 단지 1건 조립 ----------
async function buildSite(origin: string, key: string, pblancNo: string): Promise<ReportSite> {
  const base: ReportSite = {
    pblancNo, houseName: '', region: '', address: '',
    dates: { spsply: '', rank1: '', rank2: '', announce: '' },
    stage: 'before', rows: [], totals: emptyTotals(),
    source: { meta: 'none', spsply: 'none', rank: 'none' },
  }

  // 메타·공급·DB는 서로 독립 → 먼저 병렬. (특공 scrape는 houseNm이 있으면 더 안정적이라 메타 뒤에)
  const [meta, supply, dbItem, rankScrape] = await Promise.all([
    key ? fetchMeta(key, pblancNo) : Promise.resolve(null),
    key ? fetchSupply(key, pblancNo) : Promise.resolve({} as SupplyMap),
    fetchDbItem(pblancNo),
    fetchRankScrape(origin, pblancNo),
  ])
  const houseName = meta?.houseName || dbItem?.houseName || ''
  const spsplyScrape = await fetchSpsplyScrape(origin, pblancNo, houseName)

  if (meta) {
    base.houseName = meta.houseName
    base.region = meta.region
    base.address = meta.address
    base.dates = meta.dates
    base.source.meta = 'api'
  } else if (dbItem) {
    base.houseName = dbItem.houseName || ''
    base.region = dbItem.region || ''
    base.dates.rank1 = dbItem.rceptBgnde || ''
    base.source.meta = 'db'
  } else {
    base.error = '공고 정보를 찾지 못했습니다 (공고번호 확인)'
  }

  const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const spsplyMap = spsplyScrape || spsplyMapFromDb(dbItem)
  base.source.spsply = spsplyScrape ? 'applyhome' : spsplyMap ? 'db' : 'none'
  const rankMap = rankScrape || rankMapFromDb(dbItem)
  base.source.rank = rankScrape ? 'applyhome' : rankMap ? 'db' : 'none'

  // 주택형 합집합 (공급표 → 특공 → 1순위 순으로 키 수집)
  const keys = new Set<string>([
    ...Object.keys(supply), ...Object.keys(spsplyMap || {}), ...Object.keys(rankMap || {}),
  ])
  const rows: ReportRow[] = []
  for (const ty of Array.from(keys)) {
    const sup = supply[ty]
    const sp = spsplyMap?.[ty]
    const rk = rankMap?.[ty]
    const spsplyAssigned = sp?.assigned ?? sup?.spsply ?? 0
    const spsplyApplied = sp?.applied ?? 0
    // 총 공급: Mdl 우선. 없으면 특공배정 + 1순위모집(이월 전)로 근사
    let total = sup?.total ?? 0
    if (!total) total = spsplyAssigned + (rk?.assigned ?? 0)
    // 1순위 모집세대: 청약홈 표시값 우선. 없으면 총공급 − min(특공접수, 특공배정)
    const rank1Assigned = rk?.assigned ?? Math.max(0, total - Math.min(spsplyApplied, spsplyAssigned))
    rows.push({
      type: ty, typeLabel: typeLabelOf(ty), supply: total,
      spsplyAssigned, spsplyApplied,
      rank1Assigned, rank1Applied: rk?.applied ?? 0,
      rank1Local: rk?.local ?? 0, rank1Gg: rk?.gg ?? 0, rank1Etc: rk?.etc ?? 0,
      rank2Applied: rk?.rank2Applied ?? 0,
      // 청약홈 팝업은 접수 전에도 2순위 행을 0건으로 보여주므로, 접수가 있거나 2순위 접수일이 지난 뒤에만 "데이터 있음"으로 본다
      rank2HasData: !!rk?.rank2HasData && ((rk?.rank2Applied ?? 0) > 0 || (!!base.dates.rank2 && todayKST > base.dates.rank2)),
    })
  }
  rows.sort(byType)
  base.rows = rows
  base.totals = sumRows(rows)

  // 단계 판정 — 접수 건수가 있거나 해당 접수일이 지난 경우에만 그 단계로 본다
  //   (특공 발표일 저녁에는 1순위 팝업이 0건 표로 이미 떠 있어, 건수만 보면 1·2순위 결과로 오인됨)
  const t = base.totals
  const rank1Passed = !!base.dates.rank1 && todayKST > base.dates.rank1
  let stage: ReportStage = 'before'
  if (t.rank2HasData) stage = 'rank2'
  else if (t.rank1Applied > 0 || (rankMap && rank1Passed)) stage = 'rank1'
  else if (spsplyMap && (t.spsplyApplied > 0 || (!!base.dates.spsply && todayKST >= base.dates.spsply))) stage = 'spsply'
  if (stage === 'rank2' && base.dates.announce && todayKST >= base.dates.announce) stage = 'final'
  base.stage = stage
  return base
}

function parseList(v: string | null): string[] {
  return Array.from(new Set((v || '').split(',').map((s) => s.trim()).filter((s) => /^\d{6,12}$/.test(s))))
}

function originOf(request: Request): string {
  const h = request.headers
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || (host && host.startsWith('localhost') ? 'http' : 'https')
  if (host) return `${proto}://${host}`
  return new URL(request.url).origin
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const detailNos = parseList(searchParams.get('detail'))
  const compareNos = parseList(searchParams.get('compare')).filter((n) => !detailNos.includes(n))
  const all = [...detailNos, ...compareNos].slice(0, MAX_SITES)

  if (all.length === 0) {
    return NextResponse.json<ReportData>({
      ok: false, generatedAt: new Date().toISOString(), detail: [], compare: [],
      error: 'detail 또는 compare 공고번호가 필요합니다',
    }, { status: 400 })
  }

  const key = process.env.ODCLOUD_API_KEY || process.env.API_KEY2 || process.env.API_KEY || ''
  const origin = originOf(request)

  const sites = await Promise.all(all.map((no) => buildSite(origin, key, no)))
  const byNo = new Map(sites.map((s) => [s.pblancNo, s]))

  return NextResponse.json<ReportData>({
    ok: true,
    generatedAt: new Date().toISOString(),
    detail: detailNos.map((n) => byNo.get(n)!).filter(Boolean),
    compare: compareNos.map((n) => byNo.get(n)!).filter(Boolean),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
