// =================================================================
// 임시 디버그 라우트 — 원본 API 응답 확인용
// 위치: src/app/api/debug-mdl/route.ts (새 파일 생성)
// 사용:
//   https://cheongyak-app.vercel.app/api/debug-mdl?pblancNo=2026000088
//   (pblancNo 미지정 시 첫 5개 행 샘플 반환)
//
// 목적:
//   - getAPTLttotPblancMdl API의 모든 필드를 그대로 노출
//   - "일반공급 세대수(예: 49)" 가 어느 필드에 담겨 있는지 확인
//
// 본 수정 완료 후 이 파일은 삭제하거나 그대로 두어도 무방
// =================================================================
import { NextResponse } from 'next/server'

const BASE_URL = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pblancNo = (searchParams.get('pblancNo') || '').trim()

  const apiKey = process.env.API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API_KEY 환경변수 미설정' }, { status: 500 })
  }

  // getAPTLttotPblancMdl 전체 페이지 조회
  const allRows: Record<string, unknown>[] = []
  let lastError: string | null = null

  for (let page = 1; page <= 30; page++) {
    const url =
      `${BASE_URL}/getAPTLttotPblancMdl` +
      `?serviceKey=${encodeURIComponent(apiKey)}` +
      `&page=${page}&perPage=1000&returnType=JSON`
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        lastError = `page ${page} HTTP ${res.status}`
        break
      }
      const json = await res.json()
      const data = (json?.data || []) as Record<string, unknown>[]
      allRows.push(...data)
      if (data.length < 1000) break
    } catch (e) {
      lastError = String(e)
      break
    }
  }

  // 공고번호 필터링
  if (!pblancNo) {
    // 공고번호 미지정 → 샘플 5건의 모든 필드명 노출
    const sampleKeys = allRows.length > 0 ? Object.keys(allRows[0]).sort() : []
    return NextResponse.json({
      hint: 'pblancNo 쿼리를 지정하세요. 예: ?pblancNo=2026000088',
      totalRowsScanned: allRows.length,
      lastError,
      // 첫 행의 모든 필드명 (어떤 필드들이 있는지 한눈에 보기)
      availableFields: sampleKeys,
      sample: allRows.slice(0, 5),
    })
  }

  const matched = allRows.filter(
    (r) => String(r['PBLANC_NO'] || '').trim() === pblancNo
  )

  return NextResponse.json({
    pblancNo,
    totalRowsScanned: allRows.length,
    matchedCount: matched.length,
    lastError,
    // 핵심: 모든 필드를 가공 없이 그대로 노출
    rows: matched,
  })
}
