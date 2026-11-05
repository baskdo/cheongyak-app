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
  const sql = neon(dbUrl)
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
  return rows[0] ? toWatch(rows[0]) : null
}

export async function deactivateWatch(id: number) {
  const sql = await getSql()
  await sql`UPDATE notify_watch SET active = false WHERE id = ${id}`
}

