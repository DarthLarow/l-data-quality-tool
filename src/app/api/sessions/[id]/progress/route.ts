import { prisma } from '@/lib/quality-db'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await prisma.checkSession.findUnique({
    where: { id },
    select: {
      id:                true,
      status:           true,
      totalPolygons:    true,
      completedPolygons: true,
      progressMessage:  true,
    },
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json({
    id:                session.id,
    status:            session.status,
    totalPolygons:     session.totalPolygons,
    completedPolygons: session.completedPolygons,
    progressMessage:   session.progressMessage ?? null,
  })
}
