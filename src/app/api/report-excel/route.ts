import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs' // exceljs는 nodejs 런타임 필요

// =============== 타입 정의 (page.tsx와 동일 구조) ===============
type ReportRow = {
  type: string         // 원본 ("059.9714")
  typeLabel: string    // 표시용 ("59" 또는 "59A")
  suply: number        // 1순위 공급세대수
  spsplyAssigned: number  // 특별공급 배정세대수
  spsplyApplied: number   // 특별공급 청약접수
  rank1Applied: number    // 1순위 청약접수 (해당+기타)
  rank2Applied: number    // 2순위 청약접수 (해당+기타)
}

type ReportPayload = {
  houseName: string       // 단지명
  reportDate: string      // 보고서 작성일 (YYYY-MM-DD)
  rows: ReportRow[]       // 주택형별 데이터
}

// =============== 셀 스타일 헬퍼 ===============
function applyHeaderStyle(cell: ExcelJS.Cell) {
  cell.font = { bold: true, size: 11 }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7E6E6' },  // 연한 회색
  }
  cell.border = {
    top: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
  }
}

function applyDataStyle(cell: ExcelJS.Cell, opts?: { highlight?: boolean; bold?: boolean }) {
  cell.font = { bold: opts?.bold ?? false, size: 11 }
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
  if (opts?.highlight) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFF2CC' },  // 연한 노랑 (경쟁률 강조)
    }
  }
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
    bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
    left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
    right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  }
}

function applyTotalStyle(cell: ExcelJS.Cell, opts?: { highlight?: boolean }) {
  cell.font = { bold: true, size: 11 }
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: opts?.highlight ? 'FFFFE699' : 'FFFFF2CC' },
  }
  cell.border = {
    top: { style: 'medium', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
    right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  }
}

// =============== 비고 자동 판정 ===============
function determineNote(row: ReportRow): string {
  if (row.suply <= 0) return ''
  const rank1Rate = row.rank1Applied / row.suply
  const totalRate = (row.rank1Applied + row.rank2Applied) / row.suply

  if (rank1Rate >= 1) return '1순위 마감'
  if (totalRate >= 1) return '2순위 마감'
  if (row.rank2Applied > 0) return '2순위 접수'
  return '미달'
}

