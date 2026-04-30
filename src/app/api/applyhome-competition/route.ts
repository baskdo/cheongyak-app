import { NextResponse } from 'next/server'

// 청약홈 경쟁률 페이지를 직접 조회해서 정형화된 JSON으로 반환
// 사용 시점: 공공 API(/api/competition)에 데이터가 없는 단지에 한해 폴백 호출
//
// 캐시: 5분 (revalidate=300) — 같은 단지 5분 내 재호출 시 청약홈 안 두드림

// =============== 타입 ===============
type Rank1ByType = {
  type: string         // 원본 주택형 ("048.6543")
  typeLabel: string    // 표시용 ("48")
  suply: number        // 공급세대수
  local: number        // 1순위 해당지역 접수건수
  etc: number          // 1순위 기타지역 접수건수
  total: number        // 1순위 합계 (해당+기타)
  rate: number         // 1순위 경쟁률 (해당지역 기준 청약홈 표시값)
}

type ApplyhomeCompetitionResponse = {
  ok: boolean
  pblancNo: string
  source: 'applyhome'
  fetchedAt: string    // ISO 시각
  rank1ByType: Rank1ByType[]
  totalSuply: number
  totalLocal: number
  totalEtc: number
  totalAll: number     // 합계 (PDF의 "총합계"와 일치해야 함)
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

// =============== 1순위 집계 ===============
function aggregateRank1(parsed: ParsedRow[]): {
  rank1ByType: Rank1ByType[]
  totalSuply: number
  totalLocal: number
  totalEtc: number
  totalAll: number
} {
  // 주택형별로 1순위 해당/기타 합산
  const map = new Map<string, Rank1ByType>()

  for (const row of parsed) {
    if (row.rank !== '1순위') continue
    const key = row.type
    if (!map.has(key)) {
      map.set(key, {
        type: key,
        typeLabel: makeTypeLabel(key),
        suply: row.suply,
        local: 0,
        etc: 0,
        total: 0,
        rate: 0,
      })
    }
    const entry = map.get(key)!
    if (row.suply > entry.suply) entry.suply = row.suply

    if (row.region === '해당지역') {
      entry.local += row.reqCnt
      // 청약홈 사이트 경쟁률 표시값 보존 (해당지역 행에 적힌 값)
      if (row.rate > 0) entry.rate = row.rate
    } else if (row.region === '기타지역') {
      entry.etc += row.reqCnt
    }
  }

  const rank1ByType = Array.from(map.values())
    .map((e) => ({ ...e, total: e.local + e.etc }))
    .sort((a, b) => a.type.localeCompare(b.type))

  const totalSuply = rank1ByType.reduce((s, r) => s + r.suply, 0)
  const totalLocal = rank1ByType.reduce((s, r) => s + r.local, 0)
  const totalEtc = rank1ByType.reduce((s, r) => s + r.etc, 0)
  const totalAll = totalLocal + totalEtc

  return { rank1ByType, totalSuply, totalLocal, totalEtc, totalAll }
}

// =============== GET ===============
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pblancNo = (searchParams.get('pblancNo') || '').trim()
  const debug = searchParams.get('debug') === '1'

  if (!pblancNo || !/^\d{6,12}$/.test(pblancNo)) {
    return NextResponse.json<ApplyhomeCompetitionResponse>({
      ok: false,
      pblancNo,
      source: 'applyhome',
      fetchedAt: new Date().toISOString(),
      rank1ByType: [],
      totalSuply: 0,
      totalLocal: 0,
      totalEtc: 0,
      totalAll: 0,
      error: 'pblancNo가 유효하지 않음',
    }, { status: 400 })
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
      return NextResponse.json<ApplyhomeCompetitionResponse>({
        ok: false,
        pblancNo,
        source: 'applyhome',
        fetchedAt: new Date().toISOString(),
        rank1ByType: [],
        totalSuply: 0,
        totalLocal: 0,
        totalEtc: 0,
        totalAll: 0,
        error: `청약홈 응답 실패: ${res.status}`,
      })
    }

    const html = await res.text()
    const parsed = parseCompetitionHtml(html)
    const agg = aggregateRank1(parsed.rows)

    // 1순위 데이터가 한 행도 없으면 → 청약홈도 아직 발표 전
    if (agg.rank1ByType.length === 0) {
      return NextResponse.json<ApplyhomeCompetitionResponse>({
        ok: false,
        pblancNo,
        source: 'applyhome',
        fetchedAt: new Date().toISOString(),
        rank1ByType: [],
        totalSuply: 0,
        totalLocal: 0,
        totalEtc: 0,
        totalAll: 0,
        error: '청약홈에 1순위 데이터 없음 (발표 전이거나 단지 누락)',
        ...(debug ? { raw: { rowCount: parsed.rowCount, sampleRow: parsed.sampleRow } } : {}),
      })
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
    return NextResponse.json<ApplyhomeCompetitionResponse>({
      ok: false,
      pblancNo,
      source: 'applyhome',
      fetchedAt: new Date().toISOString(),
      rank1ByType: [],
      totalSuply: 0,
      totalLocal: 0,
      totalEtc: 0,
      totalAll: 0,
      error: String(e),
    })
  }
}
