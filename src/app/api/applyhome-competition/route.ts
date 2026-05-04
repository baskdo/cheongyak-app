import { NextResponse } from 'next/server'

// 청약홈 경쟁률 페이지를 직접 조회해서 정형화된 JSON으로 반환
// 사용 시점: 공공 API(/api/competition)에 데이터가 없는 단지에 한해 폴백 호출
//
// 캐시: 5분 (revalidate=300) — 같은 단지 5분 내 재호출 시 청약홈 안 두드림
//
// [v2] 1순위 + 2순위 + 1·2순위 총계 모두 집계 (2순위 데이터도 같은 페이지에 포함)

// =============== 타입 ===============

// 1순위 한 행
type Rank1ByType = {
  type: string         // 원본 주택형 ("048.6543")
  typeLabel: string    // 표시용 ("48")
  suply: number        // 공급세대수
  local: number        // 1순위 해당지역 접수건수
  etc: number          // 1순위 기타지역 접수건수
  total: number        // 1순위 합계 (해당+기타)
  rate: number         // 1순위 경쟁률 (해당지역 기준 청약홈 표시값)
}

// 2순위 한 행 (공급세대 없음 — 1순위 미달분에 대한 추가접수)
type Rank2ByType = {
  type: string
  typeLabel: string
  hasData: boolean     // 2순위 접수가 있었는지 (false면 1순위 마감)
  local: number        // 2순위 해당지역
  etc: number          // 2순위 기타지역
  total: number        // 2순위 합계
  rate: number         // 2순위 경쟁률 (해당지역 기준 청약홈 표시값)
}

// 1+2순위 총계 한 행
type CombinedByType = {
  type: string
  typeLabel: string
  suply: number        // 공급세대수 (1순위 기준)
  totalReq: number     // 1순위 + 2순위 총 접수건수
  combinedRate: number // 총접수 / 1순위 공급세대 (청약홈 방식)
}

type ApplyhomeCompetitionResponse = {
  ok: boolean
  pblancNo: string
  source: 'applyhome'
  fetchedAt: string                  // ISO 시각
  // 1순위 (기존 호환 유지)
  rank1ByType: Rank1ByType[]
  totalSuply: number
  totalLocal: number
  totalEtc: number
  totalAll: number                   // 1순위 합계
  // 2순위 (신규)
  rank2ByType: Rank2ByType[]
  rank2TotalLocal: number
  rank2TotalEtc: number
  rank2TotalAll: number
  hasRank2: boolean                  // 2순위 행이 1개라도 있는지
  // 1+2순위 총계 (신규)
  combinedByType: CombinedByType[]
  combinedTotalReq: number           // 1순위 + 2순위 총 접수건수 합
  combinedRate: number               // combinedTotalReq / totalSuply
  error?: string
  raw?: { rowCount: number; sampleRow?: string[] }  // 디버그용
}

// =============== 헬퍼 ===============
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function cleanCell(rawCellInner: string): string {
  return decodeHtmlEntities(stripTags(rawCellInner))
}

// "1,438" → 1438, "-" → 0, "" → 0
function parseInt0(s: string): number {
  const cleaned = (s || '').replace(/,/g, '').trim()
  if (!cleaned || cleaned === '-') return 0
  const n = parseInt(cleaned, 10)
  return isNaN(n) ? 0 : n
}

