import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// 청약홈 경쟁률 페이지 접근 검증 전용 라우트
// 사용법: /api/applyhome-test?pblancNo=2026000114
//
// 목적:
// 1) Vercel serverless에서 청약홈에 접근 가능한지 (200 vs 403/차단)
// 2) HTML이 정상으로 도착하는지
// 3) 표 데이터가 HTML에 포함되어 있는지 (서버사이드 렌더 vs JS 렌더)
//
// ⚠️ 검증 전용 — 실제 사용자에게 노출하지 않음

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pblancNo = (searchParams.get('pblancNo') || '').trim()

  if (!pblancNo) {
    return NextResponse.json({
      error: 'pblancNo 파라미터가 필요합니다',
      usage: '/api/applyhome-test?pblancNo=2026000114',
    }, { status: 400 })
  }

  const targetUrl = `https://www.applyhome.co.kr/ai/aia/selectAPTCompetitionPopup.do?houseManageNo=${pblancNo}&pblancNo=${pblancNo}`

  const startedAt = Date.now()

  try {
    // 일반 브라우저처럼 보이게 헤더 세팅
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': 'https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancListView.do',
      },
      // Vercel 기본 fetch는 자동 redirect 따라감
      cache: 'no-store',
    })

    const elapsedMs = Date.now() - startedAt
    const contentType = res.headers.get('content-type') || ''
    const contentLength = res.headers.get('content-length') || ''

    let bodyText = ''
    let bodyError: string | null = null
    try {
      bodyText = await res.text()
    } catch (e) {
      bodyError = String(e)
    }

    // 응답 진단
    const bodyLength = bodyText.length

    // 표 데이터가 HTML에 들어 있는지 가벼운 시그널 체크
    const hasTable = bodyText.includes('<table') || bodyText.includes('<tbody')
    const hasRank1Text = bodyText.includes('1순위') || bodyText.includes('해당지역')
    const hasCompetitionText = bodyText.includes('경쟁률') || bodyText.includes('접수건수')
    const hasErrorIndicator = bodyText.includes('error') || bodyText.includes('차단') || bodyText.includes('blocked')

    // 본문 일부 샘플 (처음 1500자, 끝 500자)
    const bodyHead = bodyText.slice(0, 1500)
    const bodyTail = bodyText.length > 2000 ? bodyText.slice(-500) : ''

    return NextResponse.json({
      ok: true,
      diagnosis: {
        targetUrl,
        httpStatus: res.status,
        statusText: res.statusText,
        elapsedMs,
        contentType,
        contentLengthHeader: contentLength,
        actualBodyLength: bodyLength,
        bodyError,
        signals: {
          hasTable,
          hasRank1Text,
          hasCompetitionText,
          hasErrorIndicator,
        },
        verdict: getVerdict({
          status: res.status,
          bodyLength,
          hasTable,
          hasRank1Text,
        }),
      },
      bodySample: {
        head1500: bodyHead,
        tail500: bodyTail,
      },
    })
  } catch (e) {
    const elapsedMs = Date.now() - startedAt
    return NextResponse.json({
      ok: false,
      error: String(e),
      diagnosis: {
        targetUrl,
        elapsedMs,
        verdict: '🔴 fetch 자체가 실패 — 네트워크 차단 또는 SSL 문제',
      },
    })
  }
}

function getVerdict(args: {
  status: number
  bodyLength: number
  hasTable: boolean
  hasRank1Text: boolean
}): string {
  const { status, bodyLength, hasTable, hasRank1Text } = args

  if (status === 200 && hasTable && hasRank1Text) {
    return '🟢 GO — HTML로 표 데이터 직접 옴, A안 진행 가능'
  }
  if (status === 200 && bodyLength > 1000 && !hasTable) {
    return '🟡 CHECK — HTML은 오는데 표가 없음. JS 비동기 렌더 가능성 (headless 필요 = Vercel 어려움)'
  }
  if (status === 200 && bodyLength < 500) {
    return '🟡 CHECK — 200이지만 본문이 너무 짧음. 빈 응답 또는 리다이렉트 가능성'
  }
  if (status === 403 || status === 401) {
    return '🔴 STOP — 권한 거부. 청약홈이 차단함 → A안 불가'
  }
  if (status === 404) {
    return '🟡 CHECK — 404. URL 패턴이 다르거나 pblancNo 잘못됨'
  }
  if (status >= 500) {
    return '🟡 RETRY — 서버 에러. 일시적일 수 있음, 다시 시도'
  }
  return `🟡 UNKNOWN — status=${status}, length=${bodyLength}, table=${hasTable}`
}
