import { NextResponse } from 'next/server'

// 청약홈 특별공급 신청현황 페이지를 직접 조회해서 정형화된 JSON으로 반환
// 사용 시점: 공공 API(/api/special-supply)에 데이터가 없는 단지에 한해 폴백 호출
//
// 캐시: 5분 (revalidate=300) — 같은 단지 5분 내 재호출 시 청약홈 안 두드림
//
// 1순위 폴백(/api/applyhome-competition)과 완전히 동일한 호출/응답 패턴.
//   - 단건 전용 (?pblancNo=...)
//   - 응답: { ok, pblancNo, source: 'applyhome-spsply', fetchedAt, houseTypes:[...], error?, raw? }

// =============== 응답 타입 ===============

// 일반 6분류 (지역구분 있음)
type GeneralCategory = {
  name: '다자녀' | '신혼부부' | '생애최초' | '청년' | '노부모' | '신생아'
  suply: number          // 배정세대수
  local: number          // 해당지역 접수
  ggOther: number        // 기타경기 접수 (다자녀만 별도; 그 외는 0)
  etc: number            // 기타지역 접수
  total: number          // local + ggOther + etc
}

// 기관 분류 (결정/미결)
type InstCategory = {
  name: '기관추천' | '이전기관'
  suply: number          // 배정세대수
  decided: number        // 결정
  pending: number        // 미결
  total: number          // decided + pending
}

// 주택형별 데이터
type HouseTypeRow = {
  type: string                       // "059.9000A"
  typeLabel: string                  // "59A"
  spsplyHshldco: number              // 공급세대수
  general: GeneralCategory[]
  inst: InstCategory[]
  totalAssigned: number              // 모든 카테고리 배정 합 = spsplyHshldco
  totalApplied: number               // 모든 카테고리 접수 합
}

