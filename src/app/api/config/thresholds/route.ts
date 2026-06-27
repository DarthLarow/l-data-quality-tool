import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  return NextResponse.json(await prisma.alertThreshold.findMany({ orderBy: [{ appId: 'asc' }, { entityType: 'asc' }] }))
}

export async function DELETE(req: NextRequest) {
  const { appId, entityType } = await req.json() as { appId: string; entityType: string }
  await prisma.alertThreshold.deleteMany({ where: { appId, entityType } })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    appId: string
    entityType: string
    warningThresholdPct:  number
    criticalThresholdPct: number
    missingCountWarning?:  number | null
    missingCountCritical?: number | null
    mismatchCountWarning?:  number | null
    mismatchCountCritical?: number | null
  }
  const { appId, entityType, ...data } = body
  const threshold = await prisma.alertThreshold.upsert({
    where:  { appId_entityType: { appId, entityType } },
    update: data,
    create: { appId, entityType, ...data },
  })
  return NextResponse.json(threshold)
}
