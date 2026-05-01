'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

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
  spsplyRceptBgnde?: string
  spsplyRceptEndde?: string
  rank1RceptBgnde?: string
  rank1RceptEndde?: string
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

// 청약홈 사이트 직접 조회 결과 (공공 API 폴백용)
type ApplyhomeRank1Type = {
  type: string
  typeLabel: string
  suply: number
  local: number
  etc: number
  total: number
  rate: number
}
type ApplyhomeCompetitionData = {
  ok: boolean
  pblancNo: string
  source: 'applyhome'
  fetchedAt: string
  rank1ByType: ApplyhomeRank1Type[]
  totalSuply: number
  totalLocal: number
  totalEtc: number
  totalAll: number
  error?: string
}

// ===================== CONSTANTS =====================
const REGIONS = ['전체', '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
const STATUSES = ['전체', '접수예정', '접수중']

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

// 짧은 형식: 4/27(월)
function formatShortDate(dateStr: string): string {
  if (!dateStr) return '-'
  const s = dateStr.replace(/-/g, '')
  if (s.length !== 8) return dateStr
  const y = parseInt(s.slice(0, 4))
  const m = parseInt(s.slice(4, 6))
  const d = parseInt(s.slice(6, 8))
  const date = new Date(y, m - 1, d)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${m}/${d}(${days[date.getDay()]})`
}

// 'YYYY-MM-DD' 또는 'YYYYMMDD'를 Date(00:00)로 변환. 실패 시 null
function parseDateOnly(dateStr: string): Date | null {
  if (!dateStr) return null
  const s = dateStr.replace(/-/g, '')
  if (s.length !== 8) return null
  const y = parseInt(s.slice(0, 4))
  const m = parseInt(s.slice(4, 6))
  const d = parseInt(s.slice(6, 8))
  const date = new Date(y, m - 1, d)
  if (isNaN(date.getTime())) return null
  return date
}

// 오늘 자정 기준 target까지 남은 일수. 음수면 이미 지남.
function daysUntil(target: string): number | null {
  const t = parseDateOnly(target)
  if (!t) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((t.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// D-day 라벨: 미래는 'D-N일', 오늘은 'D-DAY', 과거는 '마감'
function formatDday(target: string): string {
  const d = daysUntil(target)
  if (d === null) return ''
  if (d > 0) return `D-${d}일`
  if (d === 0) return 'D-DAY'
  return '마감'
}

// 특별공급 접수일 결정.
// 1) 서버가 SPSPLY_RCEPT_BGNDE를 줬으면 그대로 사용 (청약홈 공식 필드)
// 2) 없으면 RCEPT_BGNDE(전체 접수 시작일)로 폴백
function deriveSpsplyDate(item: { rceptBgnde: string; spsplyRceptBgnde?: string }): string {
  return item.spsplyRceptBgnde || item.rceptBgnde || ''
}

// 1순위 접수일 결정.
// 1) 서버가 GNRL_RNK1_*_RCPTDE를 줬으면 그대로 사용 (청약홈 공식 필드)
// 2) 없으면 특공일 + 1영업일(주말 건너뜀)로 폴백
//    한국 청약 관례: 특공이 금요일이면 1순위는 다음 월요일
function deriveRank1Date(item: {
  rceptBgnde: string
  spsplyRceptBgnde?: string
  rank1RceptBgnde?: string
}): string {
  if (item.rank1RceptBgnde) return item.rank1RceptBgnde
  const baseStr = item.spsplyRceptBgnde || item.rceptBgnde
  const base = parseDateOnly(baseStr)
  if (!base) return ''
  const next = new Date(base.getTime() + 24 * 60 * 60 * 1000)
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1)
  }
  const y = next.getFullYear()
  const m = String(next.getMonth() + 1).padStart(2, '0')
  const d = String(next.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

// 최근 1개월 기간 (지난달 + 이번달 = 약 30~60일치)
// 데이터 부담을 줄여 첫 화면 로딩을 가볍게 만들기 위함 (이전: 최근 1년 = recent1y)
// 예: 오늘이 2026-05-01이면 from=2026-04, to=2026-05
function getRecent1MonthRange(baseDate = new Date()) {
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth() + 1

  // 지난달 계산 (1월이면 작년 12월)
  const fromYear = month === 1 ? year - 1 : year
  const fromMonth = month === 1 ? 12 : month - 1

  return {
    from: `${fromYear}-${pad2(fromMonth)}`,
    to: `${year}-${pad2(month)}`,
    key: 'recent1m',
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
  // 최신 연도부터 표시 (2026 → 2021)
  // [1개월] [2026년] [2025년] [2024년] [2023년] [2022년] [2021년] 순으로 보여줌
  return [2026, 2025, 2024, 2023, 2022, 2021]
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
        {(() => {
          const spsplyDate = deriveSpsplyDate(item)
          const rank1Date = deriveRank1Date(item)
          const spsplyDday = formatDday(spsplyDate)
          const rank1Dday = formatDday(rank1Date)

          // D-day 배지 색상: D-DAY=빨강, 미래=파랑, 마감=회색
          const ddayClass = (label: string) => {
            if (!label) return ''
            if (label === 'D-DAY') return 'bg-red-100 text-red-600'
            if (label === '마감') return 'bg-gray-100 text-gray-500'
            return 'bg-blue-100 text-blue-700'
          }

          return (
            <>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">특별공급 접수</span>
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold text-blue-600">{formatDate(spsplyDate)}</span>
                  {spsplyDday && (
                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${ddayClass(spsplyDday)}`}>
                      {spsplyDday}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">1순위 접수</span>
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold text-blue-600">{formatDate(rank1Date)}</span>
                  {rank1Dday && (
                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${ddayClass(rank1Dday)}`}>
                      {rank1Dday}
                    </span>
                  )}
                </span>
              </div>
            </>
          )
        })()}
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

// 🔧 (2026-04-30) LIVE 기능 비활성화 - 30초 인터벌이 응답 누적으로 페이지를 느리게 만드는 문제 해결
// 영향: (1) 30초 자동 새로고침 중지 (2) 탭 진입 시 강제 fresh 호출 중지 (3) "LIVE - 결과 발표 중" 배지 숨김
// 청약홈 폴백은 정상 동작 유지 (이건 isLiveTime과 무관하게 카드별로 독립 호출됨)
// 필요 시 아래 return false를 원래 로직으로 되돌리면 LIVE 기능 복구
function isLiveTime(): boolean {
  return false
  // 원래 로직 (참고용 - 평일 19:30~21:00):
  // const now = new Date()
  // const day = now.getDay()
  // if (day === 0 || day === 6) return false
  // const totalMin = now.getHours() * 60 + now.getMinutes()
  // return totalMin >= 19 * 60 + 30 && totalMin <= 21 * 60
}

// 🏛️ (2026-04-30) LH/SH 등 공공기관 청약 사이트로 연결되는 단지 식별
// - hompageUrl이 공공기관 청약 사이트면 청약홈 1순위 경쟁률 미공개 가능성 큼
// - 폴백 호출 자체를 안 하고 "사업주체 미제공" 표시
// - 단, 시행자가 민간인 공공분양은 청약홈에 데이터 있을 수도 있음
//   → 이 케이스는 URL 필터 외에 값 필터(totalAll > 0)로 별도 처리
function isPublicHousing(hompageUrl: string | undefined | null): boolean {
  const url = (hompageUrl || '').toLowerCase()
  if (!url) return false
  return (
    url.includes('apply.lh.or.kr') ||  // LH 청약센터
    url.includes('apply.sh.co.kr') ||  // SH 청약센터
    url.includes('i-sh.co.kr') ||      // 인천도시공사
    url.includes('gico.or.kr') ||      // 경기주택도시공사
    url.includes('mgcorp.co.kr')       // 대구도시공사
  )
}

// ===== 접수현황 탭 기간 필터 =====
type PeriodKey = 'thisweek' | '3m' | '2026' | '2025' | '2024' | '2023' | '2022' | '2021'

const PERIOD_BUTTONS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'thisweek', label: '이번 주' },
  { key: '3m', label: '최근 3개월' },
  { key: '2026', label: '2026년' },
  { key: '2025', label: '2025년' },
  { key: '2024', label: '2024년' },
  { key: '2023', label: '2023년' },
  { key: '2022', label: '2022년' },
  { key: '2021', label: '2021년' },
]

function getPeriodRange(key: string): { start: Date; end: Date; label: string } {
  const now = new Date()

  if (key === 'thisweek') {
    const day = now.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    const monday = new Date(now)
    monday.setDate(now.getDate() + diffToMonday)
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)
    return { start: monday, end: sunday, label: '이번 주' }
  }

  if (key === '3m') {
    const start = new Date(now)
    start.setMonth(start.getMonth() - 3)
    start.setHours(0, 0, 0, 0)
    return { start, end: now, label: '최근 3개월' }
  }

  // 연도별 (2021~2026)
  const year = parseInt(key, 10)
  if (!isNaN(year) && year >= 2000) {
    const start = new Date(year, 0, 1, 0, 0, 0, 0)
    const end = new Date(year, 11, 31, 23, 59, 59, 999)
    return { start, end, label: `${year}년` }
  }

  // 기본값: 이번 주
  return getPeriodRange('thisweek')
}

function isInPeriod(rceptBgnde: string, rceptEndde: string, periodKey: string): boolean {
  if (!rceptBgnde && !rceptEndde) return false
  const { start, end } = getPeriodRange(periodKey)
  // 접수기간이 선택 범위와 겹치면 포함 (시작일 기준 매칭)
  const rs = rceptBgnde ? new Date(rceptBgnde) : null
  const re = rceptEndde ? new Date(rceptEndde) : rs
  if (!rs && !re) return false
  const startDate = rs || re!
  const endDate = re || rs!
  return startDate <= end && endDate >= start
}

// 기간 키 → fetchCompetition용 YYYY-MM 범위로 변환
// 1순위 경쟁률 API는 yearMonthFrom/yearMonthTo 파라미터를 받음
function getPeriodYmRange(periodKey: string): { from: string; to: string } {
  const { start, end } = getPeriodRange(periodKey)
  const fromY = start.getFullYear()
  const fromM = start.getMonth() + 1
  const toY = end.getFullYear()
  const toM = end.getMonth() + 1
  return {
    from: `${fromY}-${pad2(fromM)}`,
    to: `${toY}-${pad2(toM)}`,
  }
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

  // === 청약홈 직접 조회 폴백 (공공 API에 1순위 데이터 없을 때만 자동 호출) ===
  const [applyhomeData, setApplyhomeData] = useState<ApplyhomeCompetitionData | null>(null)
  const [applyhomeLoading, setApplyhomeLoading] = useState(false)

  // 캡처용 숨겨진 영역 ref
  const captureSpsplyRef = useRef<HTMLDivElement>(null)
  const captureRank1Ref = useRef<HTMLDivElement>(null)
  const [capturing, setCapturing] = useState<'spsply' | 'rank1' | null>(null)

  // 캡처 → 공유(Web Share API 우선) 또는 다운로드 fallback
  const downloadCapture = async (type: 'spsply' | 'rank1') => {
    const ref = type === 'spsply' ? captureSpsplyRef : captureRank1Ref
    if (!ref.current) return

    setCapturing(type)
    try {
      // html2canvas 동적 import (코드 분할 - 초기 로딩 영향 없음)
      const html2canvasModule = await import('html2canvas')
      const html2canvas = html2canvasModule.default

      // 캡처 대상 요소의 실제 크기 측정 (상단 잘림 방지)
      const target = ref.current
      const rect = target.getBoundingClientRect()
      const canvas = await html2canvas(target, {
        backgroundColor: '#ffffff',
        scale: 2, // 2배 해상도로 깔끔하게
        useCORS: true,
        logging: false,
        width: rect.width,
        height: rect.height,
        windowWidth: 800, // 캡처 영역(760px)보다 약간 크게 - 좌우 여유
        scrollX: 0,
        scrollY: 0,
      })

      // PNG Blob 생성
      const blob: Blob | null = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png')
      })
      if (!blob) {
        throw new Error('이미지 변환 실패')
      }

      // 파일명 구성
      const today = new Date()
      const yyyy = today.getFullYear()
      const mm = String(today.getMonth() + 1).padStart(2, '0')
      const dd = String(today.getDate()).padStart(2, '0')
      const dateStr = `${yyyy}-${mm}-${dd}`
      const cleanName = (notice.name || '단지').replace(/[\\/:*?"<>|]/g, '_')
      const typeLabel = type === 'spsply' ? '특공' : '1순위'
      const filename = `${cleanName}_${typeLabel}_${dateStr}.png`

      // 1) Web Share API 시도 — 파일 공유 가능 시 OS 공유 시트 호출
      const file = new File([blob], filename, { type: 'image/png' })
      const shareData: ShareData = {
        files: [file],
        title: `${notice.name} ${typeLabel} 접수결과`,
        text: `${notice.name} - ${typeLabel} 청약접수 현황`,
      }

      // navigator.canShare가 있고 파일 공유가 가능하면 시도
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare(shareData)
      ) {
        try {
          await navigator.share(shareData)
          // 공유 성공 또는 사용자가 취소한 경우도 여기에 도달 (에러 안 던짐)
          return
        } catch (shareErr: unknown) {
          // 사용자가 명시적으로 취소(AbortError)면 조용히 종료
          if (shareErr instanceof Error && shareErr.name === 'AbortError') {
            return
          }
          // 그 외의 에러 (권한 거부 등)는 다운로드로 fallback
          console.warn('공유 실패, 다운로드로 전환:', shareErr)
        }
      }

      // 2) Fallback — 일반 다운로드 (브라우저 다운로드 폴더에 저장됨)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('캡처 실패:', e)
      alert('이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setCapturing(null)
    }
  }

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

  // === 청약홈 직접 조회 자동 폴백 ===
  // 조건: 공공 API에 1순위 데이터 없음(hasRank1Data=false)
  //   + 1순위 접수일이 시작됐음 (= 사이트엔 데이터 있을 가능성)
  //   + notice.id가 유효한 공고번호 형식
  // 캐시: 서버 측 5분 (Vercel revalidate=300)
  //
  // 🔧 버그 수정 (2026-04-30):
  //   1) 의존성을 `notice` → `notice.id`로 변경 (부모가 30초마다 새로고침해도 재실행 방지)
  //   2) cleanup 시 setApplyhomeLoading(false) 강제 해제 (영원한 로딩 상태 방지)
  //   3) `applyhomeData || applyhomeLoading` 가드 제거 (의존성으로 충분)
  useEffect(() => {
    if (hasRank1Data) return // 공공 API에 데이터 있으면 폴백 불필요
    if (isPublicHousing(notice.hompageUrl)) return // LH/SH 단지는 청약홈에 1순위 미공개 가능성

    const pblancNo = String(notice.id || '').trim()
    if (!/^\d{6,12}$/.test(pblancNo)) return

    // 1순위 시작일 도래 여부 확인 (시작 전이면 청약홈도 비어있음)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const rank1Date = parseDateOnly(deriveRank1Date(notice))
    if (rank1Date && today.getTime() < rank1Date.getTime()) return

    let cancelled = false
    const fetchApplyhome = async () => {
      setApplyhomeLoading(true)
      try {
        const res = await fetch(`/api/applyhome-competition?pblancNo=${pblancNo}`)
        const data: ApplyhomeCompetitionData = await res.json()
        if (!cancelled) {
          setApplyhomeData(data)
          setApplyhomeLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setApplyhomeData({
            ok: false,
            pblancNo,
            source: 'applyhome',
            fetchedAt: new Date().toISOString(),
            rank1ByType: [],
            totalSuply: 0,
            totalLocal: 0,
            totalEtc: 0,
            totalAll: 0,
            error: String(e),
          })
          setApplyhomeLoading(false)
        }
      }
    }
    fetchApplyhome()
    return () => {
      cancelled = true
      // cleanup 시 로딩 상태 강제 해제 (재실행 시 새 fetch가 막히는 것 방지)
      setApplyhomeLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRank1Data, notice.id])

  // 폴백 응답이 "의미 있는" 데이터인지 판단:
  //   - ok 응답
  //   - rank1ByType 배열에 항목이 있고
  //   - totalAll(접수 합계) > 0
  // 값이 모두 0이면 LH 단지나 데이터 미공개 단지이므로 표를 그리지 않음
  const hasApplyhomeData = applyhomeData?.ok
    && applyhomeData.rank1ByType.length > 0
    && applyhomeData.totalAll > 0

  // 단지 자체가 공공기관 청약(LH/SH 등) 사이트로 연결되는지
  const isPublicHousingNotice = isPublicHousing(notice.hompageUrl)

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 card-hover">
      {/* 상단 영역 - 단지 정보 + 상태 박스 (가로 분할) */}
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 mb-4">
        {/* 왼쪽: 단지 기본정보 */}
        <div className="lg:w-80 flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">APT</span>
          <span className={`status-badge ${STATUS_STYLE[notice.status]}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${STATUS_DOT[notice.status]}`} />
            {notice.status}
          </span>
        </div>
        {/* 특공/1순위 일정: 한 줄, 색상 구분 */}
        <div className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
          <span className="font-bold text-emerald-600">특공</span>
          <span className="font-semibold text-gray-700 tabular-nums">
            {formatShortDate(deriveSpsplyDate(notice))}
          </span>
          <span className="text-gray-300">,</span>
          <span className="font-bold text-rose-600">1순위</span>
          <span className="font-semibold text-gray-700 tabular-nums">
            {formatShortDate(deriveRank1Date(notice))}
          </span>
        </div>
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
        {!hasSpsplyData && (() => {
          // 접수 마감일이 지났는데 데이터가 없는 경우 = 데이터 미제공 (과거 단지)
          // 마감 전 = 발표 대기 중
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          const endDate = notice.rceptEndde ? new Date(notice.rceptEndde) : null
          const isPast = endDate && endDate < today

          if (isPast) {
            // LH/SH 등 공공기관 청약 단지: "사업주체 미제공"으로 통일
            if (isPublicHousingNotice) {
              return (
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-sm font-semibold text-gray-700">사업주체 미제공</p>
                  <p className="text-xs text-gray-500 mt-1">청약홈에 결과 미공개</p>
                </div>
              )
            }
            // 일반 단지: 청약홈 API 보존 범위 벗어남 가능성 안내
            return (
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-sm font-semibold text-gray-600">ℹ️ 특별공급 데이터 미제공</p>
                <p className="text-xs text-gray-500 mt-1">청약홈 API 보존 범위를 벗어난 단지일 수 있습니다</p>
              </div>
            )
          }
          return (
            <div className={isPublicHousingNotice ? "bg-gray-50 rounded-xl p-3 text-center" : "bg-blue-50 rounded-xl p-3 text-center"}>
              {isPublicHousingNotice ? (
                <>
                  <p className="text-sm font-semibold text-gray-700">사업주체 미제공</p>
                  <p className="text-xs text-gray-500 mt-1">청약홈에 결과 미공개</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-blue-700">⏳ 데이터 대기 중</p>
                  <p className="text-xs text-blue-600 mt-1">접수 후 결과 동기화</p>
                  {notice.przwnerPresnatnDe && (
                    <p className="text-xs text-gray-500 mt-2">
                      예정 발표일: {formatDate(notice.przwnerPresnatnDe)} (저녁 7:30)
                    </p>
                  )}
                </>
              )}
            </div>
          )
        })()}
        {hasSpsplyData && (
          <div className="bg-emerald-50 rounded-xl p-3">
            <div className="text-center">
              <p className="text-sm font-semibold text-emerald-700">✅ 특별공급 접수 결과</p>
              <p className="text-xs text-emerald-600 mt-1">{spsplyResultName || '데이터 수신됨'}</p>
            </div>
            {/* 보고용 스샷 버튼 - LH/SH 등 공공기관 청약 단지는 숨김 (특공/1순위 미공개) */}
            {!isPublicHousingNotice && (
              <>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button
                    onClick={() => downloadCapture('spsply')}
                    disabled={capturing !== null}
                    className="flex items-center justify-center gap-1 bg-white border border-emerald-200 text-emerald-700 rounded-lg py-2 text-xs font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {capturing === 'spsply' ? '⏳ 생성 중...' : '📷 특공 스샷'}
                  </button>
                  <button
                    onClick={() => downloadCapture('rank1')}
                    disabled={capturing !== null || !hasRank1Data}
                    className="flex items-center justify-center gap-1 bg-white border border-rose-200 text-rose-700 rounded-lg py-2 text-xs font-semibold hover:bg-rose-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!hasRank1Data ? '1순위 데이터 없음' : ''}
                  >
                    {capturing === 'rank1' ? '⏳ 생성 중...' : '📷 1순위 스샷'}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 text-center mt-2">
                  💡 버튼을 누르면 카톡 등으로 바로 공유할 수 있어요
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* 특별공급 신청현황 - 가로 풀폭 표 */}
      {hasSpsplyData && specialSupply && (
        <div>
          <p className="text-xs font-semibold text-blue-600 mb-2">🎯 특별공급 청약접수 현황 (청약홈 동일)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] sm:text-[11px] border-collapse">
              <thead>
                <tr className="bg-blue-50 text-gray-700">
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold" rowSpan={2}>주택형</th>
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold" rowSpan={2}>공급<br/>세대</th>
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold" rowSpan={2}>구분</th>
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold" colSpan={8}>특별공급 구분</th>
                  <th className="border border-blue-100 px-1.5 py-1.5 font-semibold sticky right-0 bg-blue-50 shadow-[-4px_0_4px_-2px_rgba(0,0,0,0.08)]" rowSpan={2}>총<br/>접수</th>
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
                          {ht.spsplyHshldco.toLocaleString()}
                        </td>
                        <td className="border border-gray-200 px-1 py-1 text-center text-gray-500 text-[9px]">배정</td>
                        {assignedRow.map((val, i) => (
                          <td key={i} className="border border-gray-200 px-0.5 py-1 text-center text-gray-600">{val ? val.toLocaleString() : '-'}</td>
                        ))}
                        <td className="border border-gray-200 px-1.5 py-1.5 text-center font-bold text-orange-600 sticky right-0 bg-white shadow-[-4px_0_4px_-2px_rgba(0,0,0,0.08)]" rowSpan={2}>
                          {totalReceived.toLocaleString()}
                        </td>
                      </tr>,
                    <tr key={`${ht.type}-2`} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-1 py-1 text-center text-gray-700 text-[9px] font-semibold bg-blue-50">접수</td>
                        {receivedRow.map((val, i) => (
                          <td key={i} className={`border border-gray-200 px-0.5 py-1 text-center font-semibold ${val > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                            {val ? val.toLocaleString() : '-'}
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
                        {totalSupply.toLocaleString()}
                      </td>
                      <td className="border border-amber-200 px-1 py-1.5 text-center font-bold text-amber-800 text-[9px]">
                        접수
                      </td>
                      {categoryTotals.map((val, i) => (
                        <td
                          key={i}
                          className={`border border-amber-200 px-0.5 py-1.5 text-center font-bold ${val > 0 ? 'text-red-600' : 'text-gray-400'}`}
                        >
                          {val ? val.toLocaleString() : '-'}
                        </td>
                      ))}
                      <td className="border border-amber-200 px-1.5 py-1.5 text-center font-extrabold text-red-700 text-[12px] bg-red-50 sticky right-0 shadow-[-4px_0_4px_-2px_rgba(0,0,0,0.12)]">
                        {grandTotal.toLocaleString()}
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
            <table className="w-full text-[10px] sm:text-[11px] border-collapse">
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

      {/* ===== 청약홈 직접 조회 결과 (공공 API 폴백) ===== */}
      {/* 공공 API에 1순위 데이터가 없을 때 자동 호출됨. 5분 캐시. */}
      {/* 단, 공공기관 청약(LH/SH) 단지는 폴백 호출 자체를 안 하고 표시 영역도 모두 숨김 */}
      {!hasRank1Data && !isPublicHousingNotice && applyhomeLoading && (
        <div className="mt-4 bg-purple-50 rounded-xl p-3 text-center">
          <p className="text-sm font-semibold text-purple-700">⏳ 청약홈에서 가져오는 중...</p>
          <p className="text-xs text-purple-600 mt-1">잠시만 기다려주세요</p>
        </div>
      )}

      {!hasRank1Data && !isPublicHousingNotice && hasApplyhomeData && applyhomeData && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-purple-700">
              📌 일반공급 1순위 청약접수 현황 <span className="text-[10px] text-purple-500">(청약홈 직접 조회)</span>
            </p>
            <span className="text-[10px] text-gray-400">
              수집: {new Date(applyhomeData.fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] sm:text-[11px] border-collapse">
              <thead>
                <tr className="bg-purple-50 text-gray-700">
                  <th className="border border-purple-100 px-1.5 py-1.5 font-semibold">타입</th>
                  <th className="border border-purple-100 px-1.5 py-1.5 font-semibold">공급<br/>세대</th>
                  <th className="border border-purple-100 px-1.5 py-1.5 font-semibold">해당<br/>지역</th>
                  <th className="border border-purple-100 px-1.5 py-1.5 font-semibold">기타<br/>지역</th>
                  <th className="border border-purple-100 px-1.5 py-1.5 font-semibold">소계</th>
                  <th className="border border-purple-100 px-1.5 py-1.5 font-semibold">경쟁률</th>
                </tr>
              </thead>
              <tbody>
                {applyhomeData.rank1ByType.map((r) => (
                  <tr key={r.type} className="hover:bg-gray-50">
                    <td className="border border-gray-200 px-1.5 py-1.5 text-center font-semibold text-purple-700">
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
                    <td className={`border border-gray-200 px-1.5 py-1.5 text-center font-semibold ${r.rate >= 1 ? 'text-purple-700' : 'text-gray-500'}`}>
                      {r.rate > 0 ? `${r.rate.toFixed(2)} 대 1` : '-'}
                    </td>
                  </tr>
                ))}
                <tr className="bg-amber-50 border-t-2 border-amber-300">
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">계</td>
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">
                    {applyhomeData.totalSuply.toLocaleString()}
                  </td>
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">
                    {applyhomeData.totalLocal.toLocaleString()}
                  </td>
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-bold text-amber-800">
                    {applyhomeData.totalEtc.toLocaleString()}
                  </td>
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center font-extrabold text-red-700 bg-red-50">
                    {applyhomeData.totalAll.toLocaleString()}
                  </td>
                  <td className="border border-amber-200 px-1.5 py-1.5 text-center text-amber-800 font-bold">
                    {applyhomeData.totalSuply > 0
                      ? `${(applyhomeData.totalAll / applyhomeData.totalSuply).toFixed(2)} 대 1`
                      : '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
            ※ 출처: 청약홈 (applyhome.co.kr) / 1순위 해당+기타지역 합계 기준
          </p>
        </div>
      )}

      {/* 1순위 데이터 안내 - 청약홈 API 데이터 누락 가능성을 정직하게 표시 */}
      {/* 공공기관 청약(LH/SH) 단지는 1순위 미공개이므로 이 안내도 표시 안 함 */}
      {!hasRank1Data && !isPublicHousingNotice && !hasApplyhomeData && !applyhomeLoading && (() => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        const endDate = notice.rceptEndde ? parseDateOnly(notice.rceptEndde) : null
        const rank1Date = parseDateOnly(deriveRank1Date(notice))

        // 청약홈 경쟁률 팝업 페이지 (selectAPTCompetitionPopup.do)
        // 모집공고 페이지(selectAPTLttotPblancDetail.do)와 다름 - 직접 경쟁률로 이동
        const applyhomeUrl = `https://www.applyhome.co.kr/ai/aia/selectAPTCompetitionPopup.do?houseManageNo=${notice.id}&pblancNo=${notice.id}`

        // [상황 1] 1순위 시작 전 → 단순 안내
        if (rank1Date && today.getTime() < rank1Date.getTime()) {
          return (
            <div className="mt-4 bg-blue-50 rounded-xl p-3 text-center">
              <p className="text-sm font-semibold text-blue-700">📅 1순위 접수 예정</p>
              <p className="text-xs text-blue-600 mt-1">
                {formatShortDate(deriveRank1Date(notice))} 접수 시작
              </p>
            </div>
          )
        }

        // [상황 2] 1순위가 시작되었거나 마감 → 청약홈 API 미제공 가능성 안내
        // (청약홈 사이트엔 있는데 공공데이터 API에서 누락되는 케이스가 있음)
        // 특공 데이터는 없는 1순위 단독 단지일 수 있으므로 hasSpsplyData 조건 무관하게 표시
        if (rank1Date) {
          return (
            <div className="mt-4 bg-amber-50 rounded-xl p-3 text-center">
              <p className="text-sm font-semibold text-amber-700">⚠️ 1순위 경쟁률 데이터 미제공</p>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                청약홈 공공 API에 아직 반영되지 않았습니다.
                <br />
                청약홈에서 직접 확인하세요.
              </p>
              <a
                href={applyhomeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
              >
                🔗 청약홈에서 경쟁률 보기
              </a>
            </div>
          )
        }

        // [상황 3] 폴백 (날짜 정보 자체가 없는 비정상 케이스)
        return (
          <div className="mt-4 bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-sm font-semibold text-gray-600">ℹ️ 1순위 경쟁률 데이터 미제공</p>
            <p className="text-xs text-gray-500 mt-1">청약홈에서 직접 확인해주세요</p>
          </div>
        )
      })()}

        </div>{/* 오른쪽 컬럼 끝 */}
      </div>{/* 가로 분할 영역 끝 */}

      {/* ============================================================ */}
      {/* 숨겨진 캡처용 가로 레이아웃 (화면에는 안 보임, html2canvas로만 캡처) */}
      {/* ============================================================ */}
      <div
        style={{
          position: 'fixed', // absolute → fixed로 변경 (스크롤 영향 안 받음)
          left: '-99999px',
          top: '0px',
          width: '800px',
          pointerEvents: 'none',
          zIndex: -1,
        }}
        aria-hidden="true"
      >
        {/* === 특공 캡처용 === */}
        {hasSpsplyData && specialSupply && (
          <div ref={captureSpsplyRef} style={{ width: '760px', padding: '32px 24px 24px 24px', backgroundColor: '#ffffff', fontFamily: '"Noto Sans KR", sans-serif', boxSizing: 'border-box' }}>
            {/* 헤더: 단지명 + 지역/주소 */}
            <div style={{ borderBottom: '2px solid #2563eb', paddingBottom: '12px', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                📍 {notice.region} · {notice.address || ''}
              </div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#111827' }}>
                {notice.name}
              </div>
            </div>

            {/* 표 제목 */}
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#2563eb', marginBottom: '8px' }}>
              🎯 특별공급 청약접수 현황 (청약홈 동일)
            </div>

            {/* 표 (가로 폭 풀 활용) */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '64px' }} />
                <col style={{ width: '52px' }} />
                <col style={{ width: '44px' }} />
                <col style={{ width: '60px' }} />{/* 다자녀 */}
                <col style={{ width: '60px' }} />{/* 신혼부부 */}
                <col style={{ width: '60px' }} />{/* 생애최초 */}
                <col style={{ width: '60px' }} />{/* 노부모 */}
                <col style={{ width: '60px' }} />{/* 신생아 */}
                <col style={{ width: '60px' }} />{/* 청년 */}
                <col style={{ width: '60px' }} />{/* 기관추천 */}
                <col style={{ width: '60px' }} />{/* 이전기관 */}
                <col style={{ width: '70px' }} />{/* 총접수 */}
              </colgroup>
              <thead>
                {/* 단일 행 헤더 (rowSpan/colSpan 제거 - html2canvas 호환성) */}
                <tr style={{ backgroundColor: '#dbeafe', color: '#374151' }}>
                  <th style={{ border: '1px solid #93c5fd', padding: '10px 4px', fontWeight: 600, whiteSpace: 'nowrap' }}>주택형</th>
                  <th style={{ border: '1px solid #93c5fd', padding: '10px 4px', fontWeight: 600, whiteSpace: 'nowrap' }}>공급</th>
                  <th style={{ border: '1px solid #93c5fd', padding: '10px 4px', fontWeight: 600, whiteSpace: 'nowrap' }}>구분</th>
                  {['다자녀', '신혼부부', '생애최초', '노부모', '신생아', '청년', '기관추천', '이전기관'].map((label, i) => (
                    <th key={i} style={{ border: '1px solid #93c5fd', padding: '10px 2px', fontWeight: 600, whiteSpace: 'nowrap', fontSize: '11px' }}>{label}</th>
                  ))}
                  <th style={{ border: '1px solid #93c5fd', padding: '10px 4px', fontWeight: 600, whiteSpace: 'nowrap' }}>총접수</th>
                </tr>
              </thead>
              <tbody>
                {specialSupply.houseTypes.flatMap((ht) => {
                  const order = ['다자녀', '신혼부부', '생애최초', '노부모', '신생아', '청년', '기관추천', '이전기관']
                  const findCat = (name: string) => ht.categories.find(c => c.name === name)
                  const assignedRow = order.map(name => {
                    const cat = findCat(name)
                    return cat ? cat.suply : 0
                  })
                  const receivedRow = order.map(name => {
                    const cat = findCat(name)
                    if (!cat) return 0
                    if (cat.areaData) return cat.areaData.해당 + cat.areaData.기타경기 + cat.areaData.기타지역
                    if (cat.instData) return cat.instData.결정
                    return 0
                  })
                  const totalReceived = receivedRow.reduce((s, n) => s + n, 0)
                  return [
                    <tr key={`${ht.type}-1`}>
                      <td style={{ borderTop: '1px solid #e5e7eb', borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb', padding: '8px 4px 2px 4px', textAlign: 'center', fontWeight: 600, color: '#1d4ed8', whiteSpace: 'nowrap' }}>
                        {ht.typeLabel}㎡
                      </td>
                      <td style={{ borderTop: '1px solid #e5e7eb', borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb', padding: '8px 4px 2px 4px', textAlign: 'center', color: '#4b5563' }}>
                        {ht.spsplyHshldco.toLocaleString()}
                      </td>
                      <td style={{ border: '1px solid #e5e7eb', padding: '4px', textAlign: 'center', color: '#6b7280', fontSize: '10px', whiteSpace: 'nowrap' }}>배정</td>
                      {assignedRow.map((val, i) => (
                        <td key={i} style={{ border: '1px solid #e5e7eb', padding: '4px 2px', textAlign: 'center', color: '#4b5563' }}>{val ? val.toLocaleString() : '-'}</td>
                      ))}
                      <td style={{ borderTop: '1px solid #e5e7eb', borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb', padding: '8px 4px 2px 4px', textAlign: 'center', fontWeight: 700, color: '#ea580c' }}>
                        {totalReceived.toLocaleString()}
                      </td>
                    </tr>,
                    <tr key={`${ht.type}-2`}>
                      <td style={{ borderBottom: '1px solid #e5e7eb', borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb', padding: '0' }}></td>
                      <td style={{ borderBottom: '1px solid #e5e7eb', borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb', padding: '0' }}></td>
                      <td style={{ border: '1px solid #e5e7eb', padding: '4px', textAlign: 'center', color: '#374151', fontSize: '10px', fontWeight: 600, backgroundColor: '#dbeafe', whiteSpace: 'nowrap' }}>접수</td>
                      {receivedRow.map((val, i) => (
                        <td key={i} style={{ border: '1px solid #e5e7eb', padding: '4px 2px', textAlign: 'center', fontWeight: 600, color: val > 0 ? '#1d4ed8' : '#9ca3af' }}>
                          {val ? val.toLocaleString() : '-'}
                        </td>
                      ))}
                      <td style={{ borderBottom: '1px solid #e5e7eb', borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb', padding: '0' }}></td>
                    </tr>
                  ]
                })}
                {/* 합계 행 */}
                {(() => {
                  const order = ['다자녀', '신혼부부', '생애최초', '노부모', '신생아', '청년', '기관추천', '이전기관']
                  const totalSupply = specialSupply.houseTypes.reduce((sum, ht) => sum + ht.spsplyHshldco, 0)
                  const categoryTotals = order.map(name => {
                    return specialSupply.houseTypes.reduce((sum, ht) => {
                      const cat = ht.categories.find(c => c.name === name)
                      if (!cat) return sum
                      if (cat.areaData) return sum + cat.areaData.해당 + cat.areaData.기타경기 + cat.areaData.기타지역
                      if (cat.instData) return sum + cat.instData.결정
                      return sum
                    }, 0)
                  })
                  const grandTotal = categoryTotals.reduce((s, n) => s + n, 0)
                  return (
                    <tr style={{ backgroundColor: '#fef3c7', borderTop: '2px solid #fbbf24' }}>
                      <td style={{ border: '1px solid #fcd34d', padding: '8px 4px', textAlign: 'center', fontWeight: 700, color: '#92400e', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>합계</td>
                      <td style={{ border: '1px solid #fcd34d', padding: '8px 4px', textAlign: 'center', fontWeight: 700, color: '#92400e', verticalAlign: 'middle' }}>{totalSupply.toLocaleString()}</td>
                      <td style={{ border: '1px solid #fcd34d', padding: '6px 4px', textAlign: 'center', fontWeight: 700, color: '#92400e', fontSize: '10px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>접수</td>
                      {categoryTotals.map((val, i) => (
                        <td key={i} style={{ border: '1px solid #fcd34d', padding: '6px 2px', textAlign: 'center', fontWeight: 700, color: val > 0 ? '#dc2626' : '#9ca3af', verticalAlign: 'middle' }}>
                          {val ? val.toLocaleString() : '-'}
                        </td>
                      ))}
                      <td style={{ border: '1px solid #fcd34d', padding: '8px 4px', textAlign: 'center', fontWeight: 800, color: '#b91c1c', fontSize: '14px', backgroundColor: '#fee2e2', verticalAlign: 'middle' }}>
                        {grandTotal.toLocaleString()}
                      </td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>

            <div style={{ marginTop: '8px', fontSize: '10px', color: '#9ca3af' }}>
              ※ 접수 = 해당지역+기타경기+기타지역 합계 / 기관추천·이전기관: 결정수 기준
              <br />출처: 청약홈 (한국부동산원)
            </div>
          </div>
        )}

        {/* === 1순위 캡처용 === */}
        {hasRank1Data && (
          <div ref={captureRank1Ref} style={{ width: '760px', padding: '32px 24px 24px 24px', backgroundColor: '#ffffff', fontFamily: '"Noto Sans KR", sans-serif', boxSizing: 'border-box' }}>
            {/* 헤더: 단지명 + 지역/주소 */}
            <div style={{ borderBottom: '2px solid #e11d48', paddingBottom: '12px', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                📍 {notice.region} · {notice.address || ''}
              </div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#111827' }}>
                {notice.name}
              </div>
            </div>

            {/* 표 제목 */}
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#e11d48', marginBottom: '8px' }}>
              📊 일반공급 1순위 청약접수 현황
            </div>

            {/* 1순위 표 */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '90px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '' }} />{/* 경쟁률은 가변 */}
              </colgroup>
              <thead>
                <tr style={{ backgroundColor: '#ffe4e6', color: '#374151' }}>
                  <th style={{ border: '1px solid #fda4af', padding: '10px 6px', fontWeight: 600, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>타입</th>
                  <th style={{ border: '1px solid #fda4af', padding: '10px 6px', fontWeight: 600, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>공급세대</th>
                  <th style={{ border: '1px solid #fda4af', padding: '10px 6px', fontWeight: 600, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>해당지역</th>
                  <th style={{ border: '1px solid #fda4af', padding: '10px 6px', fontWeight: 600, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>기타지역</th>
                  <th style={{ border: '1px solid #fda4af', padding: '10px 6px', fontWeight: 600, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>소계</th>
                  <th style={{ border: '1px solid #fda4af', padding: '10px 6px', fontWeight: 600, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>경쟁률</th>
                </tr>
              </thead>
              <tbody>
                {rank1ByType.map((r) => (
                  <tr key={r.type}>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px 6px', textAlign: 'center', fontWeight: 600, color: '#be123c', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{r.typeLabel}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px 6px', textAlign: 'center', color: '#4b5563', verticalAlign: 'middle' }}>{r.suply.toLocaleString()}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px 6px', textAlign: 'center', color: '#4b5563', verticalAlign: 'middle' }}>{r.local.toLocaleString()}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px 6px', textAlign: 'center', color: '#4b5563', verticalAlign: 'middle' }}>{r.etc.toLocaleString()}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px 6px', textAlign: 'center', fontWeight: 700, color: r.total > 0 ? '#dc2626' : '#9ca3af', verticalAlign: 'middle' }}>{r.total.toLocaleString()}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '8px 6px', textAlign: 'center', fontWeight: 600, color: r.rate >= 1 ? '#be123c' : '#6b7280', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      {r.suply > 0
                        ? (r.rate < 1 ? `미달 (${r.rate.toFixed(2)})` : `${r.rate.toFixed(2)} 대 1`)
                        : '-'}
                    </td>
                  </tr>
                ))}
                {/* 합계 행 */}
                <tr style={{ backgroundColor: '#fef3c7', borderTop: '2px solid #fbbf24' }}>
                  <td style={{ border: '1px solid #fcd34d', padding: '10px 6px', textAlign: 'center', fontWeight: 700, color: '#92400e', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>계</td>
                  <td style={{ border: '1px solid #fcd34d', padding: '10px 6px', textAlign: 'center', fontWeight: 700, color: '#92400e', verticalAlign: 'middle' }}>{rank1TotalSuply.toLocaleString()}</td>
                  <td style={{ border: '1px solid #fcd34d', padding: '10px 6px', textAlign: 'center', fontWeight: 700, color: '#92400e', verticalAlign: 'middle' }}>{rank1TotalLocal.toLocaleString()}</td>
                  <td style={{ border: '1px solid #fcd34d', padding: '10px 6px', textAlign: 'center', fontWeight: 700, color: '#92400e', verticalAlign: 'middle' }}>{rank1TotalEtc.toLocaleString()}</td>
                  <td style={{ border: '1px solid #fcd34d', padding: '10px 6px', textAlign: 'center', fontWeight: 800, color: '#b91c1c', backgroundColor: '#fee2e2', verticalAlign: 'middle' }}>{rank1GrandTotal.toLocaleString()}</td>
                  <td style={{ border: '1px solid #fcd34d', padding: '10px 6px', textAlign: 'center', fontWeight: 800, color: rank1AvgRate >= 1 ? '#be123c' : '#6b7280', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                    {rank1TotalSuply > 0
                      ? (rank1AvgRate < 1 ? `미달 (${rank1AvgRate.toFixed(2)})` : `${rank1AvgRate.toFixed(2)} 대 1`)
                      : '-'}
                  </td>
                </tr>
              </tbody>
            </table>

            <div style={{ marginTop: '8px', fontSize: '10px', color: '#9ca3af' }}>
              ※ 1순위 해당지역 + 기타지역 신청건수 기준 / 경쟁률 = 신청건수 ÷ 공급세대수
              <br />출처: 청약홈 (한국부동산원)
            </div>
          </div>
        )}
      </div>
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
  // 청약공고 탭 전용 가벼운 state (최근 1페이지 = 1000건만)
  const [noticeItems, setNoticeItems] = useState<ApartmentItem[]>([])
  const [noticeLoading, setNoticeLoading] = useState(false)
  const [noticeLoaded, setNoticeLoaded] = useState(false)

  // 캐시-퍼스트 전략: 마지막 fetch 시각 추적 (TTL 5분)
  const lastFetchAt = useRef<{
    notice: number
    noticeRecent: number
    spsply: number
    cmpet: number
  }>({ notice: 0, noticeRecent: 0, spsply: 0, cmpet: 0 })
  const CACHE_TTL_MS = 5 * 60 * 1000 // 5분

  // 백그라운드 갱신 중 인디케이터 (스피너 대체)
  const [bgRefreshing, setBgRefreshing] = useState(false)
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

  const [periodKey, setPeriodKey] = useState('recent1m')
  const [yearMonthFrom, setYearMonthFrom] = useState('')
  const [yearMonthTo, setYearMonthTo] = useState('')

  // 금주 접수현황 탭 전용 필터
  const [thisWeekRegion, setThisWeekRegion] = useState('전체')
  const [thisWeekKeyword, setThisWeekKeyword] = useState('')
  const [thisWeekSearchInput, setThisWeekSearchInput] = useState('')
  const [thisWeekPeriod, setThisWeekPeriod] = useState<string>('thisweek') // 'thisweek' | '3m' | '2026' | '2025' | ...

  const yearButtons = getFixedYearButtons()

  // [접수현황 조회] 탭용: 풀로딩 (과거 데이터까지)
  // background=true → 스켈레톤 안 보여주고 백그라운드 갱신만
  // skipIfFresh=true → 5분 이내 데이터 있으면 fetch 스킵
  const fetchNotice = useCallback(async (fresh = false, background = false, skipIfFresh = false) => {
    if (skipIfFresh && Date.now() - lastFetchAt.current.notice < CACHE_TTL_MS) {
      return
    }
    if (!background) setLoading(true)
    else setBgRefreshing(true)
    try {
      const url = fresh ? '/api/apartments?fresh=1' : '/api/apartments'
      const res = await fetch(url, fresh ? { cache: 'no-store' } : undefined)
      const data = await res.json()
      setItems(data.items || [])
      setIsDummy(data.isDummy || false)
      lastFetchAt.current.notice = Date.now()
    } catch (e) {
      console.error(e)
    } finally {
      if (!background) setLoading(false)
      else setBgRefreshing(false)
    }
  }, [CACHE_TTL_MS])

  // [청약공고] 탭용: 가벼움 (limit=recent → 1페이지 = 1000건만)
  const fetchNoticeRecent = useCallback(async (fresh = false, background = false, skipIfFresh = false) => {
    if (skipIfFresh && Date.now() - lastFetchAt.current.noticeRecent < CACHE_TTL_MS) {
      return
    }
    if (!background) setNoticeLoading(true)
    else setBgRefreshing(true)
    try {
      const url = fresh
        ? '/api/apartments?limit=recent&fresh=1'
        : '/api/apartments?limit=recent'
      const res = await fetch(url, fresh ? { cache: 'no-store' } : undefined)
      const data = await res.json()
      setNoticeItems(data.items || [])
      setIsDummy(data.isDummy || false)
      setNoticeLoaded(true)
      lastFetchAt.current.noticeRecent = Date.now()
    } catch (e) {
      console.error(e)
    } finally {
      if (!background) setNoticeLoading(false)
      else setBgRefreshing(false)
    }
  }, [CACHE_TTL_MS])

  const fetchSpecialSupply = useCallback(async (fresh = true, background = false, skipIfFresh = false) => {
    if (skipIfFresh && Date.now() - lastFetchAt.current.spsply < CACHE_TTL_MS) {
      return
    }
    if (!background) setSpsplyLoading(true)
    else setBgRefreshing(true)
    try {
      const params = new URLSearchParams()
      if (fresh) params.set('fresh', '1')
      const res = await fetch(`/api/special-supply?${params.toString()}`, { cache: 'no-store' })
      const data = await res.json()
      setSpsplyItems(data.items || [])
      lastFetchAt.current.spsply = Date.now()
    } catch (e) {
      console.error('special-supply fetch error:', e)
    } finally {
      if (!background) setSpsplyLoading(false)
      else setBgRefreshing(false)
    }
  }, [CACHE_TTL_MS])

  const fetchCompetition = useCallback(async (kw = '', region = '전체', ymFrom = '', ymTo = '', background = false, skipIfFresh = false, fresh = false) => {
    if (skipIfFresh && Date.now() - lastFetchAt.current.cmpet < CACHE_TTL_MS) {
      return
    }
    if (!background) setCmpetLoading(true)
    else setBgRefreshing(true)
    try {
      const params = new URLSearchParams()
      if (kw) params.set('keyword', kw)
      if (region !== '전체') params.set('region', region)
      if (ymFrom) params.set('yearMonthFrom', ymFrom)
      if (ymTo) params.set('yearMonthTo', ymTo)
      if (fresh) params.set('fresh', '1') // 서버 캐시 무시

      const res = await fetch(
        `/api/competition?${params.toString()}`,
        fresh ? { cache: 'no-store' } : undefined
      )
      const data = await res.json()
      setCmpetItems(data.items || [])
      setCmpetLoaded(true)
      lastFetchAt.current.cmpet = Date.now()
    } catch (e) {
      console.error(e)
    } finally {
      if (!background) setCmpetLoading(false)
      else setBgRefreshing(false)
    }
  }, [CACHE_TTL_MS])

  useEffect(() => {
    // 앱 진입 시 가벼운 청약공고 데이터만 로드 (최근 1000건)
    fetchNoticeRecent()
  }, [fetchNoticeRecent])

  useEffect(() => {
    const range = getRecent1MonthRange(new Date())
    setPeriodKey(range.key)
    setYearMonthFrom(range.from)
    setYearMonthTo(range.to)
    // 앱 시작 시 백그라운드 프리페치 (모든 탭에 필요한 데이터를 미리 로딩)
    // 1단계: 2초 뒤 — 가벼운 데이터 (특공, 경쟁률)
    setTimeout(() => {
      fetchCompetition('', '전체', range.from, range.to, true) // background=true
      fetchSpecialSupply(false, true) // 캐시 활용 + background
    }, 2000)
    // 2단계: 5초 뒤 — 무거운 데이터 (청약공고 풀로딩)
    // 사용자가 [접수현황 조회]에서 "12개월/연도별" 선택 시 즉시 보여주기 위함
    setTimeout(() => {
      fetchNotice(false, true) // background=true
    }, 5000)
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

  // 접수현황 탭 - 진입 시 캐시-퍼스트 (5분 이내 데이터면 fetch 스킵)
  // '이번 주' 선택일 때만 fresh, 그 외에는 캐시 활용
  useEffect(() => {
    if (activeTab !== 'thisweek') return
    const isThisWeekSelected = thisWeekPeriod === 'thisweek'

    // 기간에 따른 청약공고 데이터 로드 분기
    // (12m은 더 이상 없음, 연도 키만 풀 데이터 필요)
    const needsFullData = /^\d{4}$/.test(thisWeekPeriod) // '2021'~'2026' 등 연도 키

    // LIVE 시간대(평일 19:30~21:00) + 이번 주 선택 시에는 캐시 무시하고 강제 fresh
    const isLiveAndThisWeek = isThisWeekSelected && isLiveTime()

    if (isThisWeekSelected) {
      if (isLiveAndThisWeek) {
        // LIVE 시간대: 캐시 무시, 강제 fresh, 백그라운드
        fetchNoticeRecent(true, noticeItems.length > 0, false)
        fetchSpecialSupply(true, spsplyItems.length > 0, false)
        const range = getRecent1MonthRange(new Date())
        // fetchCompetition: background, skipIfFresh=false, fresh=true
        fetchCompetition('', '전체', range.from, range.to, cmpetItems.length > 0, false, true)
      } else {
        // 일반 시간대: 5분 이내 캐시면 스킵
        fetchNoticeRecent(false, noticeItems.length > 0, true)
        fetchSpecialSupply(false, spsplyItems.length > 0, true)
        const range = getRecent1MonthRange(new Date())
        fetchCompetition('', '전체', range.from, range.to, cmpetItems.length > 0, true)
      }
    } else {
      // 과거 기간: 데이터 있으면 백그라운드 갱신, 없으면 일반 로딩
      if (needsFullData) {
        fetchNotice(false, items.length > 0, true)
      } else {
        fetchNoticeRecent(false, noticeItems.length > 0, true)
      }
      fetchSpecialSupply(false, spsplyItems.length > 0, true)
      const ym = getPeriodYmRange(thisWeekPeriod)
      fetchCompetition('', '전체', ym.from, ym.to, cmpetItems.length > 0, true)
    }
  }, [activeTab, thisWeekPeriod])

  // 발표 시간대(평일 19:30~21:00)엔 30초마다 자동 새로고침 — '이번 주' 선택 시에만
  useEffect(() => {
    if (activeTab !== 'thisweek') return
    if (thisWeekPeriod !== 'thisweek') return
    if (!isLiveTime()) return

    const interval = setInterval(() => {
      // LIVE 갱신은 항상 fresh + 백그라운드 (서버/클라이언트 캐시 모두 무시)
      fetchNoticeRecent(true, true)
      fetchSpecialSupply(true, true)
      const range = getRecent1MonthRange(new Date())
      // fetchCompetition: background=true, skipIfFresh=false, fresh=true
      fetchCompetition('', '전체', range.from, range.to, true, false, true)
    }, 30000)

    return () => clearInterval(interval)
  }, [activeTab, thisWeekPeriod, fetchNoticeRecent, fetchSpecialSupply, fetchCompetition])

  // [청약공고] 탭: 가벼운 noticeItems 사용 + 접수마감 자동 제외 (진행/예정만)
  const filteredNotice = noticeItems
    .filter(item => item.status !== '접수마감')
    .filter(item => {
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
            onClick={() => {
              // 새로고침 버튼: 강제 fresh + 백그라운드 모드 (스켈레톤 안 깜빡임)
              if (activeTab === 'notice') {
                fetchNoticeRecent(true, noticeItems.length > 0)
              } else if (activeTab === 'competition') {
                fetchCompetition(keyword, cmpetRegion, yearMonthFrom, yearMonthTo, cmpetItems.length > 0)
              } else {
                // 접수현황 조회 탭
                const isThisWeekSelected = thisWeekPeriod === 'thisweek'
                const needsFullData = /^\d{4}$/.test(thisWeekPeriod) // 연도 키만 풀 데이터
                if (needsFullData) {
                  fetchNotice(true, items.length > 0)
                } else {
                  fetchNoticeRecent(true, noticeItems.length > 0)
                }
                fetchSpecialSupply(true, spsplyItems.length > 0)
                if (isThisWeekSelected) {
                  const range = getRecent1MonthRange(new Date())
                  fetchCompetition('', '전체', range.from, range.to, cmpetItems.length > 0)
                } else {
                  const ym = getPeriodYmRange(thisWeekPeriod)
                  fetchCompetition('', '전체', ym.from, ym.to, cmpetItems.length > 0)
                }
              }
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-blue-300 hover:text-white font-medium flex items-center gap-1"
          >
            🔄 새로고침
          </button>
        </div>

        <div className="max-w-5xl mx-auto px-4 flex gap-0 border-t border-gray-100">
          <button
            onClick={() => setActiveTab('notice')}
            className={`flex-1 sm:flex-none px-2 sm:px-6 py-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'notice' ? 'border-blue-400 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            📋 청약공고
          </button>
          <button
            onClick={() => setActiveTab('competition')}
            className={`flex-1 sm:flex-none px-2 sm:px-6 py-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'competition' ? 'border-blue-400 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            📊 경쟁률 조회
          </button>
          <button
            onClick={() => setActiveTab('thisweek')}
            className={`flex-1 sm:flex-none px-2 sm:px-6 py-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'thisweek' ? 'border-blue-400 text-blue-300' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            📅 접수현황 조회
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
              {noticeLoading && noticeItems.length === 0
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
                      const range = getRecent1MonthRange(new Date())
                      setPeriodKey(range.key)
                      setYearMonthFrom(range.from)
                      setYearMonthTo(range.to)
                      fetchCompetition(keyword, cmpetRegion, range.from, range.to)
                    }}
                    className={`filter-btn text-sm px-3 py-1.5 ${periodKey === 'recent1m' ? 'filter-btn-active' : 'filter-btn-inactive'}`}
                  >
                    1개월
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
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-700 mb-1">📅 접수현황 조회</p>
                  {bgRefreshing && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                      갱신 중
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {(() => {
                    const { start, end, label } = getPeriodRange(thisWeekPeriod)
                    return `${label} · ${formatDate(start.toISOString().slice(0, 10))} ~ ${formatDate(end.toISOString().slice(0, 10))}`
                  })()}
                </p>
                {thisWeekPeriod === 'thisweek' && isLiveTime() && (
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

              {/* 기간 필터 */}
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">🗓 기간 필터</p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {PERIOD_BUTTONS.map(p => (
                    <button
                      key={p.key}
                      onClick={() => setThisWeekPeriod(p.key)}
                      className={`filter-btn text-xs sm:text-sm px-2 sm:px-3 py-1.5 ${thisWeekPeriod === p.key ? 'filter-btn-active' : 'filter-btn-inactive'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {thisWeekPeriod !== 'thisweek' && (
                  <p className="text-[10px] text-gray-400 mt-2">
                    ※ 과거 기간은 데이터 제공 범위에 따라 일부 단지의 특별공급/경쟁률 정보가 누락될 수 있습니다.
                  </p>
                )}
              </div>
            </div>

            {(() => {
              const thisWeekItems = items
                .filter(i => isInPeriod(i.rceptBgnde, i.rceptEndde, thisWeekPeriod))
                .filter(i => thisWeekRegion === '전체' || i.region === thisWeekRegion)
                .filter(i => !thisWeekKeyword || i.name.includes(thisWeekKeyword))
              const periodLabel = getPeriodRange(thisWeekPeriod).label
              return (
                <>
                  <p className="text-sm text-blue-100 mb-4">
                    총 <span className="font-bold text-white">{thisWeekItems.length}건</span>의 단지
                    <span className="text-xs text-blue-200/80 ml-2">
                      (기간: {periodLabel}
                      {thisWeekRegion !== '전체' && ` / 지역: ${thisWeekRegion}`}
                      {thisWeekKeyword && ` / 검색: ${thisWeekKeyword}`}
                      )
                    </span>
                  </p>
                  <div className="flex flex-col gap-4">
                    {/* 첫 진입(데이터 없음) + 로딩 중일 때만 스켈레톤 */}
                    {(loading || spsplyLoading) && items.length === 0 && noticeItems.length === 0 ? (
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
                        <p>{periodLabel} 접수 단지가 없습니다.</p>
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