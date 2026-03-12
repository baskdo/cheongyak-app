'use client'

import { useEffect, useState, useCallback } from 'react'

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
}

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

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  const s = dateStr.replace(/-/g, '')
  if (s.length !== 8) return dateStr
  return `${parseInt(s.slice(4, 6))}월 ${parseInt(s.slice(6, 8))}일`
}

function ApartmentCard({ item }: { item: ApartmentItem }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 card-hover flex flex-col gap-3">
      {/* Top badges */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">
            {item.type}
          </span>
          <span className={`status-badge ${STATUS_STYLE[item.status]}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${STATUS_DOT[item.status]}`} />
            {item.status}
          </span>
        </div>
        <span className="text-xs text-gray-400">공고일: {formatDate(item.pblancDe)}</span>
      </div>

      {/* Name */}
      <div>
        <h3 className="font-bold text-gray-900 text-base leading-snug">{item.name}</h3>
        <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
          <span className="text-red-400">📍</span>
          {item.address}
        </p>
      </div>

      {/* Stats */}
      <div className="border-t border-gray-50 pt-3 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">공급규모</span>
          <span className="font-semibold text-gray-800">{parseInt(item.totalUnits).toLocaleString()}세대</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">접수기간</span>
          <span className="font-semibold text-blue-600">
            {formatDate(item.rceptBgnde)} ~ {formatDate(item.rceptEndde)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">당첨자발표</span>
          <span className="font-semibold text-red-500">{formatDate(item.przwnerPresnatnDe)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <a
          href={`https://map.naver.com/v5/search/${encodeURIComponent(item.name)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-green-50 hover:bg-green-100 transition-colors"
          title="네이버 지도"
        >
          <span className="text-lg">🗺</span>
        </a>
        <a
          href="https://www.applyhome.co.kr"
          target="_blank"
          rel="noopener noreferrer"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-blue-50 hover:bg-blue-100 transition-colors"
          title="청약홈"
        >
          <span className="text-lg">🏠</span>
        </a>
        <a
          href={item.hompageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center text-sm font-semibold bg-gray-900 text-white rounded-xl py-2 hover:bg-gray-700 transition-colors"
        >
          공홈
        </a>
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

export default function Home() {
  const [items, setItems] = useState<ApartmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isDummy, setIsDummy] = useState(false)
  const [selectedRegion, setSelectedRegion] = useState('전체')
  const [selectedStatus, setSelectedStatus] = useState('전체')

  const fetchData = useCallback(async () => {
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

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filtered = items.filter(item => {
    const regionMatch = selectedRegion === '전체' || item.region === selectedRegion
    const statusMatch = selectedStatus === '전체' || item.status === selectedStatus
    return regionMatch && statusMatch
  })

  return (
    <main className="min-h-screen pb-16">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏢</span>
            <span className="font-bold text-lg text-gray-900">한눈에 보는 청약홈</span>
          </div>
          <button
            onClick={fetchData}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
          >
            🔄 새로고침
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 pt-6">
        {/* Hero */}
        <div className="text-center mb-6">
          <p className="text-gray-500 text-sm">복잡한 아파트 청약 공고, 요약된 정보로 쉽고 빠르게 확인하세요.</p>
          {isDummy && (
            <div className="mt-2 inline-block bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1.5 rounded-full">
              ⚠️ 현재 샘플 데이터입니다. Vercel 환경변수에 API_KEY를 설정하면 실시간 데이터가 표시됩니다.
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6 space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
              📍 지역 필터
            </p>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map(r => (
                <button
                  key={r}
                  onClick={() => setSelectedRegion(r)}
                  className={`filter-btn ${selectedRegion === r ? 'filter-btn-active' : 'filter-btn-inactive'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
              📋 진행 상태
            </p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => setSelectedStatus(s)}
                  className={`filter-btn ${selectedStatus === s ? 'filter-btn-active' : 'filter-btn-inactive'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Count */}
        <p className="text-sm text-gray-500 mb-4">
          총 <span className="font-bold text-blue-600">{filtered.length}건</span>의 청약 공고
        </p>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading
            ? Array(6).fill(0).map((_, i) => <SkeletonCard key={i} />)
            : filtered.length > 0
              ? filtered.map(item => <ApartmentCard key={item.id} item={item} />)
              : (
                <div className="col-span-3 text-center py-16 text-gray-400">
                  <div className="text-4xl mb-3">🔍</div>
                  <p>해당 조건의 청약 공고가 없습니다.</p>
                </div>
              )
          }
        </div>
      </div>

      {/* Footer */}
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
