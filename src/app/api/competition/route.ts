import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import iconv from 'iconv-lite'

const CMPET_SVC = 'https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1'

async function loadSupplyMap() {
  const file = path.join(process.cwd(), 'data', 'apt_supply_info.csv')

  const map: Record<string, any> = {}

  return new Promise<Record<string, any>>((resolve) => {
    fs.createReadStream(file)
      .pipe(iconv.decodeStream('cp949'))
      .pipe(csv())
      .on('data', (row) => {
        const pblanc = row['공고번호']
        if (!pblanc) return

        map[pblanc] = {
          houseName: row['주택명'] || '',
          region: row['공급지역명'] || '',
          address: row['공급위치'] || '',
          pblancDate: row['모집공고일'] || '',
        }
      })
      .on('end', () => resolve(map))
  })
}

async function loadCompetition(year: number) {
  const file = path.join(process.cwd(), 'data', 'apt_competition_history.csv')

  const rows: any[] = []

  return new Promise<any[]>((resolve) => {
    fs.createReadStream(file)
      .pipe(iconv.decodeStream('cp949'))
      .pipe(csv())
      .on('data', (row) => {
        const pblanc = String(row['공고번호'])

        if (pblanc.startsWith(String(year))) {
          rows.push(row)
        }
      })
      .on('end', () => resolve(rows))
  })
}

export async function GET(request: Request) {

  const { searchParams } = new URL(request.url)

  const year = parseInt(searchParams.get('year') || '')
  const keyword = searchParams.get('keyword') || ''
  const region = searchParams.get('region') || ''

  const currentYear = new Date().getFullYear()

  // 최근 3개년 → 실시간 API
  if (year >= currentYear - 2) {

    const apiKey = process.env.API_KEY2
    const enc = encodeURIComponent(apiKey || '')

    const res = await fetch(
      `${CMPET_SVC}/getAPTLttotPblancCmpet?serviceKey=${enc}&page=1&perPage=200&returnType=JSON`
    )

    const data = await res.json()

    return NextResponse.json({
      items: data.data || [],
      total: data.totalCount || 0,
    })
  }

  // 과거 데이터 → CSV

  const supplyMap = await loadSupplyMap()
  const rows = await loadCompetition(year)

  const group: Record<string, any> = {}

  rows.forEach((r) => {

    const pblanc = r['공고번호']
    const supply = supplyMap[pblanc]

    if (!group[pblanc]) {
      group[pblanc] = {
        pblancNo: pblanc,
        houseName: supply?.houseName || '',
        region: supply?.region || '',
        rceptBgnde: '',
        rceptEndde: '',
        houseTypes: []
      }
    }

    group[pblanc].houseTypes.push({
      type: r['주택형'],
      rate: r['경쟁률'],
      reqCnt: r['접수건수'],
      suply: r['공급세대수'],
      rank: r['순위'],
      reside: r['거주지역']
    })

  })

  let results = Object.values(group)

  if (keyword) {
    results = results.filter((r:any) => r.houseName.includes(keyword))
  }

  if (region && region !== '전체') {
    results = results.filter((r:any) => r.region.includes(region))
  }

  return NextResponse.json({
    items: results,
    total: results.length
  })
}