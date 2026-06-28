import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const scraper = searchParams.get('scraper')
  const status  = searchParams.get('status')
  const days    = parseInt(searchParams.get('days') ?? '0', 10)
  const from    = searchParams.get('from')
  const to      = searchParams.get('to')

  const since = days > 0
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    : from ? new Date(from)
    : undefined

  const until = to ? new Date(to + 'T23:59:59.999Z') : undefined

  const sessions = await prisma.checkSession.findMany({
    where: {
      ...(scraper                    ? { appId: scraper }                            : {}),
      ...(status && status !== 'all' ? { status }                                   : {}),
      ...(since || until             ? { createdAt: { gte: since, lte: until } }    : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      entityCheckSummaries: true,
      aiComparisons: { select: { verdict: true } },
      scraper: { select: { name: true } },
    },
  })

  return NextResponse.json(sessions)
}
