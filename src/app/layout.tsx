import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '청약홈 요약_MarU',
  description: '아파트 청약 공고, 요약된 정보로 빠르게 확인하세요.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
