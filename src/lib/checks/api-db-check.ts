import { findEntitiesByIds, resolvePolygons } from '@/lib/scrapers-db'
import type { ScraperApiAdapter } from './adapters/scraper-adapter'
import type { CheckSessionInput, EntityType, ApiDbCheckResult, PolygonCheckResult } from '@/types'

export async function runApiDbCheck(
  input: CheckSessionInput,
  adapter: ScraperApiAdapter,
  entityType: EntityType,
): Promise<ApiDbCheckResult> {
  const polygonResults: PolygonCheckResult[] = []
  const allApiIds = new Set<string>()
  const apiEntityMap = new Map<string, Record<string, unknown>>()

  const polygons = await resolvePolygons(input.appId, input.polygonIds)
  for (const bounds of polygons) {
    const entities = await adapter.fetchEntities(bounds, entityType)
    const apiEntityIds = entities.map((e) => e.id)
    for (const entity of entities) {
      allApiIds.add(entity.id)
      apiEntityMap.set(entity.id, entity as Record<string, unknown>)
    }

    const foundMap = await findEntitiesByIds(apiEntityIds, entityType, input.appId)
    const foundInDb    = apiEntityIds.filter((id) => foundMap.has(id))
    const notFoundInDb = apiEntityIds.filter((id) => !foundMap.has(id))

    polygonResults.push({ polygonId: bounds.polygonId, entityType, apiEntityIds, foundInDb, notFoundInDb })
  }

  const uniqueIds = Array.from(allApiIds)
  const foundMap  = await findEntitiesByIds(uniqueIds, entityType, input.appId)
  const notFoundIds = uniqueIds.filter((id) => !foundMap.has(id))

  return {
    entityType,
    totalUniqueInApi:  uniqueIds.length,
    totalFoundInDb:    foundMap.size,
    totalNotFoundInDb: notFoundIds.length,
    notFoundIds,
    polygonResults,
    apiEntityMap,
  }
}
