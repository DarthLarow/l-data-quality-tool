import { NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  const sessions = await prisma.checkSession.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      entityCheckSummaries: true,
      sessionDeltaChecks:   true,
    },
  })
  return NextResponse.json(sessions)
}
