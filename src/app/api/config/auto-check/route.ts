import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  return NextResponse.json(await prisma.autoCheckConfig.findMany({ orderBy: { appId: 'asc' } }))
}

export async function POST(req: NextRequest) {
  const data = await req.json() as {
    appId: string
    environment: string
    entityTypes: string[]
    checksEnabled: string[]
    aiSampleSize: number
    polygonStrategy: string
    isActive: boolean
  }
  const config = await prisma.autoCheckConfig.upsert({
    where:  { appId: data.appId },
    update: data,
    create: data,
  })
  return NextResponse.json(config)
}
