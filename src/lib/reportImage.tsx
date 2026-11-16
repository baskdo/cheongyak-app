/* eslint-disable @next/next/no-img-element */
import React from 'react'
import { ImageResponse } from 'next/og'
import {
  ReportSite, ReportRow, ReportTotals, ReportData,
  rate, fmtRate, fmtN, combinedApplied, rank2Remain, finalRemain,
} from './reportTypes'
import { detailLines, fmtMd, fmtYm } from './reportText'

// 청약결과 보고서 → PNG 이미지 (서버 렌더링, satori)
//   /report 화면(760px)과 같은 구성: 제목·로고·날짜 / 세부단지(제목+3줄+타입별 표) / 비교 단지 표 / 출처
//   텔레그램 사진 압축을 고려해 2배(1520px)로 그린다. 표는 <table> 대신 flex 로 그린다(satori 제약).
//   높이는 행 높이를 고정해 두고 내용에서 계산한다.

const S = 2                       // 배율
const W = 760                     // 보고서 폭 (css px)
const PAD = 20
const INNER = W - PAD * 2

const px = (n: number) => n * S

// ---------- 폰트 (public/fonts/*.ttf — noonnu woff2 를 ttf 로 변환한 것) ----------
type FontSpec = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700 | 800; style: 'normal' }
const fontCache = new Map<string, ArrayBuffer>()
async function loadFonts(origin: string): Promise<FontSpec[]> {
  const list: Array<[string, FontSpec['weight']]> = [
    ['Paperlogy-5Medium.ttf', 500],
    ['Paperlogy-7Bold.ttf', 700],
    ['Paperlogy-8ExtraBold.ttf', 800],
  ]
  const out: FontSpec[] = []
  await Promise.all(list.map(async ([file, weight]) => {
    let buf = fontCache.get(file)
    if (!buf) {
      const res = await fetch(`${origin}/fonts/${file}`, { cache: 'force-cache' })
      if (!res.ok) throw new Error(`font ${file} ${res.status}`)
      buf = await res.arrayBuffer()
      fontCache.set(file, buf)
    }
    out.push({ name: 'Paperlogy', data: buf, weight, style: 'normal' })
  }))
  return out
}

let logoCache: string | null = null
async function loadLogo(origin: string): Promise<string | null> {
  if (logoCache) return logoCache
  try {
    const res = await fetch(`${origin}/maru-logo.png`, { cache: 'force-cache' })
    if (!res.ok) return null
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64')
    logoCache = `data:image/png;base64,${b64}`
    return logoCache
  } catch { return null }
}

// ---------- 공통 스타일 ----------
const C = {
  text: '#1f2937', sub: '#374151', muted: '#6b7280', faint: '#9ca3af',
  red: '#dc2626', red700: '#b91c1c', blue700: '#1d4ed8',
  thBg: '#f3f4f6', thBorder: '#d6dbe1', tdBorder: '#eceff2', amber: '#fffbeb',
  rule: '#1f2937', ruleLight: '#d1d5db', ruleFaint: '#e5e7eb',
}
const ROW_H = 24        // 데이터 행 높이 (css px)
const HEAD_H = 22       // 머리글 1단 높이
const FONT_TABLE = 11

// 셀: flex 비율로 폭을 나눈다
// 열 폭: 표마다 "단위 폭"을 정해 두고 각 셀은 flex(단위 수) × unitW 로 고정폭을 가진다 (flex 분배는 padding 때문에 어긋남)
let unitW = INNER / 10
function Cell({ flex = 1, children, bold, color, bg, head, align = 'center', h = ROW_H }: {
  flex?: number; children?: React.ReactNode; bold?: boolean; color?: string; bg?: string; head?: boolean; align?: 'center' | 'left'; h?: number
}) {
  return (
    <div style={{
      display: 'flex', width: px(flex * unitW), flexShrink: 0, height: px(h), alignItems: 'center',
      justifyContent: align === 'left' ? 'flex-start' : 'center',
      padding: `0 ${px(4)}px`,
      borderRight: `${px(0.5)}px solid ${head ? C.thBorder : C.tdBorder}`,
      borderBottom: `${px(0.5)}px solid ${head ? C.thBorder : C.tdBorder}`,
      background: bg || (head ? C.thBg : 'white'),
      color: color || (head ? C.sub : C.text),
      fontSize: px(FONT_TABLE), fontWeight: bold || head ? 700 : 500, lineHeight: 1,
      whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0,
    }}>
      {children}
    </div>
  )
}

