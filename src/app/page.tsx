'use client'

import { useEffect, useState, useCallback } from 'react'

// ===================== TYPES =====================
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

      <div className="flex items-center gap-2 pt-1">
        <a href={`https://map.naver.com/v5/search/${encodeURIComponent(item.name)}`} target="_blank" rel="noopener noreferrer"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-green-50 hover:bg-green-100 transition-colors" title="네이버 지도">
          <span className="text-lg">🗺</span>
        </a>
        <a href="https://www.applyhome.co.kr" target="_blank" rel="noopener noreferrer"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-blue-50 hover:bg-blue-100 transition-colors" title="청약홈">
          <span className="text-lg">🏠</span>
        </a>
        {item.pdfUrl && (
          <a href={item.pdfUrl} target="_blank" rel="noopener noreferrer"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-red-50 hover:bg-red-100 transition-colors" title="모집공고">
            <span className="text-lg">📄</span>
          </a>
        )}
        <a href={item.hompageUrl} target="_blank" rel="noopener noreferrer"
          className="flex-1 text-center text-sm font-semibold bg-gray-900 text-white rounded-xl py-2 hover:bg-gray-700 transition-colors">
          공홈
        </a>
      </div>
    </div>
  )
}

// ===================== 경쟁률 카드 =====================
function CompetitionCard({ item }: { item: CompetitionItem }) {
  const [expanded, setExpanded] = useState(false)

  const typeGroups: Record<string, HouseTypeRate[]> = {}
  item.houseTypes.forEach((h) => {
    const key = formatHouseType(h.type)
    if (!typeGroups[key]) typeGroups[key] = []
    typeGroups[key].push(h)
  })

  const typeKeys = Object.keys(typeGroups)
  const displayKeys = expanded ? typeKeys : typeKeys.slice(0, 2)

  const maxRate = item.houseTypes
    .filter((h) => h.rank === '1' && h.reside === '해당지역')
    .reduce((max, h) => {
      const r = parseFloat(h.rate)
      return isNaN(r) ? max : Math.max(max, r)
    }, 0)

  const rank1Rows = item.houseTypes.filter((h) => h.rank === '1')
  const rank1TotalReq = rank1Rows.reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)
  const rank1LocalReq = rank1Rows
    .filter((h) => h.reside === '해당지역')
    .reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)
  const rank1EtcReq = rank1Rows
    .filter((h) => h.reside !== '해당지역')
    .reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)

  const rank2Rows = item.houseTypes.filter((h) => h.rank === '2')
  const rank2TotalReq = rank2Rows.reduce((sum, h) => sum + parseInt(h.reqCnt || '0', 10), 0)

  const spsplyRow = item.houseTypes.find((h) => h.spsply)?.spsply
  let specialTotalReq = 0

  if (spsplyRow) {
    const specialReqFields = [
      'CRSPAREA_MNYCH_CNT',
      'CRSPAREA_NWWDS_NMTW_CNT',
      'CRSPAREA_LFE_FRST_CNT',
      'CRSPAREA_NWBB_NWBBSHR_CNT',
      'CRSPAREA_YGMN_CNT',
      'CRSPAREA_OPS_CNT',
    ]

    specialTotalReq = specialReqFields.reduce((sum, field) => {
      return sum + parseInt(spsplyRow[field] || '0', 10)
    }, 0)
  }

  const rankLabel: Record<string, string> = {
    '1': '1순위',
    '2': '2순위',
    '3': '특별공급',
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
          특공 (접수){' '}
          <span className="font-bold text-blue-600">{specialTotalReq.toLocaleString()}건</span>
          <span className="text-gray-400 ml-1">(기관/이전 제외)</span>
        </div>

        <div>
          1순위 (접수){' '}
          <span className="font-bold text-red-500">{rank1TotalReq.toLocaleString()}건</span>
          <span className="text-gray-400 ml-1">(해당/기타 합계)</span>
        </div>

        <div className="text-gray-500 text-xs">
          -해당: {rank1LocalReq.toLocaleString()}건 / 기타: {rank1EtcReq.toLocaleString()}건
        </div>

        <div>
          2순위 (접수) <span className="font-bold">{rank2TotalReq.toLocaleString()}건</span>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
        <span className="text-red-400">📍</span>
        {item.region}
      </p>

      {maxRate > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">최고경쟁률</span>
          <span
            className={`text-sm font-bold px-2 py-0.5 rounded-full ${
              maxRate >= 100
                ? 'bg-red-100 text-red-600'
                : maxRate >= 10
                  ? 'bg-orange-100 text-orange-600'
                  : 'bg-yellow-100 text-yellow-600'
            }`}
          >
            {maxRate} : 1
          </span>
          <span className="text-xs text-gray-400">(1순위 해당지역)</span>
        </div>
      )}

      <div className="border-t border-gray-50 pt-3 space-y-3">
        {displayKeys.map((typeKey) => {
          const rows = typeGroups[typeKey]

          return (
            <div key={typeKey} className="bg-gray-50 rounded-xl p-3">
              <p className="text-sm font-bold text-blue-600 mb-2">{typeKey}㎡</p>
              <div className="space-y-1">
                <div className="grid grid-cols-3 text-xs text-gray-400 px-1 mb-1">
                  <span>구분</span>
                  <span className="text-center">공급/신청</span>
                  <span className="text-right">경쟁률</span>
                </div>

                {rows.map((h, i) => {
                  const { label, isDeficit } = formatRate(h.rate)
                  const isEmpty = h.rate === '-'

                  return (
                    <div key={i} className="grid grid-cols-3 items-center text-xs bg-white rounded-lg px-2 py-1.5">
                      <span className="text-gray-500">
                        {rankLabel[h.rank] || h.rank}
                        <span className="text-gray-400 ml-1">({h.reside === '해당지역' ? '해당' : '기타'})</span>
                      </span>

                      <span className="text-center text-gray-500">
                        {parseInt(h.suply || '0', 10).toLocaleString()} / {parseInt(h.reqCnt || '0', 10).toLocaleString()}
                      </span>

                      <span className={`text-right font-semibold ${
                        isEmpty ? 'text-gray-300' : isDeficit ? 'text-gray-400' : 'text-rose-600'
                      }`}>
                        {isEmpty ? '-' : label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {(() => {
        const special = item.houseTypes.find((h) => h.spsply)?.spsply
        if (!special) return null

        const spsplyTypes = [
          { label: '다자녀', suply: 'MNYCH_HSHLDCO', cnt: 'CRSPAREA_MNYCH_CNT' },
          { label: '신혼부부', suply: 'NWWDS_NMTW_HSHLDCO', cnt: 'CRSPAREA_NWWDS_NMTW_CNT' },
          { label: '생애최초', suply: 'LFE_FRST_HSHLDCO', cnt: 'CRSPAREA_LFE_FRST_CNT' },
          { label: '신생아', suply: 'NWBB_NWBBSHR_HSHLDCO', cnt: 'CRSPAREA_NWBB_NWBBSHR_CNT' },
          { label: '청년', suply: 'YGMN_HSHLDCO', cnt: 'CRSPAREA_YGMN_CNT' },
          { label: '노부모', suply: 'OLD_PARNTS_SUPORT_HSHLDCO', cnt: 'CRSPAREA_OPS_CNT' },
        ].filter((s) => parseInt(special[s.suply] || '0', 10) > 0)

        if (spsplyTypes.length === 0) return null

        return (
          <div className="border-t border-blue-50 pt-3">
            <p className="text-xs font-semibold text-blue-600 mb-2">🎯 특별공급 신청현황</p>
            <div className="grid grid-cols-2 gap-1">
              {spsplyTypes.map((s, i) => (
                <div key={i} className="bg-blue-50 rounded-lg px-2 py-1.5 flex justify-between items-center">
                  <span className="text-xs text-gray-600">{s.label}</span>
                  <span className="text-xs font-semibold text-blue-700">
                    {parseInt(special[s.cnt] || '0', 10).toLocaleString()} / {parseInt(special[s.suply] || '0', 10).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {typeKeys.length > 2 && (
        <button onClick={() => setExpanded(!expanded)} className="w-full text-xs text-blue-500 hover:text-blue-700 text-center py-1">
          {expanded ? '접기 ▲' : `+${typeKeys.length - 2}개 주택형 더보기 ▼`}
        </button>
      )}
    </div>
  )
}

// ===================== 스켈레톤 =====================
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
  const [activeTab, setActiveTab] = useState<'notice' | 'competition'>('notice')

  const [items, setItems] = useState<ApartmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isDummy, setIsDummy] = useState(false)
  const [selectedRegion, setSelectedRegion] = useState('전체')
  const [selectedStatus, setSelectedStatus] = useState('전체')

  const [cmpetItems, setCmpetItems] = useState<CompetitionItem[]>([])
  const [cmpetLoading, setCmpetLoading] = useState(false)
  const [cmpetLoaded, setCmpetLoaded] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [cmpetRegion, setCmpetRegion] = useState('전체')

  const [periodKey, setPeriodKey] = useState('recent1y')
  const [yearMonthFrom, setYearMonthFrom] = useState('')
  const [yearMonthTo, setYearMonthTo] = useState('')

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
  }, [])

  useEffect(() => {
    if (activeTab === 'competition' && !cmpetLoaded && yearMonthFrom && yearMonthTo) {
      fetchCompetition('', '전체', yearMonthFrom, yearMonthTo)
    }
  }, [activeTab, cmpetLoaded, fetchCompetition, yearMonthFrom, yearMonthTo])

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
    <main className="min-h-screen pb-16">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 relative">
          <div className="flex items-center justify-center gap-3">
            <span className="text-4xl">🏢</span>
            <span className="font-extrabold text-2xl md:text-3xl text-gray-900">청약홈 간략조회_MarU</span>
          </div>

          <button
            onClick={() => activeTab === 'notice' ? fetchNotice() : fetchCompetition(keyword, cmpetRegion, yearMonthFrom, yearMonthTo)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
          >
            🔄 새로고침
          </button>
        </div>

        <div className="max-w-5xl mx-auto px-4 flex gap-0 border-t border-gray-100">
          <button
            onClick={() => setActiveTab('notice')}
            className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'notice' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            📋 청약공고
          </button>
          <button
            onClick={() => setActiveTab('competition')}
            className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === 'competition' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            📊 경쟁률 조회
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 pt-6">
        <div className="text-center mb-6">
          <p className="text-gray-500 text-sm">복잡한 아파트 청약 공고, 요약된 정보로 쉽고 빠르게 확인하세요.</p>
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
                <div className="flex flex-wrap gap-2">
                  {REGIONS.map(r => (
                    <button key={r} onClick={() => setSelectedRegion(r)} className={`filter-btn ${selectedRegion === r ? 'filter-btn-active' : 'filter-btn-inactive'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">📋 진행 상태</p>
                <div className="flex flex-wrap gap-2">
                  {STATUSES.map(s => (
                    <button key={s} onClick={() => setSelectedStatus(s)} className={`filter-btn ${selectedStatus === s ? 'filter-btn-active' : 'filter-btn-inactive'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-sm text-gray-500 mb-4">
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
                <div className="flex flex-wrap gap-2">
                  {REGIONS.map(r => (
                    <button
                      key={r}
                      onClick={() => {
                        setCmpetRegion(r)
                        fetchCompetition(keyword, r, yearMonthFrom, yearMonthTo)
                      }}
                      className={`filter-btn ${cmpetRegion === r ? 'filter-btn-active' : 'filter-btn-inactive'}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">🗓 기간 필터</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const range = getRecent1YearRange(new Date())
                      setPeriodKey(range.key)
                      setYearMonthFrom(range.from)
                      setYearMonthTo(range.to)
                      fetchCompetition(keyword, cmpetRegion, range.from, range.to)
                    }}
                    className={`filter-btn ${periodKey === 'recent1y' ? 'filter-btn-active' : 'filter-btn-inactive'}`}
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
                        className={`filter-btn ${periodKey === range.key ? 'filter-btn-active' : 'filter-btn-inactive'}`}
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

            <p className="text-sm text-gray-500 mb-4">
              총 <span className="font-bold text-blue-600">{filteredCmpet.length}건</span>의 경쟁률 데이터
              <span className="text-xs text-gray-400 ml-2">(1순위 해당지역 기준 / {formatYm(yearMonthFrom)} ~ {formatYm(yearMonthTo)})</span>
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cmpetLoading
                ? Array(6).fill(0).map((_, i) => <SkeletonCard key={i} />)
                : filteredCmpet.length > 0
                  ? filteredCmpet.map(item => <CompetitionCard key={item.pblancNo} item={item} />)
                  : (
                    <div className="col-span-3 text-center py-16 text-gray-400">
                      <div className="text-4xl mb-3">📊</div>
                      <p>검색 결과가 없습니다.</p>
                    </div>
                  )}
            </div>
          </>
        )}
      </div>

      <footer className="mt-12 text-center text-xs text-gray-400">
        <p>데이터 출처: 공공데이터포털 청약홈 API</p>
        <p className="mt-1">
          <a href="https://www.applyhome.co.kr" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500">
            청약홈 바로가기 →
          </a>
        </p>
      </footer>
    </main>
  )
}