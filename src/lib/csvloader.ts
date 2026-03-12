import fs from 'fs'
import path from 'path'
import iconv from 'iconv-lite'

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  result.push(current)
  return result.map(v => v.trim())
}

export function loadCSV(fileName: string): Record<string, string>[] {
  const filePath = path.join(process.cwd(), 'data', fileName)

  if (!fs.existsSync(filePath)) {
    console.error('[CSV] file not found:', filePath)
    return []
  }

  const buffer = fs.readFileSync(filePath)

  let raw = ''
  try {
    raw = iconv.decode(buffer, 'cp949')
  } catch {
    raw = buffer.toString('utf8')
  }

  raw = raw.replace(/^\uFEFF/, '')

  const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length === 0) return []

  const headers = parseCSVLine(lines[0])
  console.log('[CSV] loading:', fileName)
  console.log('[CSV] headers:', headers.slice(0, 15))
  console.log('[CSV] rows:', lines.length - 1)

  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line)
    const row: Record<string, string> = {}

    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? ''
    })

    return row
  })
}

export function pick(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key]
  }
  return ''
}