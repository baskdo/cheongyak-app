import { NextResponse } from 'next/server'

export async function GET() {
  const key1 = process.env.API_KEY
  const key2 = process.env.API_KEY2
  
  return NextResponse.json({
    hasKey1: !!key1,
    hasKey2: !!key2,
    key1Preview: key1 ? key1.substring(0, 10) + '...' : 'MISSING',
    key2Preview: key2 ? key2.substring(0, 10) + '...' : 'MISSING',
  })
}
