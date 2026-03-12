import fs from 'fs'
import path from 'path'

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

  console.log('[CSV] loading:', filePath)

  if (!fs.existsSync(filePath)) {
    console.error('[CSV] file not found:', filePath)
    return []
  }

  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '')

  if (lines.length === 0) {
    console.error('[CSV] empty file:', fileName)
    return []
  }

  const headers = parseCSVLine(lines[0])
  console.log('[CSV] headers:', fileName, headers.slice(0, 20))
  console.log('[CSV] line count:', fileName, lines.length)

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