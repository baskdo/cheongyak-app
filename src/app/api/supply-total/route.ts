import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 공급세대수(청약홈 표시값) = Mdl API의 일반공급(SUPLY_HSHLDCO) + 특별공급(SPSPLY_HSHLDCO)
// → 경쟁률 API의 1순위 모집세대(이월 포함)나 특공 배정 재구성과 무관하게 항상 공고 고정값과 일치.
//   competition route는 DB(Neon)에서 읽어 Mdl 총공급을 갖고 있지 않으므로,
//   일괄 다운로드 시점에 공고번호로 Mdl만 조회해 보완한다.

const DETAIL_BASE = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'

type MdlRow = {
  PBLANC_NO?: string
  HOUSE_TY?: string
  SUPLY_HSHLDCO?: string | number   // 일반공급 세대수
  SPSPLY_HSHLDCO?: string | number  // 특별공급 세대수(합계)
}

// 공고번호 1건의 Mdl 주택형 목록 조회 (cond[PBLANC_NO::EQ] — 0.1초 수준, 단건이라 빠름)
async function fetchMdlByPblancNo(key: string, pblancNo: string): Promise<MdlRow[]> {
  const url =
    `${DETAIL_BASE}/getAPTLttotPblancMdl` +
    `?serviceKey=${encodeURIComponent(key)}` +
    `&page=1&perPage=100&returnType=JSON` +
    `&cond%5BPBLANC_NO%3A%3AEQ%5D=${encodeURIComponent(pblancNo)}`

  const res = await fetch(url, { next: { revalidate: 3600 } })
  if (!res.ok) return []
  const json = await res.json()
  return (json.data || []) as MdlRow[]
}

// POST { pblancNos: string[] }
//  → { map: { [pblancNo]: { [HOUSE_TY]: 총공급세대수(일반+특공) } } }
export async function POST(request: Request) {
  try {
    const key =
      process.env.ODCLOUD_API_KEY || process.env.API_KEY2 || process.env.API_KEY
    if (!key) return NextResponse.json({ map: {}, error: 'API key not set' })

    const body = await request.json().catch(() => ({} as { pblancNos?: unknown }))
    const pblancNos: string[] = Array.isArray((body as { pblancNos?: unknown }).pblancNos)
      ? Array.from(
          new Set(
            ((body as { pblancNos?: unknown[] }).pblancNos as unknown[])
              .map((s) => String(s ?? '').trim())
              .filter(Boolean)
          )
        )
      : []

    if (pblancNos.length === 0) return NextResponse.json({ map: {} })

    const map: Record<string, Record<string, number>> = {}

    // 동시성 제한(8) — 함수 실행시간/레이트리밋 보호
    const CONC = 8
    for (let i = 0; i < pblancNos.length; i += CONC) {
      const batch = pblancNos.slice(i, i + CONC)
      const results = await Promise.all(
        batch.map(async (no) => {
          const rows = await fetchMdlByPblancNo(key, no)
          const perType: Record<string, number> = {}
          for (const r of rows) {
            const ty = String(r.HOUSE_TY ?? '').trim()
            if (!ty) continue
            const gen = Number(r.SUPLY_HSHLDCO ?? 0) || 0
            const sp = Number(r.SPSPLY_HSHLDCO ?? 0) || 0
            perType[ty] = (perType[ty] || 0) + gen + sp
          }
          return [no, perType] as const
        })
      )
      for (const [no, perType] of results) {
        if (Object.keys(perType).length > 0) map[no] = perType
      }
    }

    return NextResponse.json({ map })
  } catch (e) {
    console.error('[supply-total POST] error:', e)
    return NextResponse.json({ map: {}, error: String(e) })
  }
}
