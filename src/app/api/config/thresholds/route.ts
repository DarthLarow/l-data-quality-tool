import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  return NextResponse.json(await prisma.alertThreshold.findMany({ orderBy: [{ appId: 'asc' }, { entityType: 'asc' }] }))
}

export async function POST(req: NextRequest) {
  const { appId, entityType, warningThresholdPct, criticalThresholdPct } = await req.json() as {
    appId: string
    entityType: string
    warningThresholdPct: number
    criticalThresholdPct: number
  }
  const threshold = await prisma.alertThreshold.upsert({
    where:  { appId_entityType: { appId, entityType } },
    update: { warningThresholdPct, criticalThresholdPct },
    create: { appId, entityType, warningThresholdPct, criticalThresholdPct },
  })
  return NextResponse.json(threshold)
}
