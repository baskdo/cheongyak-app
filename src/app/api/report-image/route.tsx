import { NextResponse } from 'next/server'
import { renderReportImage } from '@/lib/reportImage'
import { loadSnapshot } from '@/lib/reportSnapshot'
import type { ReportData, ReportSite } from '@/lib/reportTypes'

// 청약결과 보고서 PNG
//   GET /api/report-image?id=SNAPSHOT_ID                       ← 텔레그램 알림이 쓰는 주소 (발송 시점 데이터 고정)
//   GET /api/report-image?detail=…&compare=…&title=…&key=CRON_SECRET  ← 수동 확인용 (지금 데이터로 생성)
//   GET /api/report-image?sample=1&key=CRON_SECRET                    ← 모양 확인용 샘플

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60   // Hobby 플랜 최대 60초 (기본 10초)

function originOf(request: Request): string {
  const h = request.headers
  const host = h.get('x-forwarded-host') || h.get('host')
  const proto = h.get('x-forwarded-proto') || (host && host.startsWith('localhost') ? 'http' : 'https')
  return host ? `${proto}://${host}` : new URL(request.url).origin
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = originOf(request)
  const id = searchParams.get('id') || ''
  try {
    if (id) {
      const snap = await loadSnapshot(id)
      if (!snap) return NextResponse.json({ ok: false, error: '스냅샷 없음' }, { status: 404 })
      const img = await renderReportImage(snap, snap.title, origin)
      img.headers.set('Cache-Control', 'public, max-age=86400')
      return img
    }
    const secret = process.env.CRON_SECRET
    if (!secret || searchParams.get('key') !== secret) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    const sample = searchParams.get('sample')
    if (sample) {
      const d = sampleData()
      if (sample === '2') { d.detail = d.detail.slice(0, 1); d.compare = [] }
      if (sample === '3') { d.detail = []; }
      const img = await renderReportImage(d, '계양신도시 카이브 유보라', origin)
      img.headers.set('Cache-Control', 'no-store')
      return img
    }
    const q = new URLSearchParams()
    for (const k of ['detail', 'compare']) { const v = searchParams.get(k); if (v) q.set(k, v) }
    if (!q.toString()) return NextResponse.json({ ok: false, error: 'detail/compare 필요' }, { status: 400 })
    const res = await fetch(`${origin}/api/report-data?${q.toString()}&t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
    const data = (await res.json()) as ReportData
    if (!data.ok) return NextResponse.json({ ok: false, error: data.error || 'report-data 실패' }, { status: 502 })
    const img = await renderReportImage(data, searchParams.get('title') || '', origin)
    img.headers.set('Cache-Control', 'no-store')
    return img
  } catch (e) {
    console.error('[report-image]', e)
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

// 모양 확인용 샘플 (실제 보고서와 같은 구조)
function sampleData(): Pick<ReportData, 'detail' | 'compare'> {
  const row = (typeLabel: string, supply: number, sa: number, sp: number, r1a: number, r1: number, r2: number): ReportSite['rows'][number] => ({
    type: typeLabel, typeLabel, supply, spsplyAssigned: sa, spsplyApplied: sp,
    rank1Assigned: r1a, rank1Applied: r1, rank1Local: Math.round(r1 * 0.6), rank1Gg: Math.round(r1 * 0.25), rank1Etc: r1 - Math.round(r1 * 0.6) - Math.round(r1 * 0.25),
    rank2Applied: r2, rank2HasData: r2 > 0,
  })
  const mk = (pblancNo: string, houseName: string, stage: ReportSite['stage'], rows: ReportSite['rows']): ReportSite => {
    const t = rows.reduce((a, r) => ({
      supply: a.supply + r.supply, spsplyAssigned: a.spsplyAssigned + r.spsplyAssigned, spsplyApplied: a.spsplyApplied + r.spsplyApplied,
      rank1Assigned: a.rank1Assigned + r.rank1Assigned, rank1Applied: a.rank1Applied + r.rank1Applied, rank1Local: a.rank1Local + r.rank1Local,
      rank1Gg: a.rank1Gg + r.rank1Gg, rank1Etc: a.rank1Etc + r.rank1Etc, rank2Applied: a.rank2Applied + r.rank2Applied, rank2HasData: a.rank2HasData || r.rank2HasData,
    }), { supply: 0, spsplyAssigned: 0, spsplyApplied: 0, rank1Assigned: 0, rank1Applied: 0, rank1Local: 0, rank1Gg: 0, rank1Etc: 0, rank2Applied: 0, rank2HasData: false })
    return { pblancNo, houseName, region: '인천', address: '인천광역시 계양구', dates: { spsply: '2026-11-17', rank1: '2026-11-18', rank2: '2026-11-19', announce: '2026-11-25' },
      stage, rows, totals: t, source: { meta: 'api', spsply: 'applyhome', rank: 'applyhome' } }
  }
  return {
    detail: [
      mk('2026000001', '계양신도시 카이브 유보라(AC3BL)', 'rank1', [row('59A', 120, 70, 95, 45, 210, 0), row('74A', 80, 46, 38, 42, 61, 0), row('84A', 150, 88, 160, 62, 540, 0)]),
      mk('2026000002', '계양신도시 카이브 유보라(AC4BL)', 'rank2', [row('84A', 100, 58, 40, 60, 48, 30), row('84B', 60, 34, 12, 48, 20, 9)]),
    ],
    compare: [
      mk('2026000003', '인천 서구 더샵 00', 'rank2', [row('84A', 300, 170, 220, 180, 900, 0)]),
      mk('2026000004', '검단 00자이', 'before', []),
    ],
  }
}
