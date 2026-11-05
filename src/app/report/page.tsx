'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ReportData, ReportSite, ReportRow, ReportTotals,
  rate, fmtRate, fmtN, combinedApplied, rank2Remain, finalRemain, sumRows,
} from '@/lib/reportTypes'
import { detailLines, reportToText, fmtMd, fmtYm } from '@/lib/reportText'
import { isAnnounceWindow } from '@/lib/announceWindow'

// 청약결과 보고서 페이지
//   /report?detail=공고번호,공고번호&compare=공고번호,...&title=제목
//   - 세부조회: 단지별 요약 멘트 3줄 + 타입별 표
//   - 비교조회: 단지당 1줄
//   - 출력: 이미지 저장(PNG), 텍스트 복사, (발표 시간대) 자동 새로고침

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
function todayLabel(): string {
  const d = new Date()
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${WEEKDAY[d.getDay()]})`
}
// 공통 제목 추출: "계양신도시 카이브 유보라(AC3BL)" → "계양신도시 카이브 유보라"
function commonTitle(sites: ReportSite[]): string {
  const names = sites.map((s) => s.houseName).filter(Boolean)
  if (names.length === 0) return '청약결과 보고'
  if (names.length === 1) return names[0]
  let prefix = names[0]
  for (const n of names.slice(1)) {
    let i = 0
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++
    prefix = prefix.slice(0, i)
  }
  // 괄호가 열리고 안 닫혔으면 괄호 앞까지만 ("…유보라(AC" → "…유보라")
  const open = prefix.lastIndexOf('(')
  if (open >= 0 && prefix.indexOf(')', open) < 0) prefix = prefix.slice(0, open)
  prefix = prefix.replace(/[\s(\[·\-]+$/, '').trim()
  return prefix.length >= 2 ? prefix : names[0]
}

// ---------- 단계 미리보기 ----------
// ?stage=spsply | rank1 : 지금 데이터를 그 시점(특공 발표일 / 1순위 발표일)으로 되돌려 보여준다.
// 세부조회 단지에만 적용 (비교 단지는 과거 결과 그대로).
type PreviewStage = 'auto' | 'spsply' | 'rank1'
function rollbackSite(site: ReportSite, stage: PreviewStage): ReportSite {
  if (stage === 'auto' || site.stage === 'before') return site
  const rows: ReportRow[] = site.rows.map((r) => {
    const base: ReportRow = { ...r, rank2Applied: 0, rank2HasData: false }
    if (stage === 'spsply') {
      return { ...base, rank1Applied: 0, rank1Local: 0, rank1Gg: 0, rank1Etc: 0,
        rank1Assigned: Math.max(0, r.supply - Math.min(r.spsplyApplied, r.spsplyAssigned)) }
    }
    return base
  })
  const newStage: ReportSite['stage'] =
    stage === 'spsply' ? 'spsply'
    : rows.some((r) => r.rank1Applied > 0) ? 'rank1' : 'spsply'
  return { ...site, rows, totals: sumRows(rows), stage: newStage }
}

// ---------- 폰트 ----------
// 보고서 글꼴은 페이퍼로지 고정 (@font-face 는 globals.css). CDN 실패 시 프리텐다드 → 시스템 고딕 순으로 대체.
const REPORT_FONT = "Paperlogy, 'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif"
const PRETENDARD_CSS = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css'

// ---------- 표 ----------
function RateCell({ applied, base, bold }: { applied: number; base: number; bold?: boolean }) {
  const r = rate(applied, base)
  const cls = r >= 1 ? 'text-red-600' : 'text-gray-500'
  return (
    <td className={`rpt-td px-1.5 py-1 text-center ${bold ? 'font-bold' : ''} ${cls}`}>
      {base > 0 ? fmtRate(r) : '-'}
    </td>
  )
}

function SiteTable({ site }: { site: ReportSite }) {
  const showRank1 = site.stage !== 'before' && site.stage !== 'spsply'
  const showRank2 = site.totals.rank2HasData
  const t = site.totals
  const cell = 'rpt-td px-1.5 py-1 text-center'
  const head = 'rpt-th px-1.5 py-1.5 text-center font-semibold text-gray-700'

  const rowRemain = (r: ReportRow | ReportTotals) => (showRank2 ? finalRemain(r) : rank2Remain(r))
  const totalRemain = site.rows.reduce((s, r) => s + rowRemain(r), 0)
  const renderRow = (r: ReportRow | ReportTotals, label: string, isTotal: boolean) => {
    const c = combinedApplied(r)
    const remain = isTotal ? totalRemain : rowRemain(r)
    const closed = r.rank1Assigned > 0 && r.rank1Applied + (showRank2 ? r.rank2Applied : 0) >= r.rank1Assigned
    const rowCls = isTotal ? 'bg-amber-50 font-bold' : ''
    return (
      <tr key={label} className={rowCls}>
        <td className={`${cell} font-semibold`}>{label}</td>
        <td className={cell}>{fmtN(r.supply)}</td>
        <td className={cell}>{fmtN(r.spsplyApplied)}</td>
        <RateCell applied={r.spsplyApplied} base={r.spsplyAssigned} />
        {showRank1 && (
          <>
            <td className={`${cell} text-gray-500`}>{fmtN(r.rank1Assigned)}</td>
            <td className={cell}>{fmtN(r.rank1Applied)}</td>
            <RateCell applied={r.rank1Applied} base={r.rank1Assigned} />
          </>
        )}
        {showRank2 && <td className={cell}>{fmtN(r.rank2Applied)}</td>}
        {showRank1 && (
          <>
            <td className={`${cell} font-bold text-red-700`}>{fmtN(c)}</td>
            <RateCell applied={c} base={r.supply} bold />
            <td className={`${cell} ${closed && !isTotal ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
              {isTotal ? fmtN(remain) : closed ? '마감' : fmtN(remain)}
            </td>
          </>
        )}
      </tr>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr>
            <th className={head} rowSpan={2}>타입</th>
            <th className={head} rowSpan={2}>공급<br />세대</th>
            <th className={head} colSpan={2}>특별공급</th>
            {showRank1 && <th className={head} colSpan={3}>1순위</th>}
            {showRank2 && <th className={head} rowSpan={2}>2순위<br />접수</th>}
            {showRank1 && <th className={head} colSpan={2}>합계 (특공+{showRank2 ? '1·2순위' : '1순위'})</th>}
            {showRank1 && <th className={head} rowSpan={2}>{showRank2 ? '잔여' : '2순위 잔여'}</th>}
          </tr>
          <tr>
            <th className={head}>접수</th>
            <th className={head}>경쟁률</th>
            {showRank1 && (
              <>
                <th className={head}>모집</th>
                <th className={head}>접수</th>
                <th className={head}>경쟁률</th>
              </>
            )}
            {showRank1 && (
              <>
                <th className={head}>접수</th>
                <th className={head}>경쟁률</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {site.rows.map((r) => renderRow(r, r.typeLabel, false))}
          {renderRow(t, '합계', true)}
        </tbody>
      </table>
    </div>
  )
}

