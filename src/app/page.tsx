'use client'

import { useEffect, useState, useCallback } from 'react'

// ===================== TYPES =====================
type TypeDetail = {
  type: string
  typeLabel: string
  supplyArea: number
  pyeong: number
  topAmount: number
  pyeongPrice: number
  suplyHshldco: number
}

type ApartmentItem = {
  id: string
  name: string
  address: string
  region: string
  type: string
  totalUnits: string
  rceptBgnde: string
  rceptEndde: string
  przwnerPresnatnDe: string
  pblancDe: string
  status: '접수예정' | '접수중' | '접수마감'
  hompageUrl: string
  constructor: string
  moveInDate: string
  pdfUrl: string
  minPrice: string
  maxPrice: string
  houseTypes: string
  cmpetRate: string
  typeDetails?: TypeDetail[]
}

type HouseTypeRate = {
  type: string
  rate: string
  reqCnt: string
  suply: string
  rank: string
  reside: string
  spsply?: Record<string, string>
}

type SpecialSupplyCategory = {
  name: string
  suply: number
  areaData?: { 해당: number; 기타경기: number; 기타지역: number }
  instData?: { 결정: number; 미결: number }
}

type SpecialSupplyHouseType = {
  type: string
  typeLabel: string
  spsplyHshldco: number
  categories: SpecialSupplyCategory[]
}

type SpecialSupplyItem = {
  pblancNo: string
  houseName: string
  region: string
  rceptBgnde: string
  rceptEndde: string
  subscrptResultNm: string
  houseTypes: SpecialSupplyHouseType[]
}

type CompetitionItem = {
  pblancNo: string
  houseName: string
  region: string
  rceptBgnde: string
  rceptEndde: string
  houseTypes: HouseTypeRate[]
}

// ===================== CONSTANTS =====================
const REGIONS = ['전체', '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
const STATUSES = ['전체', '접수예정', '접수중', '접수마감']

const STATUS_STYLE: Record<string, string> = {
  '접수예정': 'bg-blue-100 text-blue-700',
  '접수중': 'bg-green-100 text-green-700',
  '접수마감': 'bg-gray-100 text-gray-500',
}
const STATUS_DOT: Record<string, string> = {
  '접수예정': 'bg-blue-500',
  '접수중': 'bg-green-500',
  '접수마감': 'bg-gray-400',
}

// ===================== UTILS =====================
function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  const s = dateStr.replace(/-/g, '')
  if (s.length !== 8) return dateStr
  const y = parseInt(s.slice(0, 4))
  const m = parseInt(s.slice(4, 6))
  const d = parseInt(s.slice(6, 8))
  const date = new Date(y, m - 1, d)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${m}월 ${d}일(${days[date.getDay()]})`
}

function formatPrice(price: string): string {
  if (!price) return ''
  const num = parseInt(price)
  if (isNaN(num)) return price
  if (num >= 10000) return `${(num / 10000).toFixed(1)}억`
  return `${num.toLocaleString()}만원`
}

function extractAddressWithNumber(addr: string): string {
  // 번지가 있는 정확한 주소만 반환. 번지 없으면 빈 문자열.
  if (!addr) return ''
  // 괄호 이하 제거
  let s = addr.replace(/\(.*?\)/g, '').trim()
  // "일대", "일원", "외 N필지" 제거
  s = s.replace(/\s*일\s*[대원].*$/g, '').trim()
  s = s.replace(/\s*외\s*\d+\s*필지.*$/g, '').trim()
  // 동/읍/면/가/로/길 뒤에 번지(숫자 또는 숫자-숫자)가 있어야만 매치
  const m = s.match(/^(.+?(?:동|읍|면|리|가|로|길)\s*\d+(?:-\d+)?)/)
  if (m) return m[1].trim()
  return ''  // 번지 없으면 빈 문자열
}

function getMapSearchQuery(address: string, name: string): string {
  // 1순위: 번지가 있는 정확한 주소
  const withNumber = extractAddressWithNumber(address)
  if (withNumber) return withNumber
  // 2순위: 단지명
  return name
}

function formatMoveIn(ym: string): string {
  if (!ym || ym.length < 6) return '-'
  return `${ym.substring(0, 4)}년 ${parseInt(ym.substring(4, 6))}월`
}

function formatHouseType(typeStr: string): string {
  return typeStr.trim().replace(/^0*(\d+)\.?\d*([A-Za-z]*)$/, (_, _num, suffix) => {
    return Math.floor(parseFloat(typeStr.trim())) + suffix.toUpperCase()
  })
}

function formatRate(rate: string): { label: string; isDeficit: boolean } {
  if (!rate) return { label: '-', isDeficit: false }
  const isDeficit = rate.includes('△')
  if (rate === '-') return { label: '-', isDeficit: false }
  return {
    label: isDeficit ? `미달 ${rate}` : `${rate} : 1`,
    isDeficit,
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function getRecent1YearRange(baseDate = new Date()) {
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth() + 1

  let fromYear = year
  let fromMonth = month + 1

  if (fromMonth === 13) {
    fromYear += 1
    fromMonth = 1
  }

  fromYear -= 1

  return {
    from: `${fromYear}-${pad2(fromMonth)}`,
    to: `${year}-${pad2(month)}`,
    key: 'recent1y',
  }
}

function getYearRange(year: number) {
  return {
    from: `${year}-01`,
    to: `${year}-12`,
    key: String(year),
  }
}

function getFixedYearButtons() {
  return [2021, 2022, 2023, 2024, 2025, 2026]
}

function formatYm(ym: string) {
  if (!ym) return '-'
  const [y, m] = ym.split('-')
  if (!y || !m) return ym
  return `${y}년 ${m}월`
}

// 순위별 공급 합계 계산 시,
// 같은 주택형이 해당지역/기타지역으로 나뉘어 있어도 공급은 1번만 합산
function getUniqueSupplyByRank(rows: HouseTypeRate[]) {
  const supplyMap = new Map<string, number>()

  rows.forEach((h) => {
    const typeKey = formatHouseType(h.type)
    const supply = parseInt(h.suply || '0', 10)

    if (!supplyMap.has(typeKey)) {
      supplyMap.set(typeKey, supply)
    }
  })

  return Array.from(supplyMap.values()).reduce((sum, value) => sum + value, 0)
}

// ===================== 청약공고 카드 =====================
function ApartmentCard({ item }: { item: ApartmentItem }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 card-hover flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">{item.type}</span>
          <span className={`status-badge ${STATUS_STYLE[item.status]}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${STATUS_DOT[item.status]}`} />
            {item.status}
          </span>
        </div>
        <span className="text-xs text-gray-400">공고일: {formatDate(item.pblancDe)}</span>
      </div>

      <div>
        <h3 className="font-bold text-gray-900 text-base leading-snug">{item.name}</h3>
        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
          <span className="text-red-400">📍</span>{item.address}
        </p>
        {item.constructor && (
          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
            <span>🏗</span> {item.constructor}
          </p>
        )}
      </div>

      {item.houseTypes && (
        <div className="flex flex-wrap gap-1">
          {item.houseTypes.split(',').map((t, i) => (
            <span key={i} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
              {formatHouseType(t)}㎡
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-gray-50 pt-3 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">공급규모</span>
          <span className="font-semibold text-gray-800">{parseInt(item.totalUnits).toLocaleString()}세대</span>
        </div>
        {(item.minPrice || item.maxPrice) && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">분양가</span>
            <span className="font-semibold text-orange-600">
              {item.minPrice && item.maxPrice
                ? `${formatPrice(item.minPrice)} ~ ${formatPrice(item.maxPrice)}`
                : formatPrice(item.minPrice || item.maxPrice)}
            </span>
          </div>
        )}
        {item.typeDetails && item.typeDetails.length > 0 && (
          <div className="bg-gray-50 rounded-lg px-3 py-2 mt-1">
            <p className="text-xs text-gray-500 mb-1.5">📐 주택형별 (청약홈 최고가 기준)</p>
            <div className="space-y-1">
              {item.typeDetails.map((d, i) => (
                <div key={i} className="flex items-center justify-between gap-1 text-xs">
                  <span className="font-semibold text-blue-600 shrink-0">{d.typeLabel}㎡</span>
                  <span className="text-gray-600 shrink-0">{d.pyeong.toFixed(2)}평형</span>
                  <span className="text-orange-600 font-semibold shrink-0">
                    최고가 {formatPrice(String(d.topAmount))}
                  </span>
                  {d.pyeongPrice > 0 && (
                    <span className="text-gray-500 shrink-0">
                      ({d.pyeongPrice.toLocaleString()}만/평)
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">접수기간</span>
          <span className="font-semibold text-blue-600">{formatDate(item.rceptBgnde)} ~ {formatDate(item.rceptEndde)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">당첨자발표</span>
          <span className="font-semibold text-red-500">{formatDate(item.przwnerPresnatnDe)}</span>
        </div>
        {item.moveInDate && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">입주예정</span>
            <span className="font-semibold text-purple-600">{formatMoveIn(item.moveInDate)}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1">
        <a
          href={`https://map.naver.com/p/search/${encodeURIComponent(getMapSearchQuery(item.address, item.name))}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 rounded-xl py-2 hover:bg-gray-50 transition-colors shadow-sm"
          title={`네이버 지도 - ${getMapSearchQuery(item.address, item.name)}`}
        >
          <img
            src="/naver-map-logo.png"
            alt="네이버 지도"
            className="w-5 h-5 object-contain"
          />
          <span className="text-xs font-semibold text-gray-700">네이버지도</span>
        </a>

        <a
          href={item.pdfUrl || 'https://www.applyhome.co.kr'}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 rounded-xl py-2 hover:bg-gray-50 transition-colors shadow-sm"
          title="모집공고"
        >
          <img
            src="/applyhome-logo.png"
            alt="모집공고"
            className="w-5 h-5 object-contain"
          />
          <span className="text-xs font-semibold text-gray-700">모집공고</span>
        </a>

        <a
          href={item.hompageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center text-xs font-semibold bg-gray-900 text-white rounded-xl py-2 hover:bg-gray-700 transition-colors"
        >
          공식홈페이지
        </a>
      </div>
    </div>
  )
}