// "75.68" → 75.68, "-" → 0
function parseFloat0(s: string): number {
  const cleaned = (s || '').replace(/,/g, '').trim()
  if (!cleaned || cleaned === '-') return 0
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

// 주택형 표시: "048.6543" → "48", "059.9880A" → "59A"
function makeTypeLabel(ty: string): string {
  const trimmed = (ty || '').trim()
  if (!trimmed) return ''
  const numMatch = trimmed.match(/^0*(\d+)\.?\d*/)
  const num = numMatch ? parseInt(numMatch[1], 10) : 0
  const suffix = trimmed.match(/[A-Za-z]+$/)?.[0] || ''
  return `${num}${suffix.toUpperCase()}`
}

// =============== HTML 파싱 ===============
type ParsedRow = {
  type: string         // 주택형 ("048.6543")
  suply: number        // 공급세대수
  rank: string         // "1순위" / "2순위" / ""
  region: string       // "해당지역" / "기타지역" / ""
  reqCnt: number       // 접수건수
  rate: number         // 경쟁률 (사이트 표시값)
}

function parseCompetitionHtml(html: string): { rows: ParsedRow[]; rowCount: number; sampleRow?: string[] } {
  // compitTbl 테이블만 추출
  const tableMatch = html.match(/<table[^>]*id="compitTbl"[\s\S]*?<\/table>/)
  if (!tableMatch) {
    return { rows: [], rowCount: 0 }
  }
  const tableHtml = tableMatch[0]

  // 행(tr) 추출
  const rowMatches = Array.from(tableHtml.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g))
  const rows: ParsedRow[] = []
  let firstSampleRow: string[] | undefined

  for (const m of rowMatches) {
    const rowHtml = m[0]
    // 셀(td/th) 텍스트 추출
    const cellMatches = Array.from(rowHtml.matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/g))
    const cells = cellMatches.map((c) => cleanCell(c[2]))

    if (!firstSampleRow && cells.length === 8) firstSampleRow = cells

    // 데이터 행 식별: 8개 셀 + 첫 셀이 주택형 형식 ("000.0000A")
    if (cells.length !== 8) continue
    const typeStr = cells[0]
    if (!/^\d{3}\.\d{4}/.test(typeStr)) continue

    rows.push({
      type: typeStr.trim(),
      suply: parseInt0(cells[1]),
      rank: cells[2],
      region: cells[3],
      reqCnt: parseInt0(cells[4]),
      rate: parseFloat0(cells[5]),
    })
  }

  return { rows, rowCount: rowMatches.length, sampleRow: firstSampleRow }
}

// =============== 1순위 + 2순위 + 합계 집계 ===============
function aggregateAllRanks(parsed: ParsedRow[]): {
  rank1ByType: Rank1ByType[]
  totalSuply: number
  totalLocal: number
  totalEtc: number
  totalAll: number
  rank2ByType: Rank2ByType[]
  rank2TotalLocal: number
  rank2TotalEtc: number
  rank2TotalAll: number
  hasRank2: boolean
  combinedByType: CombinedByType[]
  combinedTotalReq: number
  combinedRate: number
} {
  // === 1순위 집계 ===
  const r1Map = new Map<string, Rank1ByType>()
  for (const row of parsed) {
    if (row.rank !== '1순위') continue
    const key = row.type
    if (!r1Map.has(key)) {
      r1Map.set(key, {
        type: key,
        typeLabel: makeTypeLabel(key),
        suply: row.suply,
        local: 0,
        etc: 0,
        total: 0,
        rate: 0,
      })
    }
    const e = r1Map.get(key)!
    if (row.suply > e.suply) e.suply = row.suply
    if (row.region === '해당지역') {
      e.local += row.reqCnt
      if (row.rate > 0) e.rate = row.rate
    } else if (row.region === '기타지역') {
      e.etc += row.reqCnt
    }
  }
  const rank1ByType = Array.from(r1Map.values())
    .map((e) => ({ ...e, total: e.local + e.etc }))
    .sort((a, b) => a.type.localeCompare(b.type))

  // === 2순위 집계 ===
  const r2Map = new Map<string, Rank2ByType>()
  for (const row of parsed) {
    if (row.rank !== '2순위') continue
    const key = row.type
    if (!r2Map.has(key)) {
      r2Map.set(key, {
        type: key,
        typeLabel: makeTypeLabel(key),
        hasData: true,
        local: 0,
        etc: 0,
        total: 0,
        rate: 0,
      })
    }
    const e = r2Map.get(key)!
    if (row.region === '해당지역') {
      e.local += row.reqCnt
      if (row.rate > 0) e.rate = row.rate
    } else if (row.region === '기타지역') {
      e.etc += row.reqCnt
    }
  }
  // 1순위 주택형 순서를 따라가며 2순위 행 정렬 (없으면 hasData=false)
  const rank2ByType: Rank2ByType[] = rank1ByType.map((r1) => {
    const r2 = r2Map.get(r1.type)
    if (r2) {
      return { ...r2, total: r2.local + r2.etc }
    }
    return {
      type: r1.type,
      typeLabel: r1.typeLabel,
      hasData: false,
      local: 0,
      etc: 0,
      total: 0,
      rate: 0,
    }
  })

  // === 1순위 합계 ===
  const totalSuply = rank1ByType.reduce((s, r) => s + r.suply, 0)
  const totalLocal = rank1ByType.reduce((s, r) => s + r.local, 0)
  const totalEtc = rank1ByType.reduce((s, r) => s + r.etc, 0)
  const totalAll = totalLocal + totalEtc

  // === 2순위 합계 (hasData만) ===
  const rank2TotalLocal = rank2ByType.filter(r => r.hasData).reduce((s, r) => s + r.local, 0)
  const rank2TotalEtc = rank2ByType.filter(r => r.hasData).reduce((s, r) => s + r.etc, 0)
  const rank2TotalAll = rank2TotalLocal + rank2TotalEtc
  const hasRank2 = rank2ByType.some((r) => r.hasData)

  // === 1+2순위 총계 (분모는 1순위 공급세대만) ===
  const combinedByType: CombinedByType[] = rank1ByType.map((r1) => {
    const r2 = rank2ByType.find((x) => x.type === r1.type)
    const r2Total = r2?.hasData ? r2.total : 0
    const totalReq = r1.total + r2Total
    return {
      type: r1.type,
      typeLabel: r1.typeLabel,
      suply: r1.suply,
      totalReq,
      combinedRate: r1.suply > 0 ? totalReq / r1.suply : 0,
    }
  })
  const combinedTotalReq = totalAll + rank2TotalAll
  const combinedRate = totalSuply > 0 ? combinedTotalReq / totalSuply : 0

  return {
    rank1ByType,
    totalSuply,
    totalLocal,
    totalEtc,
    totalAll,
    rank2ByType,
    rank2TotalLocal,
    rank2TotalEtc,
    rank2TotalAll,
    hasRank2,
    combinedByType,
    combinedTotalReq,
    combinedRate,
  }
}