// ---------- 비교조회 표 ----------
function CompareTable({ sites }: { sites: ReportSite[] }) {
  const head = 'rpt-th px-1.5 py-1.5 text-center font-semibold text-gray-700'
  const cell = 'rpt-td px-1.5 py-1 text-center'
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr>
            <th className={head} rowSpan={2}>단지</th>
            <th className={head} rowSpan={2}>분양<br />시기</th>
            <th className={head} rowSpan={2}>공급<br />세대</th>
            <th className={head} colSpan={2}>특별공급</th>
            <th className={head} colSpan={2}>1순위</th>
            <th className={head} colSpan={2}>합계 (특공+1·2순위)</th>
          </tr>
          <tr>
            <th className={head}>접수</th><th className={head}>경쟁률</th>
            <th className={head}>접수</th><th className={head}>경쟁률</th>
            <th className={head}>접수</th><th className={head}>경쟁률</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => {
            const t = s.totals
            const c = combinedApplied(t)
            const none = s.stage === 'before' || s.rows.length === 0
            return (
              <tr key={s.pblancNo}>
                <td className={`${cell} text-left font-semibold`}>{s.houseName || s.pblancNo}</td>
                <td className={cell}>{fmtYm(s.dates.spsply || s.dates.rank1) || '-'}</td>
                <td className={cell}>{t.supply > 0 ? fmtN(t.supply) : '-'}</td>
                {none ? (
                  <td className={`${cell} text-gray-400`} colSpan={6}>결과 없음</td>
                ) : (
                  <>
                    <td className={cell}>{fmtN(t.spsplyApplied)}</td>
                    <RateCell applied={t.spsplyApplied} base={t.spsplyAssigned} />
                    <td className={cell}>{t.rank1Applied > 0 ? fmtN(t.rank1Applied) : '-'}</td>
                    <RateCell applied={t.rank1Applied} base={t.rank1Applied > 0 ? t.rank1Assigned : 0} />
                    <td className={`${cell} font-bold text-red-700`}>{fmtN(c)}</td>
                    <RateCell applied={c} base={t.supply} bold />
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- 세부조회 카드 ----------
function DetailBlock({ site }: { site: ReportSite }) {
  const { title, lines } = detailLines(site)
  return (
    <section className="mb-5">
      <h2 className="text-[15px] font-extrabold text-gray-900 mb-1.5">{title}</h2>
      <div className="text-[12.5px] leading-relaxed text-gray-800 mb-2 whitespace-pre-line">
        {lines.join('\n')}
      </div>
      {site.rows.length > 0 && <SiteTable site={site} />}
      {site.error && <p className="text-[11px] text-red-500 mt-1">※ {site.error}</p>}
      {(site.source.rank === 'db' || site.source.spsply === 'db') && (
        <p className="text-[10px] text-gray-400 mt-1">※ 청약홈 조회 불가 → 저장된 데이터(전일 기준)로 표시</p>
      )}
    </section>
  )
}

// ---------- 본문 ----------
function ReportBody() {
  const sp = useSearchParams()
  const detailStr = sp.get('detail') || ''
  const compareStr = sp.get('compare') || ''
  const titleParam = sp.get('title') || ''
  const stageParam = (sp.get('stage') || 'auto') as PreviewStage

  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [title, setTitle] = useState(titleParam)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [previewStage, setPreviewStage] = useState<PreviewStage>(['spsply', 'rank1'].includes(stageParam) ? stageParam : 'auto')
  const captureRef = useRef<HTMLDivElement>(null)

  const queryStr = useMemo(() => {
    const clean = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean).join(',')
    const q = new URLSearchParams()
    if (clean(detailStr)) q.set('detail', clean(detailStr))
    if (clean(compareStr)) q.set('compare', clean(compareStr))
    return q.toString()
  }, [detailStr, compareStr])

  const load = useCallback(async () => {
    if (!queryStr) { setLoading(false); setErr('공고번호가 없습니다. 접수현황 화면의 [보고서 구성]에서 단지를 선택하세요.'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/report-data?${queryStr}&t=${Date.now()}`, { cache: 'no-store' })
      const json: ReportData = await res.json()
      setData(json)
      setErr(json.ok ? '' : json.error || '조회 실패')
      if (!titleParam) setTitle((prev) => prev || commonTitle(json.detail))
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [queryStr, titleParam])

  useEffect(() => { load() }, [load])

  // 발표 시간대(19:20~20:45) 60초 자동 새로고침 — 결과가 아직 안 뜬 단지가 있을 때만
  useEffect(() => {
    const id = setInterval(() => {
      const inWin = isAnnounceWindow()
      setAutoRefresh(inWin)
      if (!inWin || !data) return
      const pending = [...data.detail, ...data.compare].some((s) => s.stage === 'before' || s.stage === 'spsply')
      if (pending) load()
    }, 60_000)
    setAutoRefresh(isAnnounceWindow())
    return () => clearInterval(id)
  }, [data, load])

  // 화면에 쓰는 데이터 (미리보기 단계 적용)
  const view = useMemo<ReportData | null>(() => {
    if (!data) return null
    if (previewStage === 'auto') return data
    return { ...data, detail: data.detail.map((s) => rollbackSite(s, previewStage)) }
  }, [data, previewStage])

  const text = useMemo(() => view ? reportToText(view.detail, view.compare, title) : '', [view, title])

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      alert('복사에 실패했습니다. 텍스트를 직접 선택해 복사하세요.')
    }
  }

  const saveImage = async () => {
    if (!captureRef.current) return
    setSaving(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const target = captureRef.current
      const rect = target.getBoundingClientRect()
      const canvas = await html2canvas(target, {
        backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
        width: rect.width, height: rect.height, windowWidth: 800, scrollX: 0, scrollY: 0,
      })
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
      if (!blob) throw new Error('이미지 변환 실패')
      const d = new Date()
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const filename = `${(title || '청약결과').replace(/[\\/:*?"<>|]/g, '_')}_${dateStr}.png`
      const file = new File([blob], filename, { type: 'image/png' })
      const shareData: ShareData = { files: [file], title: `${title} 청약결과`, text }
      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
        try { await navigator.share(shareData); return } catch (e) { if (e instanceof Error && e.name === 'AbortError') return }
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
      alert('이미지 생성에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 py-4 px-2">
      <link rel="stylesheet" href={PRETENDARD_CSS} />
      <style dangerouslySetInnerHTML={{ __html: `
        .rpt-th { border: 0.5px solid #d6dbe1; background: #f3f4f6; }
        .rpt-td { border: 0.5px solid #eceff2; }
        .rpt-capture, .rpt-capture * { font-family: ${REPORT_FONT}; }
        .rpt-capture { -webkit-font-smoothing: antialiased; }
      ` }} />
      {/* 도구 막대 (캡처 제외) */}
      <div className="max-w-[760px] mx-auto mb-3 flex flex-wrap gap-2 items-center">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="보고서 제목"
          className="flex-1 min-w-[200px] border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
        />
        <button onClick={saveImage} disabled={saving || !data} className="px-3 py-1.5 text-sm font-semibold rounded bg-blue-600 text-white disabled:opacity-50">
          {saving ? '생성 중…' : '📷 이미지 저장'}
        </button>
        <button onClick={copyText} disabled={!data} className="px-3 py-1.5 text-sm font-semibold rounded bg-gray-700 text-white disabled:opacity-50">
          {copied ? '복사됨 ✓' : '📋 텍스트 복사'}
        </button>
        <select
          value={previewStage}
          onChange={(e) => setPreviewStage(e.target.value as PreviewStage)}
          title="단계 미리보기 — 지금 데이터를 해당 발표일 시점으로 되돌려 표시"
          className="px-2 py-1.5 text-sm rounded bg-white border border-gray-300"
        >
          <option value="auto">단계: 자동(현재)</option>
          <option value="spsply">미리보기: 특공 발표일</option>
          <option value="rank1">미리보기: 1순위 발표일</option>
        </select>
        <button onClick={load} disabled={loading} className="px-3 py-1.5 text-sm font-semibold rounded bg-white border border-gray-300 disabled:opacity-50">
          {loading ? '조회 중…' : '🔄 새로고침'}
        </button>
        <a href="/" className="px-3 py-1.5 text-sm rounded bg-white border border-gray-300">← 접수현황</a>
      </div>
      {previewStage !== 'auto' && (
        <p className="max-w-[760px] mx-auto mb-2 text-[11px] text-amber-700">※ 미리보기 모드 — {previewStage === 'spsply' ? '특공 발표일' : '1순위 발표일'} 시점으로 되돌려 표시 중 (실제 보고 시에는 "자동"으로)</p>
      )}
      {autoRefresh && (
        <p className="max-w-[760px] mx-auto mb-2 text-[11px] text-purple-700">⏱ 발표 시간대 — 결과가 뜰 때까지 60초마다 자동 새로고침합니다</p>
      )}
      {err && <p className="max-w-[760px] mx-auto mb-2 text-sm text-red-600">{err}</p>}

      {/* 캡처 영역 — 폭 760px 고정: 폰에서는 옆으로 밀어 보고, 저장 이미지는 PC와 동일하게 나온다 */}
      <div className="overflow-x-auto">
      <div ref={captureRef} className="rpt-capture w-[760px] mx-auto bg-white rounded-lg shadow p-5">
        {/* 머리글: 제목(좌) / 로고 + 날짜(우) — 로고는 날씬하게, 날짜는 로고 아래 작게 */}
        <div className="flex items-end justify-between border-b-2 border-gray-800 pb-2.5 mb-4">
          <h1 className="text-[30px] font-extrabold text-gray-900 leading-tight tracking-tight">{title || '청약결과 보고'}</h1>
          <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/maru-logo.png" alt="MARU FRONTIER" className="h-[28px] w-auto opacity-90" />
            <span className="text-[10.5px] text-gray-500 tracking-wide">{todayLabel()}</span>
          </div>
        </div>

        {loading && !data && <p className="text-sm text-gray-500 py-8 text-center">청약홈에서 가져오는 중…</p>}

        {view?.detail.map((s) => <DetailBlock key={s.pblancNo} site={s} />)}

        {view && view.compare.length > 0 && (
          <section className="mt-2 pt-3 border-t border-gray-300">
            <h2 className="text-[14px] font-extrabold text-gray-900 mb-1.5">▶ 비교 단지</h2>
            <CompareTable sites={view.compare} />
          </section>
        )}

        {data && (
          <p className="text-[10px] text-gray-400 mt-4 pt-2 border-t border-gray-200">
            출처: 청약홈(applyhome.co.kr) · 경쟁률 = 접수 ÷ 모집세대, 합계 경쟁률 = 누계 접수 ÷ 총 공급세대
            {view?.detail[0]?.dates.announce && ` · 당첨자 발표 ${fmtMd(view.detail[0].dates.announce)}`}
          </p>
        )}
      </div>
      </div>
      <p className="max-w-[760px] mx-auto mt-2 text-[10px] text-gray-400 sm:hidden">※ 폰에서는 보고서를 옆으로 밀어 볼 수 있고, 저장 이미지는 전체 폭으로 나옵니다</p>
    </div>
  )
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">불러오는 중…</div>}>
      <ReportBody />
    </Suspense>
  )
}