function RateCell({ applied, base, bold }: { applied: number; base: number; bold?: boolean }) {
  const r = rate(applied, base)
  return <Cell bold={bold} color={r >= 1 ? C.red : C.muted}>{base > 0 ? fmtRate(r) : '-'}</Cell>
}

// 머리글 그룹: 하위 열이 없으면 2단 높이의 한 칸, 있으면 상단 라벨 + 하단 열들
type HeadGroup = { label: string; cols?: string[]; flex?: number }
function TableHead({ groups }: { groups: HeadGroup[] }) {
  return (
    <div style={{ display: 'flex', width: '100%' }}>
      {groups.map((g, i) => {
        const n = g.cols?.length || 1
        const flex = g.flex ?? n
        if (!g.cols) return <Cell key={i} head flex={flex} h={HEAD_H * 2}>{g.label}</Cell>
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', width: px(flex * unitW), flexShrink: 0 }}>
            <Cell head h={HEAD_H} flex={flex}>{g.label}</Cell>
            <div style={{ display: 'flex' }}>
              {g.cols.map((c, j) => <Cell key={j} head h={HEAD_H} flex={flex / (g.cols as string[]).length}>{c}</Cell>)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function unitsOf(groups: HeadGroup[]): number { return groups.reduce((a, g) => a + (g.flex ?? g.cols?.length ?? 1), 0) }
function TableBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', borderTop: `${px(0.5)}px solid ${C.thBorder}`, borderLeft: `${px(0.5)}px solid ${C.thBorder}` }}>
      {children}
    </div>
  )
}

// ---------- 세부조회 표 ----------
export function siteTableRows(site: ReportSite): number { return site.rows.length + 1 }

function SiteTable({ site }: { site: ReportSite }) {
  const showRank1 = site.stage !== 'before' && site.stage !== 'spsply'
  const showRank2 = site.totals.rank2HasData
  const rowRemain = (r: ReportRow | ReportTotals) => (showRank2 ? finalRemain(r) : rank2Remain(r))
  const totalRemain = site.rows.reduce((s, r) => s + rowRemain(r), 0)

  const groups: HeadGroup[] = [
    { label: '타입', flex: 1.2 }, { label: '공급세대' }, { label: '특별공급', cols: ['접수', '경쟁률'] },
  ]
  if (showRank1) groups.push({ label: '1순위', cols: ['모집', '접수', '경쟁률'] })
  if (showRank2) groups.push({ label: '2순위 접수' })
  if (showRank1) groups.push({ label: `합계 (특공+${showRank2 ? '1·2순위' : '1순위'})`, cols: ['접수', '경쟁률'] })
  if (showRank1) groups.push({ label: showRank2 ? '잔여' : '2순위 잔여' })

  unitW = INNER / unitsOf(groups)
  const row = (r: ReportRow | ReportTotals, label: string, isTotal: boolean) => {
    const c = combinedApplied(r)
    const remain = isTotal ? totalRemain : rowRemain(r)
    const closed = r.rank1Assigned > 0 && r.rank1Applied + (showRank2 ? r.rank2Applied : 0) >= r.rank1Assigned
    const bg = isTotal ? C.amber : undefined
    const b = isTotal
    return (
      <div key={label} style={{ display: 'flex', width: '100%' }}>
        <Cell flex={1.2} bold bg={bg}>{label}</Cell>
        <Cell bold={b} bg={bg}>{fmtN(r.supply)}</Cell>
        <Cell bold={b} bg={bg}>{fmtN(r.spsplyApplied)}</Cell>
        <RateCell applied={r.spsplyApplied} base={r.spsplyAssigned} bold={b} />
        {showRank1 && <Cell bold={b} bg={bg} color={C.muted}>{fmtN(r.rank1Assigned)}</Cell>}
        {showRank1 && <Cell bold={b} bg={bg}>{fmtN(r.rank1Applied)}</Cell>}
        {showRank1 && <RateCell applied={r.rank1Applied} base={r.rank1Assigned} bold={b} />}
        {showRank2 && <Cell bold={b} bg={bg}>{fmtN(r.rank2Applied)}</Cell>}
        {showRank1 && <Cell bold bg={bg} color={C.red700}>{fmtN(c)}</Cell>}
        {showRank1 && <RateCell applied={c} base={r.supply} bold />}
        {showRank1 && (
          <Cell bold={b || (closed && !isTotal)} bg={bg} color={closed && !isTotal ? C.blue700 : C.sub}>
            {isTotal ? fmtN(remain) : closed ? '마감' : fmtN(remain)}
          </Cell>
        )}
      </div>
    )
  }
  return (
    <TableBox>
      <TableHead groups={groups} />
      {site.rows.map((r) => row(r, r.typeLabel, false))}
      {row(site.totals, '합계', true)}
    </TableBox>
  )
}

// ---------- 비교조회 표 ----------
function CompareTable({ sites }: { sites: ReportSite[] }) {
  const groups: HeadGroup[] = [
    { label: '단지', flex: 3 }, { label: '분양시기' }, { label: '공급세대' },
    { label: '특별공급', cols: ['접수', '경쟁률'] }, { label: '1순위', cols: ['접수', '경쟁률'] }, { label: '합계 (특공+1·2순위)', cols: ['접수', '경쟁률'] },
  ]
  unitW = INNER / unitsOf(groups)
  return (
    <TableBox>
      <TableHead groups={groups} />
      {sites.map((s) => {
        const t = s.totals
        const c = combinedApplied(t)
        const none = s.stage === 'before' || s.rows.length === 0
        return (
          <div key={s.pblancNo} style={{ display: 'flex', width: '100%' }}>
            <Cell flex={3} bold align="left">{s.houseName || s.pblancNo}</Cell>
            <Cell>{fmtYm(s.dates.spsply || s.dates.rank1) || '-'}</Cell>
            <Cell>{t.supply > 0 ? fmtN(t.supply) : '-'}</Cell>
            {none ? <Cell flex={6} color={C.faint}>결과 없음</Cell> : [
              <Cell key="a">{fmtN(t.spsplyApplied)}</Cell>,
              <RateCell key="b" applied={t.spsplyApplied} base={t.spsplyAssigned} />,
              <Cell key="c">{t.rank1Applied > 0 ? fmtN(t.rank1Applied) : '-'}</Cell>,
              <RateCell key="d" applied={t.rank1Applied} base={t.rank1Applied > 0 ? t.rank1Assigned : 0} />,
              <Cell key="e" bold color={C.red700}>{fmtN(c)}</Cell>,
              <RateCell key="f" applied={c} base={t.supply} bold />,
            ]}
          </div>
        )
      })}
    </TableBox>
  )
}

// ---------- 본문 치수 계산 (높이를 미리 알아야 함) ----------
const TITLE_H = 24, LINE_H = 20, LINE_FS = 12.5
// 줄바꿈 수 추정: 한글 ≈ 1em, 숫자·영문·기호 ≈ 0.55em
function wrapCount(s: string): number {
  let em = 0
  for (let i = 0; i < s.length; i++) em += s.charCodeAt(i) > 0x2e7f ? 1 : 0.55
  return Math.max(1, Math.ceil((em * LINE_FS) / INNER))
}

function measure(data: { detail: ReportSite[]; compare: ReportSite[] }, hasAnnounce: boolean): number {
  let h = PAD + 50 + 16   // 머리글(제목 30px 행 + 밑줄) + 아래 여백
  for (const s of data.detail) {
    const { lines } = detailLines(s)
    h += TITLE_H + 6
    h += lines.reduce((a, l) => a + wrapCount(l) * LINE_H, 0) + 8
    if (s.rows.length > 0) h += HEAD_H * 2 + ROW_H * siteTableRows(s) + 1
    if (s.error) h += 16
    if (s.source.rank === 'db' || s.source.spsply === 'db') h += 14
    h += 20
  }
  if (data.compare.length > 0) h += 12 + 22 + 6 + HEAD_H * 2 + ROW_H * data.compare.length + 1
  h += 16 + 8 + 14 + PAD   // 출처 줄
  void hasAnnounce
  return Math.ceil(h)
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
function todayLabel(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000)
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} (${WEEKDAY[d.getUTCDay()]})`
}

export function defaultTitle(sites: ReportSite[]): string {
  const names = sites.map((s) => s.houseName).filter(Boolean)
  if (names.length === 0) return '청약결과 보고'
  if (names.length === 1) return names[0]
  let prefix = names[0]
  for (const n of names.slice(1)) {
    let i = 0
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++
    prefix = prefix.slice(0, i)
  }
  prefix = prefix.replace(/[\s(\-–—·]+$/, '').trim()
  const open = prefix.lastIndexOf('(')
  if (open >= 0 && prefix.indexOf(')', open) < 0) prefix = prefix.slice(0, open).trim()
  return prefix.length >= 2 ? prefix : names[0]
}

// ---------- 렌더 ----------
export async function renderReportImage(data: Pick<ReportData, 'detail' | 'compare'>, title: string, origin: string): Promise<ImageResponse> {
  const [fonts, logo] = await Promise.all([loadFonts(origin), loadLogo(origin)])
  const announce = data.detail[0]?.dates.announce || ''
  const height = measure(data, !!announce)
  const t = title || defaultTitle(data.detail.length ? data.detail : data.compare)

  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: px(W), height: px(height), background: 'white', padding: px(PAD), fontFamily: 'Paperlogy', color: C.text }}>
        {/* 머리글 */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: `${px(2)}px solid ${C.rule}`, paddingBottom: px(10), marginBottom: px(16), height: px(50) }}>
          <div style={{ display: 'flex', fontSize: px(30), fontWeight: 800, lineHeight: 1.1, letterSpacing: px(-0.5), color: '#111827' }}>{t}</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginLeft: px(16) }}>
            {logo && <img src={logo} alt="" height={px(28)} style={{ opacity: 0.9 }} />}
            <div style={{ display: 'flex', fontSize: px(10.5), color: C.muted, marginTop: px(4), letterSpacing: px(0.3) }}>{todayLabel()}</div>
          </div>
        </div>

        {/* 세부 단지 */}
        {data.detail.map((s) => {
          const { title: tt, lines } = detailLines(s)
          return (
            <div key={s.pblancNo} style={{ display: 'flex', flexDirection: 'column', marginBottom: px(20) }}>
              <div style={{ display: 'flex', fontSize: px(15), fontWeight: 800, color: '#111827', height: px(TITLE_H), alignItems: 'center', marginBottom: px(6) }}>{tt}</div>
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: px(8) }}>
                {lines.map((l, i) => (
                  <div key={i} style={{ display: 'flex', fontSize: px(LINE_FS), lineHeight: `${px(LINE_H)}px`, color: C.text }}>{l}</div>
                ))}
              </div>
              {s.rows.length > 0 && <SiteTable site={s} />}
              {s.error && <div style={{ display: 'flex', fontSize: px(11), color: '#ef4444', marginTop: px(4), height: px(12) }}>※ {s.error}</div>}
              {(s.source.rank === 'db' || s.source.spsply === 'db') && (
                <div style={{ display: 'flex', fontSize: px(10), color: C.faint, marginTop: px(4), height: px(10) }}>※ 청약홈 조회 불가 → 저장된 데이터(전일 기준)로 표시</div>
              )}
            </div>
          )
        })}

        {/* 비교 단지 */}
        {data.compare.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: px(0), paddingTop: px(12), borderTop: `${px(1)}px solid ${C.ruleLight}` }}>
            <div style={{ display: 'flex', fontSize: px(14), fontWeight: 800, color: '#111827', height: px(22), alignItems: 'center', marginBottom: px(6) }}>▶ 비교 단지</div>
            <CompareTable sites={data.compare} />
          </div>
        )}

        {/* 출처 */}
        <div style={{ display: 'flex', fontSize: px(10), color: C.faint, marginTop: px(16), paddingTop: px(8), borderTop: `${px(1)}px solid ${C.ruleFaint}`, height: px(22) }}>
          출처: 청약홈(applyhome.co.kr) · 경쟁률 = 접수 ÷ 모집세대, 합계 경쟁률 = 누계 접수 ÷ 총 공급세대{announce ? ` · 당첨자 발표 ${fmtMd(announce)}` : ''}
        </div>
      </div>
    ),
    { width: px(W), height: px(height), fonts },
  )
}
