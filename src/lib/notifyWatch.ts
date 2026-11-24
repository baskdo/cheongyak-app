import { neon } from '@neondatabase/serverless'

// 텔레그램 알림 예약(notify_watch) 공용 — route 파일은 HTTP 핸들러만 export 해야 해서 분리

export type NotifyWatch = {
  id: number
  title: string
  detail: string[]
  compare: string[]
  active: boolean
  createdAt: string
}

export type Row = { id: number; title: string | null; detail: string | null; compare: string | null; active: boolean; created_at: string }

export function split(v: string | null): string[] {
  return (v || '').split(',').map((s) => s.trim()).filter((s) => /^\d{6,12}$/.test(s))
}
export function toWatch(r: Row): NotifyWatch {
  return { id: r.id, title: r.title || '', detail: split(r.detail), compare: split(r.compare), active: r.active, createdAt: r.created_at }
}

export async function getSql() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) throw new Error('DATABASE_URL not set')
  // Next.js 가 route handler 안의 fetch(POST 포함)를 데이터 캐시에 넣을 수 있어 예약 조회가 과거 값으로 고정되는 문제 →
  // Neon 드라이버의 fetch 에 cache:'no-store' 를 명시 (알림 체크가 11/10 예약을 계속 읽던 원인)
  const sql = neon(dbUrl, { fetchOptions: { cache: 'no-store' } })
  await sql`CREATE TABLE IF NOT EXISTS notify_watch (
    id serial PRIMARY KEY,
    title text,
    detail text,
    compare text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`
  return sql
}

export async function loadActiveWatch(): Promise<NotifyWatch | null> {
  const sql = await getSql()
  const rows = (await sql`SELECT * FROM notify_watch WHERE active = true ORDER BY id DESC LIMIT 1`) as Row[]
  // 캐시 등으로 비활성 행이 돌아오면 예약 없음으로 취급 (잘못된 단지로 감시하는 것보다 안전)
  return rows[0] && rows[0].active ? toWatch(rows[0]) : null
}

// 켜져 있는 예약 전부 — 접수 순서(id 오름차순). 알림은 같은 날 저녁 발표가 겹치면 이 순서대로 보낸다.
export async function loadActiveWatches(): Promise<NotifyWatch[]> {
  const sql = await getSql()
  const rows = (await sql`SELECT * FROM notify_watch WHERE active = true ORDER BY id ASC`) as Row[]
  return rows.filter((r) => r.active).map(toWatch)
}

export async function deactivateWatch(id: number) {
  const sql = await getSql()
  await sql`UPDATE notify_watch SET active = false WHERE id = ${id}`
}

