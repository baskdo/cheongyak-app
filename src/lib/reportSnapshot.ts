import { neon } from '@neondatabase/serverless'
import { randomBytes } from 'crypto'
import type { ReportSite } from './reportTypes'

// 보고서 스냅샷 — 텔레그램 이미지가 "문자로 보낸 그 숫자" 그대로 그려지도록,
// 발송 시점의 데이터를 저장해 두고 이미지 주소(/api/report-image?id=…)는 이것을 읽는다.

export type Snapshot = { detail: ReportSite[]; compare: ReportSite[]; title: string }

async function client() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  const sql = neon(url, { fetchOptions: { cache: 'no-store' } })
  await sql`CREATE TABLE IF NOT EXISTS report_snapshots (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`
  return sql
}

export async function saveSnapshot(snap: Snapshot): Promise<string | null> {
  try {
    const sql = await client()
    if (!sql) return null
    const id = randomBytes(9).toString('base64url')
    await sql`INSERT INTO report_snapshots (id, data) VALUES (${id}, ${JSON.stringify(snap)}::jsonb)`
    // 30일 지난 스냅샷 정리
    await sql`DELETE FROM report_snapshots WHERE created_at < now() - interval '30 days'`
    return id
  } catch (e) {
    console.error('[snapshot] save fail', e)
    return null
  }
}

export async function loadSnapshot(id: string): Promise<Snapshot | null> {
  try {
    const sql = await client()
    if (!sql) return null
    const rows = (await sql`SELECT data FROM report_snapshots WHERE id = ${id}`) as Array<{ data: Snapshot }>
    return rows[0]?.data || null
  } catch { return null }
}
