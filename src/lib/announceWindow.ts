// 청약홈 발표 시간대 판정 (KST 기준)
// 청약홈은 접수 마감일 저녁 7:30 전후에 경쟁률/특공 결과를 게시한다.
// 이 시간대에는 서버 캐시(5분)를 쓰지 않고 매번 청약홈을 직접 조회해야
// "발표 전 빈 응답"이 캐시에 남아 사용자가 5분간 옛 화면을 보는 문제를 막을 수 있다.
export const ANNOUNCE_WINDOW = { startMin: 19 * 60 + 20, endMin: 20 * 60 + 45 } // 19:20 ~ 20:45

export function kstMinutesOfDay(d: Date = new Date()): number {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.getUTCHours() * 60 + kst.getUTCMinutes()
}

export function isAnnounceWindow(d: Date = new Date()): boolean {
  const m = kstMinutesOfDay(d)
  return m >= ANNOUNCE_WINDOW.startMin && m <= ANNOUNCE_WINDOW.endMin
}

// fetch 옵션: 발표 시간대면 no-store, 아니면 5분 캐시
export function applyhomeFetchCache(): { cache: 'no-store' } | { next: { revalidate: number } } {
  return isAnnounceWindow() ? { cache: 'no-store' } : { next: { revalidate: 300 } }
}
