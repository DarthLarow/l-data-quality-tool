import { findEntitiesByIds, resolvePolygons } from '@/lib/scrapers-db'
import type { ScraperApiAdapter } from './adapters/scraper-adapter'
import { ApiUnexpectedResponseError } from './adapters/scraper-adapter'
import type { CheckSessionInput, EntityType, ApiDbCheckResult, PolygonCheckResult, ScraperEntity } from '@/types'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function runApiDbCheck(
  input: CheckSessionInput,
  adapter: ScraperApiAdapter,
  entityType: EntityType,
): Promise<ApiDbCheckResult> {
  const polygonResults: PolygonCheckResult[] = []
  const allApiIds = new Set<string>()
  const apiEntityMap = new Map<string, Record<string, unknown>>()

  const allPolygons = await resolvePolygons(input.appId, input.polygonIds)
  const strategy = adapter.polygonStrategy?.(entityType) ?? 'all'
  const centerPolygons = allPolygons.filter(
    (p) => p.polygonType?.['is_center'] === 'true' || p.polygonType?.['is_center'] === true,
  )
  const polygons = strategy === 'center_only'
    ? (centerPolygons.length > 0 ? centerPolygons.slice(0, 1) : allPolygons.slice(0, 1))
    : allPolygons

  for (const [i, bounds] of polygons.entries()) {

    // Inter-polygon delay (skip for first polygon)
    if (i > 0) {
      const baseDelay = adapter.interPolygonDelayMs ?? 500
      await sleep(baseDelay + Math.random() * baseDelay * 0.5)
    }

    // Fetch with one retry on ApiUnexpectedResponseError
    let entities: ScraperEntity[] = []
    let polygonFailed = false
    try {
      entities = await adapter.fetchEntities(bounds, entityType)
    } catch (err) {
      if (err instanceof ApiUnexpectedResponseError) {
        // Retry once after 5 seconds
        await sleep(5000)
        try {
          entities = await adapter.fetchEntities(bounds, entityType)
        } catch (retryErr) {
          if (retryErr instanceof ApiUnexpectedResponseError) {
            polygonFailed = true
            entities = []
          } else {
            throw retryErr
          }
        }
      } else {
        throw err // Non-block errors propagate
      }
    }

    if (polygonFailed) {
      polygonResults.push({
        polygonId: bounds.polygonId,
        entityType,
        apiEntityIds: [],
        foundInDb: [],
        notFoundInDb: [],
        failedPolygons: [bounds.polygonId],
        suspectedBlock: true,
      })
      continue
    }

    // Normal path
    const apiEntityIds = entities.map((e) => e.id)
    for (const entity of entities) {
      allApiIds.add(entity.id)
      apiEntityMap.set(entity.id, entity as Record<string, unknown>)
    }

    const foundMap = await findEntitiesByIds(apiEntityIds, entityType, input.appId, input.scrapersSessionId)
    const foundInDb    = apiEntityIds.filter((id) => foundMap.has(id))
    const notFoundInDb = apiEntityIds.filter((id) => !foundMap.has(id))

    polygonResults.push({
      polygonId: bounds.polygonId,
      entityType,
      apiEntityIds,
      foundInDb,
      notFoundInDb,
      failedPolygons: [],
      suspectedBlock: false,
    })
  }

  const uniqueIds = Array.from(allApiIds)
  const foundMap  = await findEntitiesByIds(uniqueIds, entityType, input.appId, input.scrapersSessionId)
  const notFoundIds = uniqueIds.filter((id) => !foundMap.has(id))

  return {
    entityType,
    totalUniqueInApi:  uniqueIds.length,
    totalFoundInDb:    foundMap.size,
    totalNotFoundInDb: notFoundIds.length,
    notFoundIds,
    polygonResults,
    apiEntityMap,
    suspectedBlock: polygonResults.some((r) => r.suspectedBlock),
  }
}
