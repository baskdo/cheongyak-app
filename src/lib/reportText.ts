// 청약결과 보고서 — 숫자 → 요약 멘트 자동 생성
// 규칙은 단순하게: 블록당 3줄, 비교단지 1줄. 문장은 표 숫자에서만 만든다.
import {
  ReportSite, ReportRow, ReportStage,
  rate, fmtRate, fmtN, combinedApplied, rank2Remain, finalRemain,
} from './reportTypes'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

export function fmtMd(dateStr: string): string {
  // "2026-11-03" → "11.03 (화)"
  const m = (dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return `${m[2]}.${m[3]} (${WEEKDAY[d.getDay()]})`
}
export function fmtYm(dateStr: string): string {
  // "2026-10-15" → "26.10"
  const m = (dateStr || '').match(/^\d{2}(\d{2})-(\d{2})/)
  return m ? `${m[1]}.${m[2]}` : ''
}

export function stageLabel(stage: ReportStage): string {
  switch (stage) {
    case 'spsply': return '특별공급 결과'
    case 'rank1': return '1순위 결과'
    case 'rank2': return '1·2순위 결과'
    case 'final': return '최종 결과'
    default: return '접수 전'
  }
}

function pct(part: number, whole: number): string {
  if (!whole) return '0%'
  return `${Math.round((part / whole) * 1000) / 10}%`
}

function joinTypes(rows: ReportRow[]): string {
  return rows.map((r) => r.typeLabel).join('·')
}

// 세부조회 단지: 제목 1줄 + 본문 3줄
export function detailLines(site: ReportSite): { title: string; lines: string[] } {
  const t = site.totals
  const rows = site.rows
  const hasGg = t.rank1Gg > 0
  const stageDate =
    site.stage === 'spsply' ? site.dates.spsply
    : site.stage === 'rank1' ? site.dates.rank1
    : site.stage === 'rank2' || site.stage === 'final' ? site.dates.rank2
    : ''
  const title = `■ ${site.houseName} — ${stageLabel(site.stage)}${stageDate ? ` · ${fmtMd(stageDate)}` : ''}`

  if (site.stage === 'before' || rows.length === 0) {
    return { title, lines: ['· 아직 발표된 접수 결과가 없습니다.'] }
  }

  // ---- 특공만 발표된 시점 ----
  if (site.stage === 'spsply') {
    const top = [...rows].sort((a, b) => b.spsplyApplied - a.spsplyApplied)[0]
    const under = rows.filter((r) => r.spsplyApplied < r.spsplyAssigned)
    const carry = under.reduce((s, r) => s + (r.spsplyAssigned - r.spsplyApplied), 0)
    const lines = [
      `· 특별공급 ${fmtN(t.spsplyApplied)}건 접수 (${fmtRate(rate(t.spsplyApplied, t.spsplyAssigned))}, 배정 ${fmtN(t.spsplyAssigned)}세대)`,
      top
        ? `· ${top.typeLabel} ${fmtN(top.spsplyApplied)}건 최다` +
          (under.length === 0
            ? ' · 전 타입 배정 초과'
            : under.length === rows.length
              ? ` · 전 타입 미달 → 1순위 이월 ${fmtN(carry)}세대`
              : ` · 미달 ${under.length}개 타입(${joinTypes(under)}) → 1순위 이월 ${fmtN(carry)}세대`)
        : '',
      site.dates.rank1 ? `· 1순위 ${fmtMd(site.dates.rank1)} 접수` : '',
    ].filter(Boolean)
    return { title, lines }
  }

  // ---- 1순위 이후 공통 1줄 ----
  const line1 =
    `· 1순위 ${fmtN(t.rank1Applied)}건 접수 (${fmtRate(rate(t.rank1Applied, t.rank1Assigned))})` +
    (hasGg
      ? ` · 해당 ${pct(t.rank1Local, t.rank1Applied)} / 기타경기 ${pct(t.rank1Gg, t.rank1Applied)} / 기타 ${pct(t.rank1Etc, t.rank1Applied)}`
      : ` · 해당 ${pct(t.rank1Local, t.rank1Applied)} / 기타 ${pct(t.rank1Etc + t.rank1Gg, t.rank1Applied)}`)

  const top = [...rows].sort((a, b) => b.rank1Applied - a.rank1Applied)[0]
  const closed = rows.filter((r) => r.rank1Applied >= r.rank1Assigned && r.rank1Assigned > 0)
  const open = rows.filter((r) => !(r.rank1Applied >= r.rank1Assigned && r.rank1Assigned > 0))
  let line2 = top
    ? `· ${top.typeLabel} ${fmtN(top.rank1Applied)}건 (${fmtRate(rate(top.rank1Applied, top.rank1Assigned))}) 최다`
    : ''
  if (closed.length === rows.length) line2 += ' · 전 타입 1순위 마감'
  else if (closed.length === 0) line2 += ' · 전 타입 미달'
  else line2 += ` · ${joinTypes(closed)} 경쟁 발생, 나머지 ${open.length}개 타입 미달`

  // ---- 3줄째: 단계별 ----
  let line3 = ''
  if (site.stage === 'rank1') {
    const c = t.spsplyApplied + t.rank1Applied
    const remain = rows.reduce((s, r) => s + rank2Remain(r), 0)
    line3 = `· 특공+1순위 누계 ${fmtN(c)}건 (${fmtRate(rate(c, t.supply))})` +
      (remain > 0 ? ` · 2순위 이월 ${fmtN(remain)}세대` : ' · 2순위 접수 없음')
  } else {
    const r12 = t.rank1Applied + t.rank2Applied
    const remain = rows.reduce((s, r) => s + finalRemain(r), 0)
    line3 = `· 2순위 ${fmtN(t.rank2Applied)}건 추가 → 1·2순위 누계 ${fmtN(r12)}건 (${fmtRate(rate(r12, t.rank1Assigned))})` +
      (remain > 0 ? ` · 잔여 ${fmtN(remain)}세대 (무순위 예정)` : ' · 잔여 없음(마감)')
    const c = combinedApplied(t)
    line3 += `\n· 특공 포함 총 ${fmtN(c)}건 (${fmtRate(rate(c, t.supply))})`
  }

  return { title, lines: [line1, line2, line3].filter(Boolean) }
}

// 비교조회 단지: 1줄
export function compareLine(site: ReportSite): string {
  const t = site.totals
  const ym = fmtYm(site.dates.spsply || site.dates.rank1)
  const head = `· ${site.houseName}${ym ? ` (${ym}` : ' ('}${ym ? ', ' : ''}${fmtN(t.supply)}세대)`
  if (site.stage === 'before' || site.rows.length === 0) return `${head} — 결과 없음`
  const sp = `특공 ${fmtN(t.spsplyApplied)}건 ${fmtRate(rate(t.spsplyApplied, t.spsplyAssigned))}`
  if (site.stage === 'spsply') return `${head} — ${sp}`
  const r1 = `1순위 ${fmtN(t.rank1Applied)}건 ${fmtRate(rate(t.rank1Applied, t.rank1Assigned))}`
  const c = combinedApplied(t)
  const all = `합계 ${fmtN(c)}건 ${fmtRate(rate(c, t.supply))}`
  return `${head} — ${sp} / ${r1} / ${all}`
}

// 전체 보고서 → 텍스트 (텔레그램/카톡 붙여넣기용)
export function reportToText(detail: ReportSite[], compare: ReportSite[], title?: string): string {
  const out: string[] = []
  if (title) out.push(title, '')
  for (const s of detail) {
    const { title: t, lines } = detailLines(s)
    out.push(t, ...lines, '')
  }
  if (compare.length > 0) {
    out.push('▶ 비교 단지')
    for (const s of compare) out.push(compareLine(s))
  }
  return out.join('\n').trim()
}
