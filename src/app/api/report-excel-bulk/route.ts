import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// =============== 타입 정의 ===============
// 한 단지 데이터 (여러 단지를 배열로 받음)
type BulkRow = {
  type: string         // 원본 ("059.9714")
  typeLabel: string    // 표시용 ("59" 또는 "59A")
  suply: number        // 1순위 공급세대수
  spsplyAssigned: number  // 특별공급 배정세대수
  spsplyApplied: number   // 특별공급 청약접수
  rank1Applied: number    // 1순위 청약접수 (해당+기타)
  rank2Applied: number    // 2순위 청약접수 (해당+기타)
}

type BulkHouse = {
  houseName: string
  region: string
  rceptBgnde: string  // 접수시작일 (YYYY-MM-DD)
  rows: BulkRow[]
}

type BulkPayload = {
  reportDate: string                 // 다운로드일 (YYYY-MM-DD)
  filterRegion?: string              // 필터 지역 (예: "인천")
  filterPeriod?: string              // 필터 기간 (예: "2025년" 또는 "최근 1년")
  houses: BulkHouse[]                // 단지 배열
}

// =============== 비고 자동 판정 ===============
function determineNote(row: BulkRow): string {
  if (row.suply <= 0) return ''
  const rank1Rate = row.rank1Applied / row.suply
  const totalRate = (row.rank1Applied + row.rank2Applied) / row.suply

  if (rank1Rate >= 1) return '1순위 마감'
  if (totalRate >= 1) return '2순위 마감'
  if (row.rank2Applied > 0) return '2순위 접수'
  return '미달'
}

// =============== 통합 시트 작성 ===============
function buildBulkSheet(ws: ExcelJS.Worksheet, payload: BulkPayload) {
  ws.columns = [
    { header: '단지명', key: 'houseName', width: 32 },
    { header: '지역', key: 'region', width: 8 },
    { header: '접수일', key: 'rceptBgnde', width: 12 },
    { header: '주택형(원본)', key: 'type', width: 14 },
    { header: '주택형(표시)', key: 'typeLabel', width: 12 },
    { header: '공급세대수', key: 'suply', width: 12 },
    { header: '특공_배정', key: 'spsplyAssigned', width: 12 },
    { header: '특공_청약', key: 'spsplyApplied', width: 12 },
    { header: '특공_경쟁률', key: 'spsplyRate', width: 12 },
    { header: '1순위_배정', key: 'rank1Assigned', width: 12 },
    { header: '1순위_청약', key: 'rank1Applied', width: 12 },
    { header: '1순위_경쟁률', key: 'rank1Rate', width: 12 },
    { header: '2순위_청약', key: 'rank2Applied', width: 12 },
    { header: '전체_접수', key: 'totalApplied', width: 12 },
    { header: '전체_경쟁률', key: 'totalRate', width: 12 },
    { header: '비고', key: 'note', width: 16 },
  ]

  // 헤더 스타일
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true, size: 11 }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7E6E6' },
  }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow.height = 24

  // 표시 헬퍼
  const dashIfZero = (n: number): number | string => (n > 0 ? n : '-')
  const rateOrDash = (n: number, denom: number): number | string =>
    denom > 0 && n > 0 ? Number((n / denom).toFixed(2)) : '-'

  // 단지별 데이터 행 추가
  for (const house of payload.houses) {
    let totalSuply = 0
    let totalSpsplyAssigned = 0
    let totalSpsplyApplied = 0
    let totalRank1Applied = 0
    let totalRank2Applied = 0

    // 주택형별 행
    for (const row of house.rows) {
      const totalApplied = row.rank1Applied + row.rank2Applied
      const note = determineNote(row)

      ws.addRow({
        houseName: house.houseName,
        region: house.region,
        rceptBgnde: house.rceptBgnde,
        type: row.type,
        typeLabel: row.typeLabel,
        suply: row.suply,
        spsplyAssigned: row.spsplyAssigned > 0 ? row.spsplyAssigned : '-',
        spsplyApplied: row.spsplyAssigned > 0 ? dashIfZero(row.spsplyApplied) : '-',
        spsplyRate: row.spsplyAssigned > 0 ? rateOrDash(row.spsplyApplied, row.spsplyAssigned) : '-',
        rank1Assigned: row.suply,
        rank1Applied: dashIfZero(row.rank1Applied),
        rank1Rate: rateOrDash(row.rank1Applied, row.suply),
        rank2Applied: dashIfZero(row.rank2Applied),
        totalApplied: dashIfZero(totalApplied),
        totalRate: rateOrDash(totalApplied, row.suply),
        note,
      })

      totalSuply += row.suply
      totalSpsplyAssigned += row.spsplyAssigned
      totalSpsplyApplied += row.spsplyApplied
      totalRank1Applied += row.rank1Applied
      totalRank2Applied += row.rank2Applied
    }

    // 단지별 합계 행 (굵게만)
    const totalAll = totalRank1Applied + totalRank2Applied
    const summaryRow = ws.addRow({
      houseName: house.houseName,
      region: house.region,
      rceptBgnde: house.rceptBgnde,
      type: '합계',
      typeLabel: '합계',
      suply: totalSuply,
      spsplyAssigned: dashIfZero(totalSpsplyAssigned),
      spsplyApplied: dashIfZero(totalSpsplyApplied),
      spsplyRate: rateOrDash(totalSpsplyApplied, totalSpsplyAssigned),
      rank1Assigned: totalSuply,
      rank1Applied: dashIfZero(totalRank1Applied),
      rank1Rate: rateOrDash(totalRank1Applied, totalSuply),
      rank2Applied: dashIfZero(totalRank2Applied),
      totalApplied: dashIfZero(totalAll),
      totalRate: rateOrDash(totalAll, totalSuply),
      note: '',
    })
    summaryRow.font = { bold: true }
  }

  // 헤더 고정 (스크롤 시 헤더 항상 보임)
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  // 자동 필터 활성화 (엑셀에서 컬럼별 필터 즉시 사용 가능)
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: ws.rowCount, column: ws.columnCount },
  }
}

// =============== POST: 페이로드 받아서 .xlsx 생성 ===============
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BulkPayload

    if (!payload || !Array.isArray(payload.houses)) {
      return NextResponse.json({ error: '잘못된 페이로드 형식입니다.' }, { status: 400 })
    }

    if (payload.houses.length === 0) {
      return NextResponse.json({ error: '다운로드할 단지가 없습니다.' }, { status: 400 })
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = '청약홈 요약'
    workbook.created = new Date()

    const sheet = workbook.addWorksheet('청약접수통계')
    buildBulkSheet(sheet, payload)

    const buffer = await workbook.xlsx.writeBuffer()

    // 파일명 구성: 경쟁률조회_{지역}_{기간}_{YYYYMMDD}.xlsx
    const dateForFilename = payload.reportDate.replace(/-/g, '')
    const region = payload.filterRegion && payload.filterRegion !== '전체'
      ? `_${payload.filterRegion}`
      : ''
    const period = payload.filterPeriod
      ? `_${payload.filterPeriod.replace(/[\\/:*?"<>|\s]/g, '')}`
      : ''
    const filename = `경쟁률조회${region}${period}_${dateForFilename}.xlsx`

    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (e) {
    console.error('[report-excel-bulk POST] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
