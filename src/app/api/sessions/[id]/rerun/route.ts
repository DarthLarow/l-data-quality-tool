import { NextRequest, NextResponse } from 'next/server'
import { prisma }           from '@/lib/quality-db'
import { runCheckSession }  from '@/lib/checks/orchestrator'
import type { CheckType, EntityType, Environment } from '@/types'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const session = await prisma.checkSession.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Delete current session — cascades to all result tables
  await prisma.checkSession.delete({ where: { id } })

  // Re-run with the same parameters
  const newId = await runCheckSession({
    environment:       session.environment as Environment,
    appId:             session.appId,
    scrapersSessionId: session.scrapersSessionId,
    polygonIds:        session.polygonIds,
    entityTypes:       session.entityTypes as EntityType[],
    checksEnabled:     session.checksEnabled as CheckType[],
    aiSampleSize:      session.aiSampleSize,
  })

  return NextResponse.json({ sessionId: newId })
}