type ApplyhomeSpsplyResponse = {
  ok: boolean
  pblancNo: string
  source: 'applyhome-spsply'
  fetchedAt: string                  // ISO 시각
  subscrptResultNm: string           // 청약결과 ("청약접수 종료" 등)
  houseTypes: HouseTypeRow[]
  totalSuply: number                 // 모든 주택형 공급 합
  totalApplied: number               // 모든 주택형 청약 합
  error?: string
  raw?: { trCount: number; gridLen: number }   // 디버그용
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

// "1,438" → 1438, "-" / "" / "READON" → 0
function parseInt0(s: string): number {
  if (!s || s === 'READON') return 0
  const cleaned = s.replace(/,/g, '').trim()
  if (!cleaned || cleaned === '-') return 0
  // "3(0)" 같은 형식이 들어오면 앞 숫자만
  const m = cleaned.match(/^-?\d+/)
  if (!m) return 0
  return parseInt(m[0], 10) || 0
}

// "3(0)" → { decided: 3, pending: 0 }
// 단순 숫자 "0" → { decided: 0, pending: 0 }
function parseInstText(v: string): { decided: number; pending: number } {
  if (!v || v === 'READON') return { decided: 0, pending: 0 }
  const m = v.match(/^\s*(-?\d+)\s*\(\s*(-?\d+)\s*\)\s*$/)
  if (m) return { decided: parseInt(m[1], 10) || 0, pending: parseInt(m[2], 10) || 0 }
  return { decided: parseInt0(v), pending: 0 }
}

// "059.9000A" → "59A", "084.3400A" → "84A", "048.6543" → "48"
function makeTypeLabel(ty: string): string {
  const trimmed = (ty || '').trim()
  if (!trimmed) return ''
  const numMatch = trimmed.match(/^0*(\d+)\.?\d*/)
  const num = numMatch ? parseInt(numMatch[1], 10) : 0
  const suffix = trimmed.match(/[A-Za-z]+$/)?.[0] || ''
  return `${num}${suffix.toUpperCase()}`
}

// =============== HTML 파싱 ===============
type CellInfo = { text: string; rowspan: number; readon: boolean }

function extractBodyRows(html: string): CellInfo[][] {
  // tbody만 추출
  const bodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)
  if (!bodyMatch) return []
  const body = bodyMatch[1]

  const rows: CellInfo[][] = []
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch: RegExpExecArray | null
  while ((trMatch = trRegex.exec(body)) !== null) {
    const trInner = trMatch[1]
    const cells: CellInfo[] = []
    const tdRegex = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi
    let tdMatch: RegExpExecArray | null
    while ((tdMatch = tdRegex.exec(trInner)) !== null) {
      const attrs = tdMatch[1] || ''
      const inner = tdMatch[2] || ''
      const rowspanMatch = attrs.match(/\browspan\s*=\s*["']?(\d+)/i)
      const classMatch = attrs.match(/\bclass\s*=\s*["']([^"']*)["']/i)
      const rowspan = rowspanMatch ? parseInt(rowspanMatch[1], 10) : 1
      const cls = classMatch ? classMatch[1] : ''
      cells.push({
        text: cleanCell(inner),
        rowspan,
        readon: cls.includes('readon'),
      })
    }
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

/**
 * rowspan을 평탄화하여 13컬럼 가상 격자로 변환.
 * [주택형, 공급, 지역, 다자녀, 신혼, 생애최초, 청년, 노부모, 신생아, 기관추천, 이전기관, 청약결과, 미사용]
 */
function buildGrid(rows: CellInfo[][]): string[][] {
  const GRID_W = 13
  const grid: string[][] = []
  const pending = new Map<number, { text: string; remain: number }>()

  for (const row of rows) {
    const newRow: string[] = new Array(GRID_W).fill('')
    let col = 0
    let cellIdx = 0
    while (col < GRID_W) {
      const p = pending.get(col)
      if (p) {
        newRow[col] = p.text
        if (p.remain - 1 > 0) {
          pending.set(col, { text: p.text, remain: p.remain - 1 })
        } else {
          pending.delete(col)
        }
        col += 1
        continue
      }
      if (cellIdx >= row.length) break
      const cell = row[cellIdx]
      cellIdx += 1
      const value = cell.readon ? 'READON' : cell.text
      newRow[col] = value
      if (cell.rowspan > 1) {
        pending.set(col, { text: value, remain: cell.rowspan - 1 })
      }
      col += 1
    }
    grid.push(newRow)
  }
  return grid
}

/**
 * 격자에서 4행 블록(배정/해당/기타경기/기타지역)을 모두 추출하여 HouseTypeRow 배열로 변환.
 * "총합계" 행은 무시.
 */
function gridToHouseTypes(grid: string[][]): { houseTypes: HouseTypeRow[]; subscrptResultNm: string } {
  const out: HouseTypeRow[] = []
  let firstResultNm = ''

  let i = 0
  while (i + 3 < grid.length) {
    const block = grid.slice(i, i + 4)
    // 배정행 식별: 3번째 컬럼이 "배정세대수"
    if (block[0][2] !== '배정세대수') {
      i += 1
      continue
    }

    const ty = block[0][0]
    const suply = parseInt0(block[0][1])
    if (!firstResultNm) firstResultNm = block[0][11] || ''

    // 배정 8개 (idx 3~10)
    const assigned = {
      다자녀:   parseInt0(block[0][3]),
      신혼부부: parseInt0(block[0][4]),
      생애최초: parseInt0(block[0][5]),
      청년:     parseInt0(block[0][6]),
      노부모:   parseInt0(block[0][7]),
      신생아:   parseInt0(block[0][8]),
      기관추천: parseInt0(block[0][9]),
      이전기관: parseInt0(block[0][10]),
    }

    // 해당지역 (block[1])
    const crsparea = {
      다자녀:   parseInt0(block[1][3]),
      신혼부부: parseInt0(block[1][4]),
      생애최초: parseInt0(block[1][5]),
      청년:     parseInt0(block[1][6]),
      노부모:   parseInt0(block[1][7]),
      신생아:   parseInt0(block[1][8]),
    }
    const insttRecom = parseInstText(block[1][9])    // "3(0)" 형식
    const transrInst = parseInstText(block[1][10])

    // 기타경기 (block[2]) - 다자녀(idx 3)만 값, 그 외 readon
    const ctprvnMnych = parseInt0(block[2][3])

    // 기타지역 (block[3])
    const etcArea = {
      다자녀:   parseInt0(block[3][3]),
      신혼부부: parseInt0(block[3][4]),
      생애최초: parseInt0(block[3][5]),
      청년:     parseInt0(block[3][6]),
      노부모:   parseInt0(block[3][7]),
      신생아:   parseInt0(block[3][8]),
    }

    // 일반 6분류 (배정 > 0 인 것만 포함)
    const generalDefs: Array<{ name: GeneralCategory['name']; hasGgRow: boolean }> = [
      { name: '다자녀',   hasGgRow: true  },
      { name: '신혼부부', hasGgRow: false },
      { name: '생애최초', hasGgRow: false },
      { name: '청년',     hasGgRow: false },
      { name: '노부모',   hasGgRow: false },
      { name: '신생아',   hasGgRow: false },
    ]
    const general: GeneralCategory[] = []
    for (const g of generalDefs) {
      const sup = assigned[g.name]
      if (sup <= 0) continue
      const local = crsparea[g.name]
      const gg = g.hasGgRow ? ctprvnMnych : 0
      const etc = etcArea[g.name]
      general.push({
        name: g.name,
        suply: sup,
        local,
        ggOther: gg,
        etc,
        total: local + gg + etc,
      })
    }

    // 기관 분류
    const inst: InstCategory[] = []
    if (assigned.기관추천 > 0) {
      inst.push({
        name: '기관추천',
        suply: assigned.기관추천,
        decided: insttRecom.decided,
        pending: insttRecom.pending,
        total: insttRecom.decided + insttRecom.pending,
      })
    }
    if (assigned.이전기관 > 0) {
      inst.push({
        name: '이전기관',
        suply: assigned.이전기관,
        decided: transrInst.decided,
        pending: transrInst.pending,
        total: transrInst.decided + transrInst.pending,
      })
    }

    const totalAssigned =
      general.reduce((s, c) => s + c.suply, 0) +
      inst.reduce((s, c) => s + c.suply, 0)
    const totalApplied =
      general.reduce((s, c) => s + c.total, 0) +
      inst.reduce((s, c) => s + c.total, 0)

    out.push({
      type: ty,
      typeLabel: makeTypeLabel(ty),
      spsplyHshldco: suply,
      general,
      inst,
      totalAssigned,
      totalApplied,
    })

    i += 4
  }

  return { houseTypes: out, subscrptResultNm: firstResultNm }
}

// =============== 빈 응답 헬퍼 ===============
function emptyResponse(
  pblancNo: string,
  error: string,
  debug?: { trCount: number; gridLen: number }
): ApplyhomeSpsplyResponse {
  return {
    ok: false,
    pblancNo,
    source: 'applyhome-spsply',
    fetchedAt: new Date().toISOString(),
    subscrptResultNm: '',
    houseTypes: [],
    totalSuply: 0,
    totalApplied: 0,
    error,
    ...(debug ? { raw: debug } : {}),
  }
}

// =============== GET ===============
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pblancNo = (searchParams.get('pblancNo') || '').trim()
  const houseNm = (searchParams.get('houseNm') || '').trim()
  const debug = searchParams.get('debug') === '1'

  if (!pblancNo || !/^\d{6,12}$/.test(pblancNo)) {
    return NextResponse.json<ApplyhomeSpsplyResponse>(
      emptyResponse(pblancNo, 'pblancNo가 유효하지 않음'),
      { status: 400 }
    )
  }

  const targetUrl = 'https://www.applyhome.co.kr/ai/aia/selectSpsplyReqstStusPopup.do'

  // POST body — 청약홈은 houseNm을 넣어주는 게 정석이지만 빈 값이어도 응답은 옴
  const body = new URLSearchParams()
  body.set('houseManageNo', pblancNo)
  body.set('pblancNo', pblancNo)
  body.set('houseNm', houseNm || pblancNo) // houseNm 비어있으면 공고번호로 대체
  body.set('gvPgmId', 'AIA01M01')

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      body: body.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html, */*; q=0.01',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': 'https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancListView.do',
        'Origin': 'https://www.applyhome.co.kr',
        'X-Requested-With': 'XMLHttpRequest',
      },
      next: { revalidate: 300 }, // 5분 (1순위 폴백과 동일)
    })

    if (!res.ok) {
      return NextResponse.json<ApplyhomeSpsplyResponse>(
        emptyResponse(pblancNo, `청약홈 응답 실패: ${res.status}`)
      )
    }

    const html = await res.text()
    const trRows = extractBodyRows(html)
    const grid = buildGrid(trRows)
    const { houseTypes, subscrptResultNm } = gridToHouseTypes(grid)

    if (houseTypes.length === 0) {
      return NextResponse.json<ApplyhomeSpsplyResponse>(
        emptyResponse(
          pblancNo,
          '청약홈에 특공 데이터 없음 (발표 전이거나 단지 누락)',
          debug ? { trCount: trRows.length, gridLen: grid.length } : undefined
        )
      )
    }

    const totalSuply = houseTypes.reduce((s, h) => s + h.spsplyHshldco, 0)
    const totalApplied = houseTypes.reduce((s, h) => s + h.totalApplied, 0)

    return NextResponse.json<ApplyhomeSpsplyResponse>({
      ok: true,
      pblancNo,
      source: 'applyhome-spsply',
      fetchedAt: new Date().toISOString(),
      subscrptResultNm,
      houseTypes,
      totalSuply,
      totalApplied,
      ...(debug ? { raw: { trCount: trRows.length, gridLen: grid.length } } : {}),
    })
  } catch (e) {
    return NextResponse.json<ApplyhomeSpsplyResponse>(
      emptyResponse(pblancNo, String(e))
    )
  }
}