// =============== 빈 응답 헬퍼 ===============
function emptyResponse(pblancNo: string, error: string, debug?: { rowCount: number; sampleRow?: string[] }): ApplyhomeCompetitionResponse {
  return {
    ok: false,
    pblancNo,
    source: 'applyhome',
    fetchedAt: new Date().toISOString(),
    rank1ByType: [],
    totalSuply: 0,
    totalLocal: 0,
    totalEtc: 0,
    totalAll: 0,
    rank2ByType: [],
    rank2TotalLocal: 0,
    rank2TotalEtc: 0,
    rank2TotalAll: 0,
    hasRank2: false,
    combinedByType: [],
    combinedTotalReq: 0,
    combinedRate: 0,
    error,
    ...(debug ? { raw: debug } : {}),
  }
}

// =============== GET ===============
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pblancNo = (searchParams.get('pblancNo') || '').trim()
  const debug = searchParams.get('debug') === '1'

  if (!pblancNo || !/^\d{6,12}$/.test(pblancNo)) {
    return NextResponse.json<ApplyhomeCompetitionResponse>(
      emptyResponse(pblancNo, 'pblancNo가 유효하지 않음'),
      { status: 400 }
    )
  }

  const targetUrl = `https://www.applyhome.co.kr/ai/aia/selectAPTCompetitionPopup.do?houseManageNo=${pblancNo}&pblancNo=${pblancNo}`

  try {
    // ⚡ 5분 캐시 (Vercel 전역 공유)
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': 'https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancListView.do',
      },
      next: { revalidate: 300 }, // 5분
    })

    if (!res.ok) {
      return NextResponse.json<ApplyhomeCompetitionResponse>(
        emptyResponse(pblancNo, `청약홈 응답 실패: ${res.status}`)
      )
    }

    const html = await res.text()
    const parsed = parseCompetitionHtml(html)
    const agg = aggregateAllRanks(parsed.rows)

    // 1순위 데이터가 한 행도 없으면 → 청약홈도 아직 발표 전
    if (agg.rank1ByType.length === 0) {
      return NextResponse.json<ApplyhomeCompetitionResponse>(
        emptyResponse(
          pblancNo,
          '청약홈에 1순위 데이터 없음 (발표 전이거나 단지 누락)',
          debug ? { rowCount: parsed.rowCount, sampleRow: parsed.sampleRow } : undefined
        )
      )
    }

    return NextResponse.json<ApplyhomeCompetitionResponse>({
      ok: true,
      pblancNo,
      source: 'applyhome',
      fetchedAt: new Date().toISOString(),
      ...agg,
      ...(debug ? { raw: { rowCount: parsed.rowCount, sampleRow: parsed.sampleRow } } : {}),
    })
  } catch (e) {
    return NextResponse.json<ApplyhomeCompetitionResponse>(
      emptyResponse(pblancNo, String(e))
    )
  }
}