// =============== 보고서 시트 작성 ===============
function buildReportSheet(ws: ExcelJS.Worksheet, payload: ReportPayload) {
  // 컬럼 너비
  ws.columns = [
    { width: 12 },  // A: 타입
    { width: 8 },   // B: 세대수
    { width: 8 },   // C: 특공-배정
    { width: 8 },   // D: 특공-청약
    { width: 10 },  // E: 특공-경쟁률
    { width: 8 },   // F: 1순위-배정
    { width: 8 },   // G: 1순위-청약
    { width: 10 },  // H: 1순위-경쟁률
    { width: 10 },  // I: 2순위-청약
    { width: 10 },  // J: 접수(전체)
    { width: 10 },  // K: 경쟁률(전체)
    { width: 14 },  // L: 비고
  ]

  // === 제목 행 (단지명) ===
  ws.mergeCells('A1:L1')
  const titleCell = ws.getCell('A1')
  titleCell.value = payload.houseName
  titleCell.font = { bold: true, size: 16 }
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  titleCell.border = {
    top: { style: 'medium' },
    bottom: { style: 'medium' },
    left: { style: 'medium' },
    right: { style: 'medium' },
  }
  ws.getRow(1).height = 30

  // === 헤더 행 1 (대분류, 행 2~3 병합) ===
  ws.mergeCells('A2:A3')   // 타입
  ws.mergeCells('B2:B3')   // 세대수
  ws.mergeCells('C2:E2')   // 특별공급
  ws.mergeCells('F2:H2')   // 1순위
  ws.mergeCells('I2:K2')   // 2순위/접수/경쟁률 (사실 분리 헤더)
  ws.mergeCells('L2:L3')   // 비고

  ws.getCell('A2').value = '타입'
  ws.getCell('B2').value = '세대수'
  ws.getCell('C2').value = '특별공급'
  ws.getCell('F2').value = '1순위'
  ws.getCell('I2').value = '2순위 / 접수 / 경쟁률'
  ws.getCell('L2').value = '비고'

  // === 헤더 행 2 (소분류) ===
  ws.getCell('C3').value = '배정'
  ws.getCell('D3').value = '청약'
  ws.getCell('E3').value = '경쟁률'
  ws.getCell('F3').value = '배정'
  ws.getCell('G3').value = '청약'
  ws.getCell('H3').value = '경쟁률'
  ws.getCell('I3').value = '청약(2순위)'
  ws.getCell('J3').value = '접수(전체)'
  ws.getCell('K3').value = '경쟁률(전체)'

  // 헤더 스타일 적용
  for (let r = 2; r <= 3; r++) {
    for (let c = 1; c <= 12; c++) {
      const cell = ws.getRow(r).getCell(c)
      applyHeaderStyle(cell)
    }
  }
  ws.getRow(2).height = 22
  ws.getRow(3).height = 22

  // === 데이터 행 (4번째 행부터) ===
  let rowNum = 4
  let totalSuply = 0
  let totalSpsplyAssigned = 0
  let totalSpsplyApplied = 0
  let totalRank1Applied = 0
  let totalRank2Applied = 0

  for (const row of payload.rows) {
    const r = ws.getRow(rowNum)

    const spsplyRate = row.spsplyAssigned > 0 ? row.spsplyApplied / row.spsplyAssigned : 0
    const rank1Rate = row.suply > 0 ? row.rank1Applied / row.suply : 0
    const totalApplied = row.rank1Applied + row.rank2Applied
    const totalRate = row.suply > 0 ? totalApplied / row.suply : 0
    const note = determineNote(row)

    r.getCell(1).value = row.typeLabel + (row.type.match(/[A-Z]$/) ? '' : '')
    r.getCell(2).value = row.suply
    // 특공 (배정 0이면 빈칸)
    r.getCell(3).value = row.spsplyAssigned > 0 ? row.spsplyAssigned : null
    r.getCell(4).value = row.spsplyAssigned > 0 ? row.spsplyApplied : null
    r.getCell(5).value = row.spsplyAssigned > 0 ? Number(spsplyRate.toFixed(2)) : null
    // 1순위
    r.getCell(6).value = row.suply
    r.getCell(7).value = row.rank1Applied
    r.getCell(8).value = Number(rank1Rate.toFixed(2))
    // 2순위 / 접수(전체) / 경쟁률(전체)
    r.getCell(9).value = row.rank2Applied > 0 ? row.rank2Applied : null
    r.getCell(10).value = totalApplied
    r.getCell(11).value = Number(totalRate.toFixed(2))
    // 비고
    r.getCell(12).value = note

    // 셀 스타일
    for (let c = 1; c <= 12; c++) {
      const cell = r.getCell(c)
      const isRateCell = (c === 5 || c === 8 || c === 11)
      applyDataStyle(cell, { highlight: isRateCell })
    }
    r.height = 22

    // 합계 누적
    totalSuply += row.suply
    totalSpsplyAssigned += row.spsplyAssigned
    totalSpsplyApplied += row.spsplyApplied
    totalRank1Applied += row.rank1Applied
    totalRank2Applied += row.rank2Applied

    rowNum++
  }

  // === 합계 행 ===
  const totalRow = ws.getRow(rowNum)
  const totalSpsplyRate = totalSpsplyAssigned > 0 ? totalSpsplyApplied / totalSpsplyAssigned : 0
  const totalRank1Rate = totalSuply > 0 ? totalRank1Applied / totalSuply : 0
  const totalAll = totalRank1Applied + totalRank2Applied
  const totalAllRate = totalSuply > 0 ? totalAll / totalSuply : 0

  totalRow.getCell(1).value = '계'
  totalRow.getCell(2).value = totalSuply
  totalRow.getCell(3).value = totalSpsplyAssigned
  totalRow.getCell(4).value = totalSpsplyApplied
  totalRow.getCell(5).value = Number(totalSpsplyRate.toFixed(2))
  totalRow.getCell(6).value = totalSuply
  totalRow.getCell(7).value = totalRank1Applied
  totalRow.getCell(8).value = Number(totalRank1Rate.toFixed(2))
  totalRow.getCell(9).value = totalRank2Applied > 0 ? totalRank2Applied : null
  totalRow.getCell(10).value = totalAll
  totalRow.getCell(11).value = Number(totalAllRate.toFixed(2))
  totalRow.getCell(12).value = ''

  for (let c = 1; c <= 12; c++) {
    const cell = totalRow.getCell(c)
    const isRateCell = (c === 5 || c === 8 || c === 11)
    applyTotalStyle(cell, { highlight: isRateCell })
  }
  totalRow.height = 24
  rowNum++

  // === 비율 행 (특공 배정 / 총 세대수) ===
  const ratioRow = ws.getRow(rowNum)
  const spsplyRatio = totalSuply > 0 ? totalSpsplyAssigned / totalSuply : 0

  ratioRow.getCell(1).value = '비율'
  ratioRow.getCell(3).value = Number((spsplyRatio * 100).toFixed(1))
  ratioRow.getCell(3).numFmt = '0.0"%"'
  ratioRow.getCell(2).value = ''
  // 나머지 셀은 빈칸
  for (let c = 1; c <= 12; c++) {
    const cell = ratioRow.getCell(c)
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
      bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
      left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
      right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
    }
    if (c === 1 || c === 3) {
      cell.font = { bold: true, size: 11 }
    }
  }
  ratioRow.height = 22
  rowNum++

  // === 보고서 작성일 (하단) ===
  rowNum += 1
  const dateRow = ws.getRow(rowNum)
  ws.mergeCells(`A${rowNum}:L${rowNum}`)
  dateRow.getCell(1).value = `※ 보고서 작성일: ${payload.reportDate}`
  dateRow.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF606060' } }
  dateRow.getCell(1).alignment = { horizontal: 'right' }
}

