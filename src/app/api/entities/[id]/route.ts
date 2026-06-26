import { NextRequest, NextResponse } from 'next/server'
import { findEntitiesByIds } from '@/lib/scrapers-db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const typeParam = req.nextUrl.searchParams.get('type') ?? 'dockless'
  const VALID = ['dockless', 'docked', 'pricings', 'zones'] as const
  const entityType = VALID.includes(typeParam as typeof VALID[number])
    ? (typeParam as typeof VALID[number])
    : 'dockless'
  const provider = req.nextUrl.searchParams.get('provider') ?? undefined
  const map = await findEntitiesByIds([id], entityType, provider)
  const entity = map.get(id)
  if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(entity)
}
