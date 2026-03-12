import { NextRequest } from "next/server"
import fs from "fs"
import path from "path"

function parseCSV(text:string){

  const lines = text.split("\n").filter(Boolean)
  const header = lines[0].split(",")

  return lines.slice(1).map(line=>{

    const cols = line.split(",")

    const obj:any = {}

    header.forEach((h,i)=>{
      obj[h.trim()] = cols[i]
    })

    return obj
  })
}

export async function GET(req:NextRequest){

  const { searchParams } = new URL(req.url)

  const year = Number(searchParams.get("year"))
  const region = searchParams.get("region")

  const base = process.cwd()

  const competitionPath =
  path.join(base,"data","apt_competition_history.csv")

  const supplyPath =
  path.join(base,"data","apt_supply_info.csv")

  const typePath =
  path.join(base,"data","apt_house_type_info.csv")

  const competitionCSV =
  fs.readFileSync(competitionPath,"utf8")

  const supplyCSV =
  fs.readFileSync(supplyPath,"utf8")

  const typeCSV =
  fs.readFileSync(typePath,"utf8")

  const competition = parseCSV(competitionCSV)
  const supply = parseCSV(supplyCSV)
  const types = parseCSV(typeCSV)

  // 연도 필터
  const filteredSupply = supply.filter((row:any)=>{

    const date = row.RCRIT_PBLANC_DE || ""
    return date.startsWith(String(year))

  })

  // 지역 필터
  const regionSupply = region
    ? filteredSupply.filter((r:any)=>r.CNP_CD_NM?.includes(region))
    : filteredSupply

  const pblancSet = new Set(
    regionSupply.map((r:any)=>r.PBLANC_NO)
  )

  const filteredCompetition =
  competition.filter((r:any)=>pblancSet.has(r.PBLANC_NO))

  // 단지 그룹화
  const grouped:any = {}

  filteredCompetition.forEach((row:any)=>{

    const key = row.PBLANC_NO

    if(!grouped[key]){

      const info =
      regionSupply.find((s:any)=>s.PBLANC_NO==key)

      grouped[key] = {

        pblancNo:key,
        houseName:info?.HOUSE_NM,
        region:info?.CNP_CD_NM,
        start:info?.RCRIT_PBLANC_DE,
        types:{}

      }

    }

    const type = row.HOUSE_TY

    if(!grouped[key].types[type]){

      grouped[key].types[type] = {

        supply:Number(row.SUPLY_HSHLDCO),
        rank1Local:0,
        rank1Other:0,
        rank2Local:0,
        rank2Other:0

      }

    }

    const t = grouped[key].types[type]

    if(row.SUBSCRPT_RANK_CODE==1){

      if(row.RESIDE_SECD=="01")
        t.rank1Local += Number(row.REQ_CNT)

      else
        t.rank1Other += Number(row.REQ_CNT)

    }

    if(row.SUBSCRPT_RANK_CODE==2){

      if(row.RESIDE_SECD=="01")
        t.rank2Local += Number(row.REQ_CNT)

      else
        t.rank2Other += Number(row.REQ_CNT)

    }

  })

  const items = Object.values(grouped)

  return Response.json({
    items
  })

}