import { NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'
import { getScrapersApps, getCitiesForApps } from '@/lib/scrapers-db'
import type { EntityType } from '@/types'

// All entity types supported by default; refine per-scraper when API docs are available
const ALL_ENTITY_TYPES: EntityType[] = ['dockless', 'docked', 'pricings', 'zones']

export async function POST() {
  try {
    const apps = await getScrapersApps()
    // Use apps.name (not apps.id) as appId — stable across environments

    // Cities are best-effort: if the query fails, sync still completes
    let citiesMap: Map<string, { name: string }[]> = new Map()
    try {
      citiesMap = await getCitiesForApps(apps.map((a) => String(a.app_id)))
      // remap from numeric id key → name key
      const nameById = new Map(apps.map((a) => [String(a.app_id), a.name]))
      const byName = new Map<string, { name: string }[]>()
      for (const [id, cities] of citiesMap) {
        const n = nameById.get(id)
        if (n) byName.set(n, cities)
      }
      citiesMap = byName
    } catch (citiesErr) {
      console.error('[sync] getCitiesForApps failed (cities will be empty):', citiesErr)
    }

    await Promise.all(
      apps.map((app) => {
        const appId  = app.name
        const cities = (citiesMap.get(appId) ?? []).map((c) => c.name)
        return prisma.scraper.upsert({
          where:  { appId },
          update: { name: app.title ?? app.name, cities, lastSyncedAt: new Date() },
          create: {
            appId,
            name: app.title ?? app.name,
            supportedEntityTypes: ALL_ENTITY_TYPES,
            cities,
            lastSyncedAt: new Date(),
          },
        })
      }),
    )

    return NextResponse.json({ synced: apps.length })
  } catch (error) {
    const message = error instanceof Error
      ? `${error.constructor.name}: ${error.message}`
      : String(error)
    console.error('[sync] failed:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
