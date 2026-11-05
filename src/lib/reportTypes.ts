// 청약결과 보고서 — 표준 데이터 구조
// /api/report-data 가 만들고, /report 페이지·텔레그램 알림이 그대로 소비한다.
// 세부조회(detail)와 비교조회(compare) 단지는 같은 ReportSite 구조를 쓰고,
// 비교조회는 totals만 한 줄로 보여준다.

export type ReportStage = 'before' | 'spsply' | 'rank1' | 'rank2' | 'final'

export type ReportRow = {
  type: string          // 원본 주택형 "084.9594A"
  typeLabel: string     // "84A"
  supply: number        // 총 공급세대 (일반+특공, 공고 기준)
  spsplyAssigned: number // 특공 배정
  spsplyApplied: number  // 특공 접수
  rank1Assigned: number  // 1순위 모집세대 (특공 미달분 이월 반영 — 청약홈 표시값)
  rank1Applied: number   // 1순위 접수 합계
  rank1Local: number
  rank1Gg: number        // 기타경기 (경기 단지)
  rank1Etc: number       // 기타지역 (기타경기 제외)
  rank2Applied: number   // 2순위 접수 합계 (0이면 1순위 마감 또는 미도래)
  rank2HasData: boolean
}

export type ReportTotals = Omit<ReportRow, 'type' | 'typeLabel'>

export type ReportSite = {
  pblancNo: string
  houseName: string
  region: string
  address: string
  dates: {
    spsply: string   // YYYY-MM-DD
    rank1: string
    rank2: string
    announce: string // 당첨자 발표일
  }
  stage: ReportStage
  rows: ReportRow[]
  totals: ReportTotals
  source: {
    meta: 'api' | 'db' | 'none'
    spsply: 'applyhome' | 'db' | 'none'
    rank: 'applyhome' | 'db' | 'none'
  }
  error?: string
}

export type ReportData = {
  ok: boolean
  generatedAt: string       // ISO
  detail: ReportSite[]
  compare: ReportSite[]
  error?: string
}

// ---------- 계산 헬퍼 (표·멘트·엑셀이 같은 식을 쓰도록 여기 한 곳에) ----------
export function rate(applied: number, base: number): number {
  if (!base || base <= 0) return 0
  return Math.round((applied / base) * 100) / 100
}
export function fmtRate(r: number): string {
  return `${r.toFixed(2)}:1`
}
export function fmtN(n: number): string {
  return n.toLocaleString('ko-KR')
}
// 특공+1순위(+2순위) 누계 접수
export function combinedApplied(r: ReportTotals | ReportRow): number {
  return r.spsplyApplied + r.rank1Applied + (r.rank2HasData ? r.rank2Applied : 0)
}
// 1순위 후 2순위로 넘어가는 잔여세대 (음수면 경쟁 발생 → 0)
export function rank2Remain(r: ReportTotals | ReportRow): number {
  const remain = r.rank1Assigned - r.rank1Applied
  return remain > 0 ? remain : 0
}
// 1·2순위 후 잔여 (무순위 예정 물량)
export function finalRemain(r: ReportTotals | ReportRow): number {
  const remain = r.rank1Assigned - r.rank1Applied - (r.rank2HasData ? r.rank2Applied : 0)
  return remain > 0 ? remain : 0
}

export function emptyTotals(): ReportTotals {
  return {
    supply: 0, spsplyAssigned: 0, spsplyApplied: 0,
    rank1Assigned: 0, rank1Applied: 0, rank1Local: 0, rank1Gg: 0, rank1Etc: 0,
    rank2Applied: 0, rank2HasData: false,
  }
}

export function sumRows(rows: ReportRow[]): ReportTotals {
  const t = emptyTotals()
  for (const r of rows) {
    t.supply += r.supply
    t.spsplyAssigned += r.spsplyAssigned
    t.spsplyApplied += r.spsplyApplied
    t.rank1Assigned += r.rank1Assigned
    t.rank1Applied += r.rank1Applied
    t.rank1Local += r.rank1Local
    t.rank1Gg += r.rank1Gg
    t.rank1Etc += r.rank1Etc
    t.rank2Applied += r.rank2Applied
    if (r.rank2HasData) t.rank2HasData = true
  }
  return t
}
