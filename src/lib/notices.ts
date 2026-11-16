import { neon } from '@neondatabase/serverless'

// 공고 목록(청약공고·접수현황 탭의 뼈대) — 서버 저장 구조
//
//   이전: 방문자가 올 때마다 공공데이터 API를 최대 60번 호출해 목록을 조립 → 느리고, API가 죽으면 첫 화면이 0건
//   지금: syncNotices() 가 병렬로 받아 Neon(notices_cache)에 저장, /api/apartments 는 DB에서 즉시 응답.
//         갱신은 cron(외부 30분 주기 + Vercel 일일)과 🔄 새로고침(fresh=1)으로만.
//   status(접수예정/접수중/접수마감)는 날짜에 따라 바뀌므로 저장하지 않고 읽을 때 계산한다.

const BASE_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'
export const COMPETITION_BASE_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1'

type HouseTypeDetail = {
  type: string        // 주택형 원본 (예: "059.9000A")
  typeLabel: string   // 표시용 (예: "59A")
  supplyArea: number  // 공급면적 (㎡)
  pyeong: number      // 공급평형 (평, 소수점 2자리)
  topAmount: number   // 최고 분양가 (만원)
  pyeongPrice: number // 평당가 (만원/평)
  suplyHshldco: number // 공급세대수
}

type ApartmentRow = Record<string, string>
type TypeRow = Record<string, string | number>
type CmpetRow = Record<string, string | number>


export type NoticeItem = ReturnType<typeof buildNoticeItems>[number]

// 사용 가능한 공공데이터 키 목록 (중복 제거). 하나가 죽어도 다음 키로 재시도.
export function apiKeys(): string[] {
  const list = [process.env.ODCLOUD_API_KEY, process.env.API_KEY2, process.env.API_KEY]
    .map((k) => (k || '').trim())
    .filter((k) => k && k !== '여기에_API키_입력')
  return Array.from(new Set(list))
}

type PageJson = { data?: unknown[]; totalCount?: number; currentCount?: number }

