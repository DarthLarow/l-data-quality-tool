import { NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  const scrapers = await prisma.scraper.findMany({
    where: { isActive: true },
    include: {
      checkSessions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          entityCheckSummaries: true,
          aiComparisons: { select: { verdict: true } },
          sessionDeltaChecks: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(scrapers)
}
