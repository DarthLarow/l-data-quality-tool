import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET(req: NextRequest) {
  const url  = new URL(req.url)
  const days = parseInt(url.searchParams.get('days') ?? '7', 10)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const scrapers = await prisma.scraper.findMany({
    where: { isActive: true },
    include: {
      checkSessions: {
        where:   { createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        include: {
          entityCheckSummaries: true,
          sessionDeltaChecks:   true,
          aiComparisons:        true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(scrapers)
}