async function fetchPage(url: string, timeoutMs = 8000): Promise<PageJson | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[notices] ${res.status} ${url.replace(/serviceKey=[^&]+/, 'serviceKey=***')} ${body.slice(0, 160)}`)
      return null
    }
    return (await res.json()) as PageJson
  } catch (e) {
    console.error('[notices] fetch fail', String(e))
    return null
  }
}

/**
 * 전체 페이지를 병렬로 가져온다: 1페이지로 totalCount 를 알아낸 뒤 나머지 페이지를 동시에 요청.
 * 키가 여러 개면 첫 페이지가 실패한 키는 건너뛰고 다음 키로.
 */
export async function fetchAllPagesParallel<T>(endpoint: string, maxPage = 30, baseUrl: string = BASE_URL): Promise<T[]> {
  const perPage = 1000
  for (const key of apiKeys()) {
    const mk = (page: number) => `${baseUrl}/${endpoint}?serviceKey=${encodeURIComponent(key)}&page=${page}&perPage=${perPage}&returnType=JSON`
    const first = await fetchPage(mk(1))
    if (!first || !Array.isArray(first.data)) continue   // 키 문제 → 다음 키
    const rows: T[] = [...(first.data as T[])]
    const total = Number(first.totalCount ?? 0)
    const pages = Math.min(maxPage, Math.max(1, Math.ceil(total / perPage)))
    // 동시 8개씩 (공공데이터 포털 동시접속 제한 회피)
    for (let p = 2; p <= pages; p += 8) {
      const batch = Array.from({ length: Math.min(8, pages - p + 1) }, (_, i) => fetchPage(mk(p + i)))
      const res = await Promise.all(batch)
      for (const pj of res) if (pj?.data) rows.push(...(pj.data as T[]))
    }
    return rows
  }
  return []
}

type Rank1Status = 'sold_out' | 'has_short' | 'no_data'

export function buildRank1StatusMap(cmpetRows: CmpetRow[]): Map<string, Rank1Status> {
  // pblancNo → 주택형별 (suply, reqCnt 합계) 집계
  // 동일 주택형이라도 해당지역/기타로 행이 분리되니 reqCnt는 누적, suply는 max값 사용
  type TypeAgg = { suply: number; reqCnt: number }
  const grouped = new Map<string, Map<string, TypeAgg>>()  // pblancNo → (type → agg)

  for (const row of cmpetRows) {
    const pblancNo = String(row['PBLANC_NO'] || '').trim()
    if (!pblancNo) continue

    // 1순위만 분석 (RANK 정규화: '1', '01' 모두 1순위)
    const rankRaw = String(row['SUBSCRPT_RANK_CODE'] ?? '').trim()
    if (rankRaw !== '1' && rankRaw !== '01') continue

    const type = String(row['HOUSE_TY'] || '').trim()
    if (!type) continue

    const reqCnt = Number(row['REQ_CNT'] ?? 0) || 0
    const suply = Number(row['SUPLY_HSHLDCO'] ?? 0) || 0

    if (!grouped.has(pblancNo)) grouped.set(pblancNo, new Map())
    const typeMap = grouped.get(pblancNo)!

    if (!typeMap.has(type)) {
      typeMap.set(type, { suply, reqCnt: 0 })
    }
    const agg = typeMap.get(type)!
    if (suply > agg.suply) agg.suply = suply
    agg.reqCnt += reqCnt
  }

  // pblancNo별 판정
  const result = new Map<string, Rank1Status>()
  for (const [pblancNo, typeMap] of Array.from(grouped.entries())) {
    if (typeMap.size === 0) {
      result.set(pblancNo, 'no_data')
      continue
    }
    // 모든 주택형이 마감(reqCnt >= suply)인지 검사
    let allSoldOut = true
    for (const agg of Array.from(typeMap.values())) {
      if (agg.suply === 0) continue  // 공급 0인 주택형은 무시
      if (agg.reqCnt < agg.suply) {
        allSoldOut = false
        break
      }
    }
    result.set(pblancNo, allSoldOut ? 'sold_out' : 'has_short')
  }
  return result
}


// ===== 원본 행 → 화면용 아이템 =====
export function buildNoticeItems(apartments: ApartmentRow[], types: TypeRow[], rank1StatusMap: Map<string, Rank1Status>) {
  const typeMap: Record<string, {
    houseTypes: string
    minPrice: string
    maxPrice: string
    details: HouseTypeDetail[]
  }> = {}

  types.forEach((t) => {
    const no = String(t['PBLANC_NO'] || '')
    if (!no) return
    if (!typeMap[no]) typeMap[no] = { houseTypes: '', minPrice: '', maxPrice: '', details: [] }

    const ty = String(t['HOUSE_TY'] || '').trim()
    const supplyArea = parseFloat(String(t['SUPLY_AR'] || '0'))
    const topAmount = parseInt(String(t['LTTOT_TOP_AMOUNT'] || '0'))
    // 🔧 청약홈 사이트의 "공급세대수(계)" = 일반공급 + 특별공급 합계
    //   - SUPLY_HSHLDCO   = 일반공급 세대수 (예: 49)
    //   - SPSPLY_HSHLDCO  = 특별공급 세대수 (예: 56)
    //   → suplyHshldco = 두 값의 합 (예: 105) — 청약홈 사이트 표시값과 100% 일치
    const gnrlHshldco = parseInt(String(t['SUPLY_HSHLDCO'] || '0')) || 0
    const spsplyHshldco = parseInt(String(t['SPSPLY_HSHLDCO'] || '0')) || 0
    const suplyHshldco = gnrlHshldco + spsplyHshldco

    const typeLabel = ty.replace(/^0*(\d+)\.?\d*([A-Za-z]*)$/, (_, _num, suffix) => {
      return Math.floor(parseFloat(ty)) + String(suffix).toUpperCase()
    })

    const pyeong = Math.round(supplyArea * 0.3025 * 100) / 100
    const pyeongPrice = pyeong > 0 ? Math.round(topAmount / pyeong) : 0

    if (ty && !typeMap[no].houseTypes.includes(ty)) {
      typeMap[no].houseTypes = typeMap[no].houseTypes ? typeMap[no].houseTypes + ', ' + ty : ty
    }

    if (topAmount > 0) {
      const curMin = typeMap[no].minPrice ? parseInt(typeMap[no].minPrice) : Infinity
      const curMax = typeMap[no].maxPrice ? parseInt(typeMap[no].maxPrice) : 0
      if (topAmount < curMin) typeMap[no].minPrice = String(topAmount)
      if (topAmount > curMax) typeMap[no].maxPrice = String(topAmount)
    }

    if (supplyArea > 0) {
      typeMap[no].details.push({
        type: ty,
        typeLabel,
        supplyArea,
        pyeong,
        topAmount,
        pyeongPrice,
        suplyHshldco,
      })
    }
  })

  Object.values(typeMap).forEach((v) => {
    v.details.sort((a, b) => a.supplyArea - b.supplyArea)
  })

  const transformed = apartments.map((item: ApartmentRow) => {
    const no = item['PBLANC_NO'] || String(Math.random())
    const typeInfo = typeMap[no] || { houseTypes: '', minPrice: '', maxPrice: '', details: [] }

    // 청약홈 API 공식 필드 (기술문서 260129 기준)
    // 특별공급: SPSPLY_RCEPT_BGNDE / SPSPLY_RCEPT_ENDDE
    // 1순위: 해당지역(CRSPAREA) 우선, 없으면 경기(ETC_GG) → 기타지역(ETC_AREA) 순
    const spsplyBgnde = item['SPSPLY_RCEPT_BGNDE'] || ''
    const spsplyEndde = item['SPSPLY_RCEPT_ENDDE'] || ''
    const rank1Bgnde =
      item['GNRL_RNK1_CRSPAREA_RCPTDE'] ||
      item['GNRL_RNK1_ETC_GG_RCPTDE'] ||
      item['GNRL_RNK1_ETC_AREA_RCPTDE'] ||
      ''
    const rank1Endde =
      item['GNRL_RNK1_CRSPAREA_ENDDE'] ||
      item['GNRL_RNK1_ETC_GG_ENDDE'] ||
      item['GNRL_RNK1_ETC_AREA_ENDDE'] ||
      ''

    // 2순위 (1순위 미달 시 추가 접수). 모든 지역 중 가장 늦은 종료일을 실제 접수마감으로 간주
    const rank2Bgnde =
      item['GNRL_RNK2_CRSPAREA_RCPTDE'] ||
      item['GNRL_RNK2_ETC_GG_RCPTDE'] ||
      item['GNRL_RNK2_ETC_AREA_RCPTDE'] ||
      ''
    const rank2Endde =
      item['GNRL_RNK2_ETC_AREA_ENDDE'] ||
      item['GNRL_RNK2_ETC_GG_ENDDE'] ||
      item['GNRL_RNK2_CRSPAREA_ENDDE'] ||
      ''

    // ===== status 판정 (B안: 1순위 결과 반영) =====
    // 1순위 결과 맵에서 단지별 마감 여부 조회
    const rank1Status = rank1StatusMap.get(no) || 'no_data'

    // 실제 접수 종료일 결정:
    //   - 1순위에서 모두 마감(sold_out): RCEPT_ENDDE(=1순위 종료일)까지만 접수중
    //   - 1순위 미달(has_short): 2순위 종료일까지 접수중
    //   - 데이터 없음(no_data, 발표 전): 2순위 종료일까지 접수중으로 가정 (보수적)
    //     ※ 발표 후에도 데이터가 안 들어오면 잘못 판정될 수 있으나, 그땐 사용자가 카드 눌러서 확인
    let realEndDate: string
    if (rank1Status === 'sold_out') {
      // 1순위 마감 → 1순위 종료일 기준
      realEndDate = pickLatestDate([rank1Endde, item['RCEPT_ENDDE'] || ''])
    } else {
      // has_short 또는 no_data → 2순위 종료일까지
      realEndDate = pickLatestDate([
        rank2Endde,
        rank1Endde,
        item['RCEPT_ENDDE'] || '',
      ])
    }

    return {
      id: no,
      name: item['HOUSE_NM'] || '단지명 없음',
      address: item['HSSPLY_ADRES'] || '',
      region: extractRegion(item['SUBSCRPT_AREA_CODE_NM'] || item['HSSPLY_ADRES'] || ''),
      type: item['HOUSE_SECD_NM'] || 'APT',
      totalUnits: item['TOT_SUPLY_HSHLDCO'] || '0',
      rceptBgnde: item['RCEPT_BGNDE'] || '',
      rceptEndde: item['RCEPT_ENDDE'] || '',
      // 특별공급 / 1순위 접수일 (정확한 공식 필드)
      spsplyRceptBgnde: spsplyBgnde,
      spsplyRceptEndde: spsplyEndde,
      rank1RceptBgnde: rank1Bgnde,
      rank1RceptEndde: rank1Endde,
      rank2RceptBgnde: rank2Bgnde,
      rank2RceptEndde: rank2Endde,
      rank1Status,  // 'sold_out' | 'has_short' | 'no_data' (1순위 결과 분류)
      przwnerPresnatnDe: item['PRZWNER_PRESNATN_DE'] || '',
      pblancDe: item['RCRIT_PBLANC_DE'] || '',
      status: getStatus(item['RCEPT_BGNDE'], realEndDate || item['RCEPT_ENDDE']),
      hompageUrl: item['HMPG_ADRES'] || 'https://www.applyhome.co.kr',
      constructor: item['CNSTRCT_ENTRPS_NM'] || '',
      moveInDate: item['MVN_PREARNGE_YM'] || '',
      pdfUrl: item['PBLANC_URL'] || '',
      minPrice: typeInfo.minPrice,
      maxPrice: typeInfo.maxPrice,
      houseTypes: typeInfo.houseTypes,
      typeDetails: typeInfo.details,
    }
  })

  // 공고일 내림차순 정렬 (최신 먼저)
  transformed.sort((a, b) => (b.pblancDe || '').localeCompare(a.pblancDe || ''))
  return transformed
}

// status 는 오늘 날짜 기준으로 다시 계산 (저장 시점과 무관하게 항상 맞도록)
export function applyStatus<T extends { rceptBgnde: string; rceptEndde: string; realEndDate?: string }>(items: T[]): T[] {
  return items.map((it) => ({ ...it, status: getStatus(it.rceptBgnde, it.realEndDate || it.rceptEndde) }))
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

export function getStatus(start: string, end: string): string {
  if (!start || !end) return '접수예정'
  // KST 기준 (Vercel 서버는 UTC)
  const now = new Date(Date.now() + 9 * 3600 * 1000)
  const startDate = new Date(start + 'T00:00:00Z')
  const endDate = new Date(end + 'T00:00:00Z')
  // 종료일은 그날 23:59:59까지 접수중으로 간주 (날짜만 들어와도 당일은 접수중)
  endDate.setUTCHours(23, 59, 59, 999)
  if (now < startDate) return '접수예정'
  if (now > endDate) return '접수마감'
  return '접수중'
}

// 여러 날짜 중 가장 늦은 날짜를 반환 (빈 값/잘못된 값은 무시)
function pickLatestDate(dates: string[]): string {
  let latest = ''
  for (const d of dates) {
    if (!d) continue
    const trimmed = d.trim()
    if (!trimmed) continue
    if (!latest || trimmed > latest) latest = trimmed
  }
  return latest
}


// ===== DB 캐시 (Neon) =====
//   notices_raw   : 공공데이터 원본 페이지를 (endpoint, page) 단위로 저장 — 한 번에 다 못 받아도 조금씩 채운다
//   notices_cache : 화면용으로 조립된 목록 (id=1 한 행). /api/apartments 는 이것만 읽는다
let tablesReady = false
async function sqlClient() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  const sql = neon(url)
  if (!tablesReady) {
    await sql`CREATE TABLE IF NOT EXISTS notices_cache (
      id int PRIMARY KEY,
      items jsonb NOT NULL,
      count int NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE TABLE IF NOT EXISTS notices_raw (
      endpoint text NOT NULL,
      page int NOT NULL,
      data jsonb NOT NULL,
      total int NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (endpoint, page)
    )`
    tablesReady = true
  }
  return sql
}

export type NoticeCache = { items: NoticeItem[]; count: number; updatedAt: string }

export async function loadNoticeCache(): Promise<NoticeCache | null> {
  try {
    const sql = await sqlClient()
    if (!sql) return null
    const rows = (await sql`SELECT items, count, updated_at FROM notices_cache WHERE id = 1`) as Array<{ items: NoticeItem[]; count: number; updated_at: string }>
    if (!rows[0]) return null
    return { items: rows[0].items, count: rows[0].count, updatedAt: new Date(rows[0].updated_at).toISOString() }
  } catch (e) {
    console.error('[notices] cache read fail', e)
    return null
  }
}

export async function saveNoticeCache(items: NoticeItem[]): Promise<boolean> {
  try {
    const sql = await sqlClient()
    if (!sql) return false
    await sql`INSERT INTO notices_cache (id, items, count, updated_at) VALUES (1, ${JSON.stringify(items)}::jsonb, ${items.length}, now())
              ON CONFLICT (id) DO UPDATE SET items = EXCLUDED.items, count = EXCLUDED.count, updated_at = now()`
    return true
  } catch (e) {
    console.error('[notices] cache write fail', e)
    return false
  }
}

// ===== 조각 동기화 =====
const PER_PAGE = 1000
const EP_DETAIL = 'getAPTLttotPblancDetail'
const EP_MDL = 'getAPTLttotPblancMdl'
const MAX_PAGES: Record<string, number> = { [EP_DETAIL]: 10, [EP_MDL]: 30 }

type RawMeta = { endpoint: string; page: number; total: number; updated_at: string }

/** 한 페이지를 키 순서대로 시도해서 받아온다. deadline(절대시각)을 넘기지 않는다 */
async function fetchPageAnyKey(endpoint: string, page: number, deadline: number, trace: string[]): Promise<PageJson | null> {
  for (const key of apiKeys()) {
    const remain = deadline - Date.now()
    if (remain < 1200) return null
    const url = `${BASE_URL}/${endpoint}?serviceKey=${encodeURIComponent(key)}&page=${page}&perPage=${PER_PAGE}&returnType=JSON`
    const t = Date.now()
    const pj = await fetchPage(url, remain - 300)
    if (pj && Array.isArray(pj.data)) return pj
    trace.push(`key${key.slice(0, 4)} 실패 ${Date.now() - t}ms`)
  }
  return null
}

/** 저장된 원본으로부터 "받아야 할 페이지 목록"을 만든다 (1페이지의 totalCount 기준, 모르면 1페이지만) */
function planPages(meta: RawMeta[]): Array<{ endpoint: string; page: number }> {
  const plan: Array<{ endpoint: string; page: number }> = []
  for (const ep of [EP_DETAIL, EP_MDL]) {
    const first = meta.find((m) => m.endpoint === ep && m.page === 1)
    const pages = first ? Math.min(MAX_PAGES[ep], Math.max(1, Math.ceil(first.total / PER_PAGE))) : 1
    for (let p = 1; p <= pages; p++) plan.push({ endpoint: ep, page: p })
  }
  return plan
}

export type SyncResult = {
  ok: boolean
  count: number          // 조립된 캐시 건수 (이번에 조립 안 했으면 기존 캐시 건수)
  ms: number
  fetched: string[]      // 이번 호출에서 받은 페이지들 ("Detail#1 812ms")
  pending: number        // 아직 못 받은(또는 가장 오래된) 페이지 수
  assembled: boolean     // 이번 호출에서 캐시를 다시 조립했는지
  trace: string[]        // 단계별 소요시간 (진단용)
  error?: string
}

/**
 * 공공데이터 → notices_raw(페이지 단위) → notices_cache(조립) 동기화.
 * Vercel Hobby 10초 제한 때문에 한 번 호출에 budgetMs 안에서 받을 수 있는 만큼만 받고,
 * 못 받은 페이지는 다음 호출(크론 10분/🔄 새로고침)이 이어서 받는다.
 *   - 아직 한 번도 안 받은 페이지 먼저, 그다음 가장 오래된 페이지 순
 *   - 모든 페이지가 한 번씩 들어와 있으면 호출 끝에 캐시를 다시 조립해 저장 (시간이 남을 때만)
 *   - 어떤 경우에도 budgetMs + 1초 안에는 응답한다 (내부 작업이 늦어도 중간 결과로 응답)
 */
export async function syncNotices(budgetMs = 7000): Promise<SyncResult> {
  const t0 = Date.now()
  const deadline = t0 + budgetMs
  const fetched: string[] = []
  const trace: string[] = []
  const mark = (label: string) => { const line = `${label} ${Date.now() - t0}ms`; trace.push(line); console.log('[sync]', line) }
  const result = (partial: Partial<SyncResult>): SyncResult =>
    ({ ok: false, count: 0, ms: Date.now() - t0, fetched, pending: 0, assembled: false, trace, ...partial })

  const work = async (): Promise<SyncResult> => {
    if (apiKeys().length === 0) return result({ error: 'API 키 없음' })
    let sql: Awaited<ReturnType<typeof sqlClient>>
    try { sql = await sqlClient() } catch (e) { return result({ error: 'DB 연결 실패: ' + String(e) }) }
    if (!sql) return result({ error: 'DATABASE_URL 없음' })
    mark('db연결')
    console.log('[sync] start budget', budgetMs)

    // 1) 현재 저장 상태
    const meta = (await sql`SELECT endpoint, page, total, updated_at FROM notices_raw`) as RawMeta[]
    mark(`원본메타(${meta.length})`)
    const has = (ep: string, p: number) => meta.find((m) => m.endpoint === ep && m.page === p)
    const ageOf = (ep: string, p: number) => { const m = has(ep, p); return m ? Date.now() - new Date(m.updated_at).getTime() : Infinity }

    // 2) 예산 안에서 페이지 받기: 없는 페이지 → 오래된 페이지 순 (방금 받은 건 제외)
    const nextTarget = () => planPages(meta)
      .filter((x) => ageOf(x.endpoint, x.page) > 60_000)
      .sort((a, b) => ageOf(b.endpoint, b.page) - ageOf(a.endpoint, a.page))[0]
    while (deadline - Date.now() > 2500) {
      const tgt = nextTarget()
      if (!tgt) break
      const { endpoint, page } = tgt
      const label = (endpoint === EP_DETAIL ? 'Detail' : 'Mdl') + '#' + page
      const tp = Date.now()
      const pj = await fetchPageAnyKey(endpoint, page, deadline - 1200, trace)
      if (!pj) { fetched.push(label + ' 실패'); console.log('[sync] fail', label, trace.join(' | ')); break }
      const tf = Date.now()
      const total = Number(pj.totalCount ?? 0)
      await sql`INSERT INTO notices_raw (endpoint, page, data, total, updated_at)
                VALUES (${endpoint}, ${page}, ${JSON.stringify(pj.data)}::jsonb, ${total}, now())
                ON CONFLICT (endpoint, page) DO UPDATE SET data = EXCLUDED.data, total = EXCLUDED.total, updated_at = now()`
      fetched.push(`${label} api${tf - tp}ms db${Date.now() - tf}ms`)
      console.log('[sync] fetched', fetched[fetched.length - 1])
      const m = has(endpoint, page)
      if (m) { m.total = total; m.updated_at = new Date().toISOString() }
      else meta.push({ endpoint, page, total, updated_at: new Date().toISOString() })
    }
    mark('수신완료')

    // 3) 모든 페이지가 들어와 있고 시간이 남으면 조립 → notices_cache 저장
    const plan = planPages(meta)
    const missing = plan.filter((x) => !has(x.endpoint, x.page)).length
    const stale = plan.filter((x) => ageOf(x.endpoint, x.page) > 2 * 3600_000).length
    if (missing > 0) {
      const cache = await loadNoticeCache()
      return result({ ok: true, count: cache?.count ?? 0, pending: missing, error: `원본 ${missing}페이지 미수신 — 다시 호출하면 이어서 받습니다` })
    }
    if (deadline + 1500 - Date.now() < 2500) {
      const cache = await loadNoticeCache()
      return result({ ok: true, count: cache?.count ?? 0, pending: stale, error: '원본은 다 있으나 조립할 시간 부족 — 다음 호출에서 조립' })
    }
    const rows = (await sql`SELECT endpoint, page, data FROM notices_raw ORDER BY endpoint, page`) as Array<{ endpoint: string; page: number; data: unknown[] }>
    mark('원본읽기')
    const apartments: ApartmentRow[] = []
    const types: TypeRow[] = []
    for (const r of rows) {
      if (r.endpoint === EP_DETAIL) apartments.push(...(r.data as ApartmentRow[]))
      else if (r.endpoint === EP_MDL) types.push(...(r.data as TypeRow[]))
    }
    if (apartments.length === 0) return result({ error: '공고 상세 원본이 비어 있음' })
    const items = buildNoticeItems(apartments, types, new Map<string, Rank1Status>())
    mark('조립')
    const saved = await saveNoticeCache(items)
    mark('저장')
    return result({ ok: saved, count: items.length, pending: stale, assembled: true, error: saved ? undefined : 'DB 저장 실패' })
  }

  // 어떤 경우에도 제한시간 안에 응답 (타임아웃 504 대신 진단 정보를 돌려준다)
  const guard = new Promise<SyncResult>((resolve) =>
    setTimeout(() => { console.log('[sync] guard fired', trace.join(' | '), fetched.join(' | ')); resolve(result({ ok: true, error: `시간 초과 — 중간까지 처리됨`, pending: -1 })) }, budgetMs + 1200))
  return Promise.race([work(), guard])
}
