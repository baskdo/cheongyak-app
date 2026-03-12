'use client'

import { useEffect, useState } from 'react'

type TypeInfo = {
  supply:number
  rank1Local:number
  rank1Other:number
  rank2Local:number
  rank2Other:number
}

type Item = {
  pblancNo:string
  houseName:string
  region:string
  start:string
  types:Record<string,TypeInfo>
}

export default function CompetitionPage(){

  const [items,setItems] = useState<Item[]>([])
  const [year,setYear] = useState(new Date().getFullYear())
  const [region,setRegion] = useState("")

  async function load(){

    const params = new URLSearchParams()

    params.set("year",String(year))

    if(region) params.set("region",region)

    const res = await fetch(`/api/competition?${params}`)

    const json = await res.json()

    setItems(json.items || [])

  }

  useEffect(()=>{

    load()

  },[year,region])

  return(

    <main style={{maxWidth:1200,margin:"auto",padding:40}}>

      <h1 style={{
        fontSize:40,
        textAlign:"center",
        marginBottom:40
      }}>
        🏢 청약홈 간략조회_Maru
      </h1>

      {/* 연도 선택 */}
      <div style={{marginBottom:20}}>

        {[2026,2025,2024,2023,2022,2021].map(y=>(

          <button
            key={y}
            onClick={()=>setYear(y)}
            style={{
              marginRight:10,
              padding:"6px 14px",
              background:year==y?"#2563eb":"#eee",
              color:year==y?"white":"black",
              borderRadius:6
            }}
          >
            {y}
          </button>

        ))}

      </div>

      {/* 지역 선택 */}
      <div style={{marginBottom:30}}>

        {["","서울","경기","인천","부산","대구","광주","대전","울산"].map(r=>(

          <button
            key={r}
            onClick={()=>setRegion(r)}
            style={{
              marginRight:8,
              padding:"5px 10px",
              background:region==r?"#333":"#eee",
              color:region==r?"white":"black",
              borderRadius:6
            }}
          >
            {r || "전체"}
          </button>

        ))}

      </div>

      {/* 카드 */}
      <div
        style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",
          gap:20
        }}
      >

        {items.map(item=>{

          const types = Object.entries(item.types)

          return(

            <div
              key={item.pblancNo}
              style={{
                border:"1px solid #ddd",
                borderRadius:10,
                padding:20,
                background:"white"
              }}
            >

              <div style={{fontWeight:700,fontSize:18}}>
                {item.houseName}
              </div>

              <div style={{color:"#666",fontSize:13}}>
                📍 {item.region}
              </div>

              <div style={{marginTop:10,fontSize:13}}>
                공고번호 {item.pblancNo}
              </div>

              {types.slice(0,1).map(([type,data])=>{

                const rank1 =
                  data.rank1Local + data.rank1Other

                const rank2 =
                  data.rank2Local + data.rank2Other

                return(

                  <div key={type} style={{marginTop:15}}>

                    <div>
                      특공 (접수)
                      <span style={{color:"blue"}}>
                        {rank1.toLocaleString()}
                      </span>
                      건
                    </div>

                    <div>
                      1순위 (접수)
                      <span style={{color:"red"}}>
                        {rank1.toLocaleString()}
                      </span>
                      건
                    </div>

                    <div>
                      - 해당 {data.rank1Local}
                      / 기타 {data.rank1Other}
                    </div>

                    <div>
                      2순위 {rank2}
                    </div>

                    <div style={{marginTop:6}}>
                      {type}㎡ (공급:{data.supply}/신청:{rank1})
                    </div>

                  </div>

                )

              })}

            </div>

          )

        })}

      </div>

    </main>

  )

}