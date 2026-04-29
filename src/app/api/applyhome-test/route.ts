import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// 청약홈 경쟁률 페이지 검증 + 표 구조 분석 라우트
//
// 사용법:
// 1) 기본 진단:        /api/applyhome-test?pblancNo=2026000114
// 2) 표 구조 추출:     /api/applyhome-test?pblancNo=2026000114&mode=table
// 3) 전체 본문(디버그): /api/applyhome-test?pblancNo=2026000114&mode=full
//
// ⚠️ 검증 전용 — 본격 통합 후 삭제 예정

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pblancNo = (searchParams.get('pblancNo') || '').trim()
  const mode = (searchParams.get('mode') || '').trim()

  if (!pblancNo) {
    return NextResponse.json({
      error: 'pblancNo 파라미터가 필요합니다',
      usage: '/api/applyhome-test?pblancNo=2026000114&mode=table',
    }, { status: 400 })
  }

  const targetUrl = `https://www.applyhome.co.kr/ai/aia/selectAPTCompetitionPopup.do?houseManageNo=${pblancNo}&pblancNo=${pblancNo}`
  const startedAt = Date.now()

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': 'https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancListView.do',
      },
      cache: 'no-store',
    })

    const elapsedMs = Date.now() - startedAt
    const html = await res.text()

    // === 모드별 응답 ===

    // [mode=table] 표 부분만 추출
    if (mode === 'table') {
      const tableMatch = html.match(/<table[^>]*id="compitTbl"[\s\S]*?<\/table>/)
      const tableHtml = tableMatch ? tableMatch[0] : null

      if (!tableHtml) {
        return NextResponse.json({
          ok: false,
          error: 'compitTbl 테이블을 찾지 못함',
          htmlLength: html.length,
          firstTableMatch: html.match(/<table[\s\S]{0,300}/)?.[0] || null,
        })
      }

      // 행(tr) 추출 - Array.from으로 iterator → 배열 변환 (TS downlevelIteration 회피)
      const rowMatches = Array.from(tableHtml.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g))
      const rows: string[] = rowMatches.map((m) => m[0])

      // 행별로 셀(td/th) 텍스트 추출
      const parsedRows = rows.map((row, i) => {
        const cellMatches = Array.from(row.matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/g))
        const cells: string[] = cellMatches.map((c) => {
          // 태그 제거 + 공백 정리
          return c[2]
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()
        })
        return { rowIndex: i, cellCount: cells.length, cells }
      })

      return NextResponse.json({
        ok: true,
        mode: 'table',
        targetUrl,
        httpStatus: res.status,
        elapsedMs,
        rowCount: parsedRows.length,
        parsedRows,
        rawTableSample: {
          first2000chars: tableHtml.slice(0, 2000),
          last500chars: tableHtml.length > 2500 ? tableHtml.slice(-500) : '',
          totalLength: tableHtml.length,
        },
      })
    }

    // [mode=full] 본문 전체 (디버그용, 응답 클 수 있음)
    if (mode === 'full') {
      return NextResponse.json({
        ok: true,
        mode: 'full',
        targetUrl,
        httpStatus: res.status,
        elapsedMs,
        htmlLength: html.length,
        html,
      })
    }

    // [기본] 진단 모드
    const hasTable = html.includes('<table')
    const hasRank1Text = html.includes('1순위') || html.includes('해당지역')
    const hasCompetitionText = html.includes('경쟁률') || html.includes('접수건수')
    const hasErrorIndicator = html.includes('error') || html.includes('차단') || html.includes('blocked')

    return NextResponse.json({
      ok: true,
      mode: 'diagnose',
      diagnosis: {
        targetUrl,
        httpStatus: res.status,
        statusText: res.statusText,
        elapsedMs,
        contentType: res.headers.get('content-type') || '',
        actualBodyLength: html.length,
        signals: { hasTable, hasRank1Text, hasCompetitionText, hasErrorIndicator },
      },
      bodySample: {
        head1500: html.slice(0, 1500),
        tail500: html.length > 2000 ? html.slice(-500) : '',
      },
    })

  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: String(e),
      elapsedMs: Date.now() - startedAt,
    })
  }
}
