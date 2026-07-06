import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET(req: NextRequest) {
  const appId = req.nextUrl.searchParams.get('appId')
  // ?appId= returns a single config (or null) — used by the session form to
  // prefill fields from a scraper's saved auto-check configuration.
  if (appId) {
    return NextResponse.json(await prisma.autoCheckConfig.findUnique({ where: { appId } }))
  }
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
    polygonCity: string | null
    isActive: boolean
  }
  const config = await prisma.autoCheckConfig.upsert({
    where:  { appId: data.appId },
    update: data,
    create: data,
  })
  return NextResponse.json(config)
}