// =============== 원본 데이터 시트 ===============
function buildRawDataSheet(ws: ExcelJS.Worksheet, payload: ReportPayload) {
  ws.columns = [
    { header: '주택형(원본)', key: 'type', width: 14 },
    { header: '주택형(표시)', key: 'typeLabel', width: 12 },
    { header: '공급세대수', key: 'suply', width: 12 },
    { header: '특공_배정', key: 'spsplyAssigned', width: 12 },
    { header: '특공_청약', key: 'spsplyApplied', width: 12 },
    { header: '특공_경쟁률', key: 'spsplyRate', width: 12 },
    { header: '1순위_청약', key: 'rank1Applied', width: 12 },
    { header: '1순위_경쟁률', key: 'rank1Rate', width: 12 },
    { header: '2순위_청약', key: 'rank2Applied', width: 12 },
    { header: '전체_접수', key: 'totalApplied', width: 12 },
    { header: '전체_경쟁률', key: 'totalRate', width: 12 },
    { header: '비고', key: 'note', width: 16 },
  ]

  // 헤더 스타일
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7E6E6' },
  }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

  // 데이터 행
  for (const row of payload.rows) {
    const spsplyRate = row.spsplyAssigned > 0 ? row.spsplyApplied / row.spsplyAssigned : 0
    const rank1Rate = row.suply > 0 ? row.rank1Applied / row.suply : 0
    const totalApplied = row.rank1Applied + row.rank2Applied
    const totalRate = row.suply > 0 ? totalApplied / row.suply : 0
    const note = determineNote(row)

    ws.addRow({
      type: row.type,
      typeLabel: row.typeLabel,
      suply: row.suply,
      spsplyAssigned: row.spsplyAssigned || '',
      spsplyApplied: row.spsplyApplied || '',
      spsplyRate: row.spsplyAssigned > 0 ? Number(spsplyRate.toFixed(2)) : '',
      rank1Applied: row.rank1Applied,
      rank1Rate: Number(rank1Rate.toFixed(2)),
      rank2Applied: row.rank2Applied,
      totalApplied,
      totalRate: Number(totalRate.toFixed(2)),
      note,
    })
  }

  // 단지 정보 행 (마지막)
  ws.addRow([])
  ws.addRow(['단지명', payload.houseName])
  ws.addRow(['보고서 작성일', payload.reportDate])
}

// =============== POST: 페이로드 받아서 .xlsx 생성 ===============
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ReportPayload

    if (!payload || !payload.houseName || !Array.isArray(payload.rows)) {
      return NextResponse.json({ error: '잘못된 페이로드 형식입니다.' }, { status: 400 })
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = '청약홈 요약'
    workbook.created = new Date()

    // 시트 1: 보고서
    const reportSheet = workbook.addWorksheet('청약접수결과')
    buildReportSheet(reportSheet, payload)

    // 시트 2: 원본 데이터
    const rawSheet = workbook.addWorksheet('원본데이터')
    buildRawDataSheet(rawSheet, payload)

    // 바이너리 응답
    const buffer = await workbook.xlsx.writeBuffer()

    // 파일명: {단지명}_청약접수결과_{YYYYMMDD}.xlsx
    const safeName = payload.houseName.replace(/[\\/:*?"<>|]/g, '_')
    const dateForFilename = payload.reportDate.replace(/-/g, '')
    const filename = `${safeName}_청약접수결과_${dateForFilename}.xlsx`

    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (e) {
    console.error('[report-excel POST] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
