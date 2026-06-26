import { NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  const scrapers = await prisma.scraper.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(scrapers)
}