// ===================== 경쟁률 카드 =====================
function CompetitionCard({ item, specialSupply }: { item: CompetitionItem; specialSupply: SpecialSupplyItem | null }) {

  // 1순위 전체 평균 경쟁률 = 총 1순위 신청건수 / 총 1순위 공급세대수
  // 공급세대수는 주택형별로 1개만 카운트 (해당/기타가 중복되므로)
  const rank1Items = item.houseTypes.filter((h) => h.rank === '1')
  const rank1TotalReqCnt = rank1Items.reduce(
    (sum, h) => sum + parseInt(h.reqCnt || '0', 10),
    0
  )
  // 주택형별 공급세대수 (중복 제거)
  const suplyByType: Record<string, number> = {}
  rank1Items.forEach((h) => {
    const key = h.type.trim()
    if (!(key in suplyByType)) {
      suplyByType[key] = parseInt(h.suply || '0', 10)
    }
  })
  const rank1TotalSuply = Object.values(suplyByType).reduce((sum, n) => sum + n, 0)
  const avgRate = rank1TotalSuply > 0
    ? Math.round((rank1TotalReqCnt / rank1TotalSuply) * 100) / 100
    : 0

  const rank1Rows = item.houseTypes.filter((h) => h.rank === '1')
  const rank1TotalReq = rank1Rows.reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)
  const rank1LocalReq = rank1Rows
    .filter((h) => h.reside === '해당지역')
    .reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)
  const rank1EtcReq = rank1Rows
    .filter((h) => h.reside !== '해당지역')
    .reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)
  const rank1Supply = getUniqueSupplyByRank(rank1Rows)

  const rank2Rows = item.houseTypes.filter((h) => h.rank === '2')
  const rank2TotalReq = rank2Rows.reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)
  const rank2LocalReq = rank2Rows
    .filter((h) => h.reside === '해당지역')
    .reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)
  const rank2EtcReq = rank2Rows
    .filter((h) => h.reside !== '해당지역')
    .reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)
  const rank2Supply = getUniqueSupplyByRank(rank2Rows)

  // ===== 특공 합계 (special-supply API 사용 - [금주 접수현황]과 100% 동일 로직) =====
  // 일반 6분류: 해당+기타경기+기타지역 합산
  // 기관추천/이전기관: 결정 건수만 합산 (미결 제외)
  let specialTotalReq = 0
  let specialTotalSupply = 0

  if (specialSupply && specialSupply.houseTypes.length > 0) {
    specialSupply.houseTypes.forEach((ht) => {
      ht.categories.forEach((cat) => {
        specialTotalSupply += cat.suply
        if (cat.areaData) {
          // 일반 6분류 (다자녀/신혼부부/생애최초/노부모/신생아/청년)
          specialTotalReq += cat.areaData.해당 + cat.areaData.기타경기 + cat.areaData.기타지역
        } else if (cat.instData) {
          // 기관추천/이전기관 - 결정 건수만 합산
          specialTotalReq += cat.instData.결정
        }
      })
    })
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 card-hover flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">APT</span>
        {(item.rceptBgnde || item.rceptEndde) && (
          <span className="text-xs text-gray-400">
            {formatDate(item.rceptBgnde)} ~ {formatDate(item.rceptEndde)}
          </span>
        )}
      </div>

      <div>
        <h3 className="font-bold text-gray-900 text-base leading-snug">{item.houseName}</h3>
      </div>

      <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 space-y-1.5 leading-relaxed">
        <div>
          특공 (공급 {specialTotalSupply.toLocaleString()}){' '}
          <span className="font-bold text-blue-600">{specialTotalReq.toLocaleString()}건</span>
          <span className="ml-1">접수</span>
        </div>

        <div>
          1순위 (공급 {rank1Supply.toLocaleString()}){' '}
          <span className="font-bold text-red-500">{rank1TotalReq.toLocaleString()}건</span>
          <span className="ml-1">접수</span>
        </div>

        <div className="text-gray-500 text-xs">
          -해당: {rank1LocalReq.toLocaleString()}건 / 기타: {rank1EtcReq.toLocaleString()}건
        </div>

        <div>
          2순위 {' '}
          <span className="font-bold text-purple-600">{rank2TotalReq.toLocaleString()}건</span>
          <span className="ml-1">접수</span>
        </div>

        <div className="text-gray-500 text-xs">
          -해당: {rank2LocalReq.toLocaleString()}건 / 기타: {rank2EtcReq.toLocaleString()}건
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
        <span className="text-red-400">📍</span>
        {item.region}
      </p>

      {rank1TotalSuply > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">1순위 평균경쟁률</span>
          <span
            className={`text-sm font-bold px-2 py-0.5 rounded-full ${
              avgRate >= 10
                ? 'bg-red-100 text-red-600'
                : avgRate >= 1
                  ? 'bg-orange-100 text-orange-600'
                  : avgRate > 0
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-500'
            }`}
          >
            {avgRate.toFixed(2)} : 1
          </span>
          {avgRate < 1 && avgRate > 0 && (
            <span className="text-xs text-gray-400">(미달)</span>
          )}
          {avgRate === 0 && (
            <span className="text-xs text-gray-400">(미달)</span>
          )}
        </div>
      )}


      {/* 하단 버튼: 네이버지도 + 청약홈 상세 */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
        <a
          href={`https://map.naver.com/p/search/${encodeURIComponent(item.houseName)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 rounded-xl py-2 hover:bg-gray-50 transition-colors shadow-sm"
          title={`네이버 지도 - ${item.houseName}`}
        >
          <img src="/naver-map-logo.png" alt="네이버 지도" className="w-5 h-5 object-contain" />
          <span className="text-xs font-semibold text-gray-700">네이버지도</span>
        </a>
        <a
          href={`https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancDetail.do?houseManageNo=${item.pblancNo}&pblancNo=${item.pblancNo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 rounded-xl py-2 hover:bg-gray-50 transition-colors shadow-sm"
          title="청약홈 상세정보 (분양가, 공고문 확인)"
        >
          <img src="/applyhome-logo.png" alt="청약홈" className="w-5 h-5 object-contain" />
          <span className="text-xs font-semibold text-gray-700">청약홈 상세</span>
        </a>
      </div>

    </div>
  )
}

// ===================== 스켈레톤 =====================
// ===================== 금주 접수현황 헬퍼 =====================
function getThisWeekRange(): { start: Date; end: Date } {
  const now = new Date()
  const day = now.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { start: monday, end: sunday }
}

function isThisWeekRecept(rceptBgnde: string, rceptEndde: string): boolean {
  if (!rceptBgnde || !rceptEndde) return false
  const { start, end } = getThisWeekRange()
  const startDate = new Date(rceptBgnde)
  const endDate = new Date(rceptEndde)
  return startDate <= end && endDate >= start
}

function isLiveTime(): boolean {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const totalMin = now.getHours() * 60 + now.getMinutes()
  return totalMin >= 19 * 60 + 30 && totalMin <= 21 * 60
}

// ===================== 금주 접수현황 카드 =====================
function ThisWeekCard({
  notice,
  specialSupply,
  competition,
}: {
  notice: ApartmentItem
  specialSupply: SpecialSupplyItem | null
  competition: CompetitionItem | null
}) {
  const hasSpsplyData = specialSupply && specialSupply.houseTypes.length > 0
  const spsplyResultName = specialSupply?.subscrptResultNm || ''

  // 1순위 데이터 가공: 주택형별로 해당지역/기타지역 신청건수 집계 + 경쟁률 계산
  const rank1ByType = (() => {
    if (!competition) return [] as Array<{
      type: string
      typeLabel: string
      suply: number
      local: number
      etc: number
      total: number
      rate: number
    }>
    const rank1 = competition.houseTypes.filter((h) => h.rank === '1')
    if (rank1.length === 0) return []

    const map = new Map<string, {
      type: string
      typeLabel: string
      suply: number
      local: number
      etc: number
    }>()

    rank1.forEach((h) => {
      const key = (h.type || '').trim()
      if (!key) return
      const typeLabel = key.replace(/^0*(\d+)\.?\d*([A-Za-z]*)$/, () => {
        const n = parseFloat(key)
        const suffix = key.match(/[A-Za-z]+$/)?.[0] || ''
        return Math.floor(n) + suffix.toUpperCase()
      })
      const reqCnt = parseInt(h.reqCnt || '0', 10)
      const suply = parseInt(h.suply || '0', 10)
      const isLocal = h.reside === '해당지역'

      if (!map.has(key)) {
        map.set(key, { type: key, typeLabel, suply, local: 0, etc: 0 })
      }
      const entry = map.get(key)!
      // 공급세대는 주택형당 1번만 (해당/기타로 행이 분리되므로 더 큰 값 유지)
      if (suply > entry.suply) entry.suply = suply
      if (isLocal) entry.local += reqCnt
      else entry.etc += reqCnt
    })

    return Array.from(map.values())
      .sort((a, b) => a.type.localeCompare(b.type))
      .map((e) => {
        const total = e.local + e.etc
        const rate = e.suply > 0 ? Math.round((total / e.suply) * 100) / 100 : 0
        return { ...e, total, rate }
      })
  })()

  const hasRank1Data = rank1ByType.length > 0

  // 1순위 합계 행
  const rank1TotalSuply = rank1ByType.reduce((s, r) => s + r.suply, 0)
  const rank1TotalLocal = rank1ByType.reduce((s, r) => s + r.local, 0)
  const rank1TotalEtc = rank1ByType.reduce((s, r) => s + r.etc, 0)
  const rank1GrandTotal = rank1TotalLocal + rank1TotalEtc
  const rank1AvgRate = rank1TotalSuply > 0
    ? Math.round((rank1GrandTotal / rank1TotalSuply) * 100) / 100
    : 0

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 card-hover">
      {/* 상단 영역 - 단지 정보 + 상태 박스 (가로 분할) */}
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 mb-4">
        {/* 왼쪽: 단지 기본정보 */}
        <div className="lg:w-80 flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">APT</span>
          <span className={`status-badge ${STATUS_STYLE[notice.status]}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${STATUS_DOT[notice.status]}`} />
            {notice.status}
          </span>
        </div>
        <span className="text-xs text-gray-400">
          {formatDate(notice.rceptBgnde)} ~ {formatDate(notice.rceptEndde)}
        </span>
      </div>

      {/* 단지명 */}
      <div>
        <h3 className="font-bold text-gray-900 text-base leading-snug">{notice.name}</h3>
        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
          <span className="text-red-400">📍</span>{notice.region}
        </p>
      </div>
        </div>{/* 왼쪽 컬럼 끝 */}

        {/* 오른쪽: 상태 박스 + 특별공급 표 */}
        <div className="flex-1 flex flex-col gap-3">

      {/* 상태 박스 */}
      <div>
        {!hasSpsplyData && (
          <div className="bg-blue-50 rounded-xl p-3 text-center">
            <p className="text-sm font-semibold text-blue-700">⏳ 데이터 대기 중</p>
            <p className="text-xs text-blue-600 mt-1">접수 후 결과 동기화</p>
            {notice.przwnerPresnatnDe && (
              <p className="text-xs text-gray-500 mt-2">
                예정 발표일: {formatDate(notice.przwnerPresnatnDe)} (저녁 7:30)
              </p>
            )}
          </div>
        )}
        {hasSpsplyData && (
          <div className="bg-emerald-50 rounded-xl p-3 text-center">
            <p className="text-sm font-semibold text-emerald-700">✅ 특별공급 접수 결과</p>
            <p className="text-xs text-emerald-600 mt-1">{spsplyResultName || '데이터 수신됨'}</p>
          </div>
        )}
      </div>

      {/* 특별공급 신청현황 - 가로 풀폭 표 */}
      {hasSpsplyData && specialSupply && (
        <div>
          <p className="text-xs font-semibold text-blue-600 mb-2">🎯 특별공급 청약접수 현황 (청약홈 동일)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-blue-50 text-gray-700">
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold" rowSpan={2}>주택형</th>
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold" rowSpan={2}>공급<br/>세대</th>
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold" rowSpan={2}>구분</th>
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold" colSpan={8}>특별공급 구분</th>
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold" rowSpan={2}>총<br/>접수</th>
                </tr>
                <tr className="bg-blue-50 text-gray-600">
                  <th className="border border-blue-100 px-1 py-1 font-medium">다자녀</th>
                  <th className="border border-blue-100 px-1 py-1 font-medium">신혼<br/>부부</th>
                  <th className="border border-blue-100 px-1 py-1 font-medium">생애<br/>최초</th>
                  <th className="border border-blue-100 px-1 py-1 font-medium">노부모</th>
                  <th className="border border-blue-100 px-1 py-1 font-medium">신생아</th>
                  <th className="border border-blue-100 px-1 py-1 font-medium">청년</th>
                  <th className="border border-blue-100 px-1 py-1 font-medium">기관<br/>추천</th>
                  <th className="border border-blue-100 px-1 py-1 font-medium">이전<br/>기관</th>
                </tr>
              </thead>
              <tbody>
                {specialSupply.houseTypes.flatMap((ht) => {
                  // 카테고리별 데이터를 8개 컬럼으로 매핑
                  const order = ['다자녀', '신혼부부', '생애최초', '노부모', '신생아', '청년', '기관추천', '이전기관']
                  const findCat = (name: string) => ht.categories.find(c => c.name === name)
                  // 배정세대수 행
                  const assignedRow = order.map(name => {
                    const cat = findCat(name)
                    return cat ? cat.suply : 0
                  })
                  // 접수건수 행
                  const receivedRow = order.map(name => {
                    const cat = findCat(name)
                    if (!cat) return 0
                    if (cat.areaData) {
                      return cat.areaData.해당 + cat.areaData.기타경기 + cat.areaData.기타지역
                    }
                    if (cat.instData) {
                      return cat.instData.결정
                    }
                    return 0
                  })
                  const totalReceived = receivedRow.reduce((s, n) => s + n, 0)

                  return [
                    <tr key={`${ht.type}-1`} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-1.5 py-1.5 text-center font-semibold text-blue-700" rowSpan={2}>
                          {ht.typeLabel}㎡
                        </td>
                        <td className="border border-gray-200 px-1.5 py-1.5 text-center text-gray-600" rowSpan={2}>
                          {ht.spsplyHshldco}
                        </td>
                        <td className="border border-gray-200 px-1 py-1 text-center text-gray-500 text-[9px]">배정</td>
                        {assignedRow.map((val, i) => (
                          <td key={i} className="border border-gray-200 px-0.5 py-1 text-center text-gray-600">{val || '-'}</td>
                        ))}
                        <td className="border border-gray-200 px-1.5 py-1.5 text-center font-bold text-orange-600" rowSpan={2}>
                          {totalReceived}
                        </td>
                      </tr>,
                    <tr key={`${ht.type}-2`} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-1 py-1 text-center text-gray-700 text-[9px] font-semibold bg-blue-50">접수</td>
                        {receivedRow.map((val, i) => (
                          <td key={i} className={`border border-gray-200 px-0.5 py-1 text-center font-semibold ${val > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                            {val || '-'}
                          </td>
                        ))}
                      </tr>
                  ]
                })}
                {/* ===== 합계 행 (전체 주택형 카테고리별 접수건수 총합) ===== */}
                {(() => {
                  const order = ['다자녀', '신혼부부', '생애최초', '노부모', '신생아', '청년', '기관추천', '이전기관']
                  const totalSupply = specialSupply.houseTypes.reduce((sum, ht) => sum + ht.spsplyHshldco, 0)
                  const categoryTotals = order.map(name => {
                    return specialSupply.houseTypes.reduce((sum, ht) => {
                      const cat = ht.categories.find(c => c.name === name)
                      if (!cat) return sum
                      if (cat.areaData) {
                        return sum + cat.areaData.해당 + cat.areaData.기타경기 + cat.areaData.기타지역
                      }
                      if (cat.instData) {
                        return sum + cat.instData.결정
                      }
                      return sum
                    }, 0)
                  })
                  const grandTotal = categoryTotals.reduce((s, n) => s + n, 0)

                  return (
                    <tr className="bg-amber-50 border-t-2 border-amber-300">
                      <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">
                        합계
                      </td>
                      <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">
                        {totalSupply}
                      </td>
                      <td className="border border-amber-200 px-1 py-1.5 text-center font-bold text-amber-800 text-[9px]">
                        접수
                      </td>
                      {categoryTotals.map((val, i) => (
                        <td
                          key={i}
                          className={`border border-amber-200 px-0.5 py-1.5 text-center font-bold ${val > 0 ? 'text-red-600' : 'text-gray-400'}`}
                        >
                          {val || '-'}
                        </td>
                      ))}
                      <td className="border border-amber-200 px-1.5 py-1.5 text-center font-extrabold text-red-700 text-[12px] bg-red-50">
                        {grandTotal}
                      </td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            ※ 접수 = 해당지역+기타경기+기타지역 합계 / 기관추천·이전기관: 결정수 기준
            <br />※ <span className="text-amber-700 font-semibold">합계 행</span>은 전체 주택형 카테고리별 접수건수의 총합입니다.
          </p>
        </div>
      )}

      {/* ===== 일반공급 1순위 청약접수 현황 ===== */}
      {hasRank1Data && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-rose-600 mb-2">📊 일반공급 1순위 청약접수 현황</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-rose-50 text-gray-700">
                  <th className="border border-rose-100 px-1.5 py-1.5 font-semibold">타입</th>
                  <th className="border border-rose-100 px-1.5 py-1.5 font-semibold">공급<br/>세대</th>
                  <th className="border border-rose-100 px-1.5 py-1.5 font-semibold">해당<br/>지역</th>
                  <th className="border border-rose-100 px-1.5 py-1.5 font-semibold">기타<br/>지역</th>
                  <th className="border border-rose-100 px-1.5 py-1.5 font-semibold">소계</th>
                  <th className="border border-rose-100 px-1.5 py-1.5 font-semibold">경쟁률</th>
                </tr>
              </thead>
              <tbody>
                {rank1ByType.map((r) => (
                  <tr key={r.type} className="hover:bg-gray-50">
                    <td className="border border-gray-200 px-1.5 py-1.5 text-center font-semibold text-rose-700">
                      {r.typeLabel}
                    </td>
                    <td className="border border-gray-200 px-1.5 py-1.5 text-center text-gray-700">
                      {r.suply.toLocaleString()}
                    </td>
                    <td className="border border-gray-200 px-1.5 py-1.5 text-center text-gray-700">
                      {r.local.toLocaleString()}
                    </td>
                    <td className="border border-gray-200 px-1.5 py-1.5 text-center text-gray-700">
                      {r.etc.toLocaleString()}
                    </td>
                    <td className={`border border-gray-200 px-1.5 py-1.5 text-center font-bold ${r.total > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {r.total.toLocaleString()}
                    </td>
                    <td className={`border border-gray-200 px-1.5 py-1.5 text-center font-semibold ${r.rate >= 1 ? 'text-rose-700' : 'text-gray-500'}`}>
                      {r.suply > 0
                        ? (r.rate < 1
                            ? `미달 (${r.rate.toFixed(2)})`
                            : `${r.rate.toFixed(2)} 대 1`)
                        : '-'}
                    </td>
                  </tr>
                ))}
                {/* 합계 행 */}
                <tr className="bg-amber-50 border-t-2 border-amber-300">
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">
                    계
                  </td>
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">
                    {rank1TotalSuply.toLocaleString()}
                  </td>
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">
                    {rank1TotalLocal.toLocaleString()}
                  </td>
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">
                    {rank1TotalEtc.toLocaleString()}
                  </td>
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-extrabold text-red-700 bg-red-50">
                    {rank1GrandTotal.toLocaleString()}
                  </td>
                  <td className={`border border-amber-200 px-1.5 py-1.5 text-center font-extrabold ${rank1AvgRate >= 1 ? 'text-rose-700' : 'text-gray-500'}`}>
                    {rank1TotalSuply > 0
                      ? (rank1AvgRate < 1
                          ? `미달 (${rank1AvgRate.toFixed(2)})`
                          : `${rank1AvgRate.toFixed(2)} 대 1`)
                      : '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            ※ 1순위 해당지역 + 기타지역 신청건수 기준 / 경쟁률 = 신청건수 ÷ 공급세대수
          </p>
        </div>
      )}

      {/* 1순위 데이터 대기 중 안내 (특공은 있으나 1순위 미발표) */}
      {hasSpsplyData && !hasRank1Data && (
        <div className="mt-4 bg-rose-50 rounded-xl p-3 text-center">
          <p className="text-sm font-semibold text-rose-700">⏳ 1순위 청약접수 결과 대기 중</p>
          <p className="text-xs text-rose-600 mt-1">접수 마감 후 익일 발표됩니다</p>
        </div>
      )}

        </div>{/* 오른쪽 컬럼 끝 */}
      </div>{/* 가로 분할 영역 끝 */}
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="flex gap-2">
          <div className="w-10 h-5 bg-gray-100 rounded" />
          <div className="w-16 h-5 bg-gray-100 rounded" />
        </div>
        <div className="w-20 h-4 bg-gray-100 rounded" />
      </div>
      <div className="w-3/4 h-5 bg-gray-100 rounded mb-2" />
      <div className="w-full h-3 bg-gray-100 rounded mb-4" />
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex justify-between">
            <div className="w-16 h-3 bg-gray-100 rounded" />
            <div className="w-24 h-3 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ===================== 메인 =====================
export default function Home() {
  const [activeTab, setActiveTab] = useState<'notice' | 'competition' | 'thisweek'>('notice')

  const [items, setItems] = useState<ApartmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isDummy, setIsDummy] = useState(false)
  const [selectedRegion, setSelectedRegion] = useState('전체')
  const [selectedStatus, setSelectedStatus] = useState('전체')

  const [cmpetItems, setCmpetItems] = useState<CompetitionItem[]>([])
  const [spsplyItems, setSpsplyItems] = useState<SpecialSupplyItem[]>([])
  const [spsplyLoading, setSpsplyLoading] = useState(false)
  const [cmpetLoading, setCmpetLoading] = useState(false)
  const [cmpetLoaded, setCmpetLoaded] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [cmpetRegion, setCmpetRegion] = useState('전체')

  const [periodKey, setPeriodKey] = useState('recent1y')
  const [yearMonthFrom, setYearMonthFrom] = useState('')
  const [yearMonthTo, setYearMonthTo] = useState('')

  // 금주 접수현황 탭 전용 필터
  const [thisWeekRegion, setThisWeekRegion] = useState('전체')
  const [thisWeekKeyword, setThisWeekKeyword] = useState('')
  const [thisWeekSearchInput, setThisWeekSearchInput] = useState('')

  const yearButtons = getFixedYearButtons()

  const fetchNotice = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/apartments?perPage=30')
      const data = await res.json()
      setItems(data.items || [])
      setIsDummy(data.isDummy || false)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSpecialSupply = useCallback(async (fresh = true) => {
    setSpsplyLoading(true)
    try {
      const params = new URLSearchParams()
      if (fresh) params.set('fresh', '1')
      const res = await fetch(`/api/special-supply?${params.toString()}`, { cache: 'no-store' })
      const data = await res.json()
      setSpsplyItems(data.items || [])
    } catch (e) {
      console.error('special-supply fetch error:', e)
    } finally {
      setSpsplyLoading(false)
    }
  }, [])

  const fetchCompetition = useCallback(async (kw = '', region = '전체', ymFrom = '', ymTo = '') => {
    setCmpetLoading(true)
    try {
      const params = new URLSearchParams()
      if (kw) params.set('keyword', kw)
      if (region !== '전체') params.set('region', region)
      if (ymFrom) params.set('yearMonthFrom', ymFrom)
      if (ymTo) params.set('yearMonthTo', ymTo)

      const res = await fetch(`/api/competition?${params.toString()}`)
      const data = await res.json()
      setCmpetItems(data.items || [])
      setCmpetLoaded(true)
    } catch (e) {
      console.error(e)
    } finally {
      setCmpetLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNotice()
  }, [fetchNotice])

  useEffect(() => {
    const range = getRecent1YearRange(new Date())
    setPeriodKey(range.key)
    setYearMonthFrom(range.from)
    setYearMonthTo(range.to)
    // 앱 시작 시 경쟁률 데이터 백그라운드 프리페치 (탭 클릭 전에 미리 로딩)
    setTimeout(() => {
      fetchCompetition('', '전체', range.from, range.to)
    }, 2000)
  }, [])

  useEffect(() => {
    // 프리페치가 실패했거나 아직 안 됐을 때 보험용
    if (activeTab === 'competition' && !cmpetLoaded && yearMonthFrom && yearMonthTo) {
      fetchCompetition('', '전체', yearMonthFrom, yearMonthTo)
    }
    // 경쟁률 카드의 특공 데이터 통일을 위해 special-supply도 함께 로드
    if (activeTab === 'competition' && spsplyItems.length === 0) {
      fetchSpecialSupply(false)
    }
  }, [activeTab, cmpetLoaded, fetchCompetition, yearMonthFrom, yearMonthTo, fetchSpecialSupply, spsplyItems.length])

  // 금주 접수현황 탭 - 진입 시 청약공고 + 특별공급 + 1순위 경쟁률 fresh 호출
  useEffect(() => {
    if (activeTab !== 'thisweek') return
    fetchNotice()
    fetchSpecialSupply(true)
    // 1순위 데이터는 최근 1년 범위로 fresh 호출 (발표 직후엔 캐시 무력화)
    const range = getRecent1YearRange(new Date())
    fetchCompetition('', '전체', range.from, range.to)
  }, [activeTab, fetchNotice, fetchSpecialSupply, fetchCompetition])

  // 발표 시간대(평일 19:30~21:00)엔 30초마다 자동 새로고침
  useEffect(() => {
    if (activeTab !== 'thisweek') return
    if (!isLiveTime()) return

    const interval = setInterval(() => {
      fetchNotice()
      fetchSpecialSupply(true)
      const range = getRecent1YearRange(new Date())
      fetchCompetition('', '전체', range.from, range.to)
    }, 30000)

    return () => clearInterval(interval)
  }, [activeTab, fetchNotice, fetchSpecialSupply, fetchCompetition])

  const filteredNotice = items.filter(item => {
    const regionMatch = selectedRegion === '전체' || item.region === selectedRegion
    const statusMatch = selectedStatus === '전체' || item.status === selectedStatus
    return regionMatch && statusMatch
  })

  const filteredCmpet = cmpetItems.filter(item => {
    const regionMatch = cmpetRegion === '전체' || item.region === cmpetRegion
    const kwMatch = !keyword || item.houseName.includes(keyword)
    return regionMatch && kwMatch
  })

  return (
    <main className="min-h-screen pb-16" style={{ backgroundColor: "#03053E" }}>
      <header className="sticky top-0 z-10 shadow-lg" style={{ backgroundColor: "#03053E", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="max-w-5xl mx-auto px-4 py-4 relative">
          <div className="flex items-center justify-center gap-3">
            <img src="/icon.ico" alt="청약홈" className="w-10 h-10 object-contain" />
            <span className="font-extrabold text-2xl md:text-3xl text-white">청약홈 요약</span>
          </div>

          <button
            onClick={() => activeTab === 'notice' ? fetchNotice() : fetchCompetition(keyword, cmpetRegion, yearMonthFrom, yearMonthTo)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-blue-300 hover:text-white font-medium flex items-center gap-1"
          >
            🔄 새로고침
          </button>
        </div>

        <div className="max-w-5xl mx-auto px-4 flex gap-0 border-t border-gray-100">
          <button
            onClick={() => setActiveTab('notice')}
            className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'notice' ? 'border-blue-400 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            📋 청약공고
          </button>
          <button
            onClick={() => setActiveTab('competition')}
            className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'competition' ? 'border-blue-400 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            📊 경쟁률 조회
          </button>
          <button
            onClick={() => setActiveTab('thisweek')}
            className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'thisweek' ? 'border-blue-400 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            📅 금주 접수현황
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 pt-6">
        <div className="text-center mb-6">
          <p className="text-blue-100 text-sm">복잡한 아파트 청약 공고, 요약된 정보로 쉽고 빠르게 확인하세요.</p>
          {isDummy && activeTab === 'notice' && (
            <div className="mt-2 inline-block bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1.5 rounded-full">
              ⚠️ 현재 샘플 데이터입니다. Vercel 환경변수에 API_KEY를 설정하면 실시간 데이터가 표시됩니다.
            </div>
          )}
        </div>

        {activeTab === 'notice' && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6 space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">📍 지역 필터</p>
                <div className="grid grid-cols-5 sm:flex sm:flex-wrap gap-1.5 sm:gap-2">
                  {REGIONS.map(r => (
                    <button key={r} onClick={() => setSelectedRegion(r)} className={`filter-btn text-xs sm:text-sm px-2 sm:px-3 py-1.5 ${selectedRegion === r ? 'filter-btn-active' : 'filter-btn-inactive'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">📋 진행 상태</p>
                <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-1.5 sm:gap-2">
                  {STATUSES.map(s => (
                    <button key={s} onClick={() => setSelectedStatus(s)} className={`filter-btn text-xs sm:text-sm px-2 sm:px-3 py-1.5 ${selectedStatus === s ? 'filter-btn-active' : 'filter-btn-inactive'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-sm text-blue-100 mb-4">
              총 <span className="font-bold text-blue-600">{filteredNotice.length}건</span>의 청약 공고
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {loading
                ? Array(6).fill(0).map((_, i) => <SkeletonCard key={i} />)
                : filteredNotice.length > 0
                  ? filteredNotice.map(item => <ApartmentCard key={item.id} item={item} />)
                  : (
                    <div className="col-span-3 text-center py-16 text-gray-400">
                      <div className="text-4xl mb-3">🔍</div>
                      <p>해당 조건의 청약 공고가 없습니다.</p>
                    </div>
                  )}
            </div>
          </>
        )}

        {activeTab === 'competition' && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6 space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      setKeyword(searchInput)
                      fetchCompetition(searchInput, cmpetRegion, yearMonthFrom, yearMonthTo)
                    }
                  }}
                  placeholder="단지명 검색 (예: 래미안, 힐스테이트...)"
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
                <button
                  onClick={() => {
                    setKeyword(searchInput)
                    fetchCompetition(searchInput, cmpetRegion, yearMonthFrom, yearMonthTo)
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  검색
                </button>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">📍 지역 필터</p>
                <div className="grid grid-cols-5 sm:flex sm:flex-wrap gap-1.5 sm:gap-2">
                  {REGIONS.map(r => (
                    <button
                      key={r}
                      onClick={() => {
                        setCmpetRegion(r)
                        fetchCompetition(keyword, r, yearMonthFrom, yearMonthTo)
                      }}
                      className={`filter-btn text-xs sm:text-sm px-2 sm:px-3 py-1.5 ${cmpetRegion === r ? 'filter-btn-active' : 'filter-btn-inactive'}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">🗓 기간 필터</p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  <button
                    onClick={() => {
                      const range = getRecent1YearRange(new Date())
                      setPeriodKey(range.key)
                      setYearMonthFrom(range.from)
                      setYearMonthTo(range.to)
                      fetchCompetition(keyword, cmpetRegion, range.from, range.to)
                    }}
                    className={`filter-btn text-sm px-3 py-1.5 ${periodKey === 'recent1y' ? 'filter-btn-active' : 'filter-btn-inactive'}`}
                  >
                    최근 1년
                  </button>

                  {yearButtons.map(year => {
                    const range = getYearRange(year)
                    return (
                      <button
                        key={year}
                        onClick={() => {
                          setPeriodKey(range.key)
                          setYearMonthFrom(range.from)
                          setYearMonthTo(range.to)
                          fetchCompetition(keyword, cmpetRegion, range.from, range.to)
                        }}
                        className={`filter-btn text-sm px-3 py-1.5 ${periodKey === range.key ? 'filter-btn-active' : 'filter-btn-inactive'}`}
                      >
                        {year}년
                      </button>
                    )
                  })}
                </div>

                <p className="text-xs text-gray-400 mt-2">
                  조회 범위: <span className="font-semibold text-gray-600">{formatYm(yearMonthFrom)}</span>
                  {' '}~{' '}
                  <span className="font-semibold text-gray-600">{formatYm(yearMonthTo)}</span>
                </p>
              </div>
            </div>

            <p className="text-sm text-blue-100 mb-4">
              총 <span className="font-bold text-blue-600">{filteredCmpet.length}건</span>의 경쟁률 데이터
              <span className="text-xs text-gray-400 ml-2">(1순위 해당지역 기준 / {formatYm(yearMonthFrom)} ~ {formatYm(yearMonthTo)})</span>
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cmpetLoading
                ? Array(6).fill(0).map((_, i) => <SkeletonCard key={i} />)
                : filteredCmpet.length > 0
                  ? filteredCmpet.map(item => {
                      const matchedSpsply = spsplyItems.find(s => String(s.pblancNo || '').trim() === String(item.pblancNo || '').trim()) || null
                      return <CompetitionCard key={item.pblancNo} item={item} specialSupply={matchedSpsply} />
                    })
                  : (
                    <div className="col-span-3 text-center py-16 text-gray-400">
                      <div className="text-4xl mb-3">📊</div>
                      <p>검색 결과가 없습니다.</p>
                    </div>
                  )}
            </div>
          </>
        )}

        {/* ===== 금주 접수현황 탭 ===== */}
        {activeTab === 'thisweek' && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6 space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-1">📅 이번 주 접수 단지</p>
                <p className="text-xs text-gray-500">
                  {(() => {
                    const { start, end } = getThisWeekRange()
                    return `${formatDate(start.toISOString().slice(0, 10))} ~ ${formatDate(end.toISOString().slice(0, 10))}`
                  })()}
                </p>
                {isLiveTime() && (
                  <div className="mt-2 inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-3 py-1 rounded-full">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                    <span className="text-xs font-bold text-rose-700">LIVE - 결과 발표 중</span>
                  </div>
                )}
              </div>

              {/* 단지명 검색 */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={thisWeekSearchInput}
                  onChange={e => setThisWeekSearchInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      setThisWeekKeyword(thisWeekSearchInput)
                    }
                  }}
                  placeholder="단지명 검색 (예: 래미안, 힐스테이트...)"
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
                <button
                  onClick={() => setThisWeekKeyword(thisWeekSearchInput)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  검색
                </button>
                {thisWeekKeyword && (
                  <button
                    onClick={() => {
                      setThisWeekKeyword('')
                      setThisWeekSearchInput('')
                    }}
                    className="bg-gray-100 text-gray-600 px-3 py-2 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
                    title="검색어 초기화"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* 지역 필터 */}
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">📍 지역 필터</p>
                <div className="grid grid-cols-5 sm:flex sm:flex-wrap gap-1.5 sm:gap-2">
                  {REGIONS.map(r => (
                    <button
                      key={r}
                      onClick={() => setThisWeekRegion(r)}
                      className={`filter-btn text-xs sm:text-sm px-2 sm:px-3 py-1.5 ${thisWeekRegion === r ? 'filter-btn-active' : 'filter-btn-inactive'}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {(() => {
              const thisWeekItems = items
                .filter(i => isThisWeekRecept(i.rceptBgnde, i.rceptEndde))
                .filter(i => thisWeekRegion === '전체' || i.region === thisWeekRegion)
                .filter(i => !thisWeekKeyword || i.name.includes(thisWeekKeyword))
              return (
                <>
                  <p className="text-sm text-blue-100 mb-4">
                    총 <span className="font-bold text-white">{thisWeekItems.length}건</span>의 단지
                    {(thisWeekKeyword || thisWeekRegion !== '전체') && (
                      <span className="text-xs text-blue-200/80 ml-2">
                        (
                        {thisWeekRegion !== '전체' && `지역: ${thisWeekRegion}`}
                        {thisWeekRegion !== '전체' && thisWeekKeyword && ' / '}
                        {thisWeekKeyword && `검색: ${thisWeekKeyword}`}
                        )
                      </span>
                    )}
                  </p>
                  <div className="flex flex-col gap-4">
                    {loading || spsplyLoading ? (
                      Array(3).fill(0).map((_, i) => <SkeletonCard key={i} />)
                    ) : thisWeekItems.length > 0 ? (
                      thisWeekItems.map(notice => {
                        const noticeKey = String(notice.id || '').trim()
                        const matched = spsplyItems.find(s => String(s.pblancNo || '').trim() === noticeKey) || null
                        const matchedCmpet = cmpetItems.find(c => String(c.pblancNo || '').trim() === noticeKey) || null
                        return <ThisWeekCard key={notice.id} notice={notice} specialSupply={matched} competition={matchedCmpet} />
                      })
                    ) : (
                      <div className="col-span-3 text-center py-16 text-gray-300">
                        <div className="text-4xl mb-3">📅</div>
                        <p>이번 주 접수 단지가 없습니다.</p>
                        {(thisWeekKeyword || thisWeekRegion !== '전체') && (
                          <p className="text-xs mt-2 text-gray-400">필터를 초기화해보세요.</p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </>
        )}
      </div>

      <footer className="mt-12 text-center text-xs text-blue-200/60">
        <p>데이터 출처: 공공데이터포털 청약홈 API</p>
        <p className="mt-1">
          <a href="https://www.applyhome.co.kr" target="_blank" rel="noopener noreferrer" className="hover:text-white">
            청약홈 바로가기 →
          </a>
        </p>
      </footer>
    </main>
  )
}