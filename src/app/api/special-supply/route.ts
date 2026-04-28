import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// =============== 타입 ===============
type SpsplyRow = {
  HOUSE_MANAGE_NO?: string
  PBLANC_NO?: string
  HOUSE_NM?: string
  HOUSE_TY?: string
  SPSPLY_HSHLDCO?: number | string
  // 배정세대수 (Capacity)
  MNYCH_HSHLDCO?: number | string              // 다자녀
  NWWDS_NMTW_HSHLDCO?: number | string         // 신혼부부
  LFE_FRST_HSHLDCO?: number | string           // 생애최초
  YGMN_HSHLDCO?: number | string               // 청년
  OLD_PARNTS_SUPORT_HSHLDCO?: number | string  // 노부모
  NWBB_NWBBSHR_HSHLDCO?: number | string       // 신생아
  INSTT_RECOMEND_HSHLDCO?: number | string     // 기관추천
  TRANSR_INSTT_ENFSN_HSHLDCO?: number | string // 이전기관
  // 해당지역 접수건수
  CRSPAREA_MNYCH_CNT?: number | string
  CRSPAREA_NWWDS_NMTW_CNT?: number | string
  CRSPAREA_LFE_FRST_CNT?: number | string
  CRSPAREA_YGMN_CNT?: number | string
  CRSPAREA_OPS_CNT?: number | string
  CRSPAREA_NWBB_NWBBSHR_CNT?: number | string
  // 기타경기 접수건수
  CTPRVN_MNYCH_CNT?: number | string
  CTPRVN_NWWDS_NMTW_CNT?: number | string
  CTPRVN_LFE_FRST_CNT?: number | string
  CTPRVN_YGMN_CNT?: number | string
  CTPRVN_OPS_CNT?: number | string
  CTPRVN_NWBB_NWBBSHR_CNT?: number | string
  // 기타지역 접수건수
  ETC_AREA_MNYCH_CNT?: number | string
  ETC_AREA_NWWDS_NMTW_CNT?: number | string
  ETC_AREA_LFE_FRST_CNT?: number | string
  ETC_AREA_YGMN_CNT?: number | string
  ETC_AREA_OPS_CNT?: number | string
  ETC_AREA_NWBB_NWBBSHR_CNT?: number | string
  // 기관추천 결정/미결
  INSTT_RECOMEND_DCSN_CNT?: number | string
  INSTT_RECOMEND_PREPAR_CNT?: number | string
  // 이전기관
  TRANSR_INSTT_ENFSN_CNT?: number | string
  // 청약결과
  SUBSCRPT_RESULT_NM?: string
}

type NoticeRow = {
  PBLANC_NO?: string
  HOUSE_MANAGE_NO?: string
  HOUSE_NM?: string
  HSSPLY_ADRES?: string
  SUBSCRPT_AREA_CODE_NM?: string
  RCEPT_BGNDE?: string
  RCEPT_ENDDE?: string
}

// =============== 헬퍼 ===============
async function fetchPaged<T>(endpoint: string, fresh = false): Promise<T[]> {
  const key = process.env.ODCLOUD_API_KEY
  if (!key) throw new Error('ODCLOUD_API_KEY not set')

  const perPage = 1000
  let page = 1
  let done = false
  const rows: T[] = []

  while (!done) {
    const url =
      `https://api.odcloud.kr/api/${endpoint}` +
      `?serviceKey=${encodeURIComponent(key)}` +
      `&page=${page}&perPage=${perPage}&returnType=JSON`

    const res = await fetch(url, fresh
      ? { cache: 'no-store' }
      : { next: { revalidate: 300 } } // 5분 캐시
    )

    if (!res.ok) {
      throw new Error(`API fetch failed: ${endpoint} ${res.status}`)
    }

    const json = await res.json()
    const data: T[] = json.data || []
    rows.push(...data)

    if (data.length < perPage) {
      done = true
    } else {
      page += 1
      if (page > 60) done = true // 안전장치
    }
  }
  return rows
}

function num(v: number | string | undefined): number {
  if (v === undefined || v === null || v === '') return 0
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return isNaN(n) ? 0 : n
}

