import { findEntitiesByIds, getPolygonBounds } from '@/lib/scrapers-db'
import type { ScraperApiAdapter } from './adapters/scraper-adapter'
import type { CheckSessionInput, EntityType, ApiDbCheckResult, PolygonCheckResult } from '@/types'

export async function runApiDbCheck(
  input: CheckSessionInput,
  adapter: ScraperApiAdapter,
  entityType: EntityType,
): Promise<ApiDbCheckResult> {
  const polygonResults: PolygonCheckResult[] = []
  const allApiIds = new Set<string>()

  for (const polygonId of input.polygonIds) {
    const bounds = await getPolygonBounds(polygonId) ?? { polygonId, boundBox: null }
    const entities = await adapter.fetchEntities(bounds, entityType)
    const apiEntityIds = entities.map((e) => e.id)
    apiEntityIds.forEach((id) => allApiIds.add(id))

    const foundMap = await findEntitiesByIds(apiEntityIds, entityType)
    const foundInDb    = apiEntityIds.filter((id) => foundMap.has(id))
    const notFoundInDb = apiEntityIds.filter((id) => !foundMap.has(id))

    polygonResults.push({ polygonId, entityType, apiEntityIds, foundInDb, notFoundInDb })
  }

  const uniqueIds = Array.from(allApiIds)
  const foundMap  = await findEntitiesByIds(uniqueIds, entityType)
  const notFoundIds = uniqueIds.filter((id) => !foundMap.has(id))

  return {
    entityType,
    totalUniqueInApi:  uniqueIds.length,
    totalFoundInDb:    foundMap.size,
    totalNotFoundInDb: notFoundIds.length,
    notFoundIds,
    polygonResults,
  }
}
