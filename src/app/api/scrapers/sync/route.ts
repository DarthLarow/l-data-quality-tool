import { NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'
import { getScrapersApps } from '@/lib/scrapers-db'
import type { EntityType } from '@/types'

// All entity types supported by default; refine per-scraper when API docs are available
const ALL_ENTITY_TYPES: EntityType[] = ['dockless', 'docked', 'pricings', 'zones']

export async function POST() {
  try {
    const apps = await getScrapersApps()

    await Promise.all(
      apps.map((app) =>
        prisma.scraper.upsert({
          where: { appId: app.app_id },
          update: {
            name: app.title ?? app.name,
            lastSyncedAt: new Date(),
          },
          create: {
            appId: app.app_id,
            name: app.title ?? app.name,
            supportedEntityTypes: ALL_ENTITY_TYPES,
            lastSyncedAt: new Date(),
          },
        }),
      ),
    )

    return NextResponse.json({ synced: apps.length })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