function extractRegion(text: string): string {
  const regions = ['서울','경기','인천','부산','대구','광주','대전','울산','세종','강원','충북','충남','전북','전남','경북','경남','제주']
  for (const r of regions) {
    if (text.includes(r)) return r
  }
  return '기타'
}

function formatHouseType(ty: string): string {
  const trimmed = (ty || '').trim()
  if (!trimmed) return ''
  return trimmed.replace(/^0*(\d+)\.?\d*([A-Za-z]*)$/, () => {
    const num = parseFloat(trimmed)
    return Math.floor(num) + ''
  }) + (trimmed.match(/[A-Za-z]/) ? trimmed.match(/[A-Za-z]+$/)?.[0] || '' : '')
}

// =============== GET ===============
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const pblancNo = searchParams.get('pblancNo')?.trim() || ''
    const fresh = searchParams.get('fresh') === '1'

    // 1. 특별공급 + 공고 데이터 병렬 호출
    const [spsplyRows, noticeRows] = await Promise.all([
      fetchPaged<SpsplyRow>('ApplyhomeInfoCmpetRtSvc/v1/getAPTSpsplyReqstStus', fresh),
      fetchPaged<NoticeRow>('ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail', fresh),
    ])

    // 2. 공고번호 → 단지정보 맵
    const noticeMap = new Map<string, {
      houseName: string
      address: string
      region: string
      rceptBgnde: string
      rceptEndde: string
    }>()

    for (const n of noticeRows) {
      const no = String(n.PBLANC_NO || '').trim()
      if (!no) continue
      const address = n.HSSPLY_ADRES || ''
      noticeMap.set(no, {
        houseName: n.HOUSE_NM || '',
        address,
        region: extractRegion(n.SUBSCRPT_AREA_CODE_NM || address),
        rceptBgnde: n.RCEPT_BGNDE || '',
        rceptEndde: n.RCEPT_ENDDE || '',
      })
    }

    // 3. 공고번호별 그룹화 (주택형별 행 보존)
    const grouped = new Map<string, {
      pblancNo: string
      houseName: string
      region: string
      rceptBgnde: string
      rceptEndde: string
      subscrptResultNm: string
      houseTypes: Array<{
        type: string
        typeLabel: string
        spsplyHshldco: number
        // 카테고리별 데이터
        categories: Array<{
          name: string
          suply: number
          // 일반 6분류 (지역 구분)
          areaData?: { 해당: number; 기타경기: number; 기타지역: number }
          // 기관 (단순 결정/미결)
          instData?: { 결정: number; 미결: number }
        }>
      }>
    }>()

    for (const row of spsplyRows) {
      const no = String(row.PBLANC_NO || '').trim()
      if (!no) continue

      // 특정 공고번호만 조회 시 필터
      if (pblancNo && pblancNo !== no) continue

      const ty = String(row.HOUSE_TY || '').trim()
      if (!ty) continue

      // 모든 배정세대 합 = 0이면 의미 없는 행
      const totalAssigned = num(row.MNYCH_HSHLDCO) + num(row.NWWDS_NMTW_HSHLDCO) +
        num(row.LFE_FRST_HSHLDCO) + num(row.YGMN_HSHLDCO) +
        num(row.OLD_PARNTS_SUPORT_HSHLDCO) + num(row.NWBB_NWBBSHR_HSHLDCO) +
        num(row.INSTT_RECOMEND_HSHLDCO) + num(row.TRANSR_INSTT_ENFSN_HSHLDCO)
      if (totalAssigned === 0) continue

      if (!grouped.has(no)) {
        const meta = noticeMap.get(no)
        grouped.set(no, {
          pblancNo: no,
          houseName: meta?.houseName || row.HOUSE_NM || '단지명 확인중',
          region: meta?.region || '기타',
          rceptBgnde: meta?.rceptBgnde || '',
          rceptEndde: meta?.rceptEndde || '',
          subscrptResultNm: row.SUBSCRPT_RESULT_NM || '',
          houseTypes: [],
        })
      }

      const group = grouped.get(no)!

      // 카테고리 빌드
      const categories: typeof group.houseTypes[number]['categories'] = []

      // 일반 6분류 (지역구분 있음)
      const general = [
        { name: '다자녀', suply: num(row.MNYCH_HSHLDCO),
          해당: num(row.CRSPAREA_MNYCH_CNT), 기타경기: num(row.CTPRVN_MNYCH_CNT), 기타지역: num(row.ETC_AREA_MNYCH_CNT) },
        { name: '신혼부부', suply: num(row.NWWDS_NMTW_HSHLDCO),
          해당: num(row.CRSPAREA_NWWDS_NMTW_CNT), 기타경기: num(row.CTPRVN_NWWDS_NMTW_CNT), 기타지역: num(row.ETC_AREA_NWWDS_NMTW_CNT) },
        { name: '생애최초', suply: num(row.LFE_FRST_HSHLDCO),
          해당: num(row.CRSPAREA_LFE_FRST_CNT), 기타경기: num(row.CTPRVN_LFE_FRST_CNT), 기타지역: num(row.ETC_AREA_LFE_FRST_CNT) },
        { name: '청년', suply: num(row.YGMN_HSHLDCO),
          해당: num(row.CRSPAREA_YGMN_CNT), 기타경기: num(row.CTPRVN_YGMN_CNT), 기타지역: num(row.ETC_AREA_YGMN_CNT) },
        { name: '노부모', suply: num(row.OLD_PARNTS_SUPORT_HSHLDCO),
          해당: num(row.CRSPAREA_OPS_CNT), 기타경기: num(row.CTPRVN_OPS_CNT), 기타지역: num(row.ETC_AREA_OPS_CNT) },
        { name: '신생아', suply: num(row.NWBB_NWBBSHR_HSHLDCO),
          해당: num(row.CRSPAREA_NWBB_NWBBSHR_CNT), 기타경기: num(row.CTPRVN_NWBB_NWBBSHR_CNT), 기타지역: num(row.ETC_AREA_NWBB_NWBBSHR_CNT) },
      ]

      for (const g of general) {
        if (g.suply > 0) {
          categories.push({
            name: g.name,
            suply: g.suply,
            areaData: { 해당: g.해당, 기타경기: g.기타경기, 기타지역: g.기타지역 },
          })
        }
      }

      // 기관 분류 (단순 결정/미결)
      const inst = [
        { name: '기관추천', suply: num(row.INSTT_RECOMEND_HSHLDCO),
          결정: num(row.INSTT_RECOMEND_DCSN_CNT), 미결: num(row.INSTT_RECOMEND_PREPAR_CNT) },
        { name: '이전기관', suply: num(row.TRANSR_INSTT_ENFSN_HSHLDCO),
          결정: num(row.TRANSR_INSTT_ENFSN_CNT), 미결: 0 },
      ]
      for (const i of inst) {
        if (i.suply > 0) {
          categories.push({
            name: i.name,
            suply: i.suply,
            instData: { 결정: i.결정, 미결: i.미결 },
          })
        }
      }

      // 주택형 표시 (084.5600A → 84A)
      const typeLabel = ty.replace(/^0*(\d+)\.?\d*([A-Za-z]*)$/, (_, _num, suffix) => {
        return Math.floor(parseFloat(ty)) + String(suffix || '').toUpperCase()
      })

      group.houseTypes.push({
        type: ty,
        typeLabel,
        spsplyHshldco: num(row.SPSPLY_HSHLDCO),
        categories,
      })
    }

    // 주택형별 정렬
    for (const item of grouped.values()) {
      item.houseTypes.sort((a, b) => a.type.localeCompare(b.type))
    }

    const items = Array.from(grouped.values())
      .sort((a, b) => (b.rceptBgnde || '').localeCompare(a.rceptBgnde || ''))

    return NextResponse.json({ items, total: items.length })
  } catch (error) {
    console.error('[special-supply GET] error:', error)
    return NextResponse.json({ items: [], total: 0, error: String(error) })
  }
}
