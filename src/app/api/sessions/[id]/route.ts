import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

// Next.js 15+: params is a Promise
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await prisma.checkSession.findUnique({
    where: { id },
    include: {
      entityCheckSummaries: true,
      polygonChecks:        true,
      sessionDeltaChecks:   true,
      aiComparisons:        true,
    },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(session)
}
