import { findEntitiesByIds } from '@/lib/scrapers-db'
import type { PolygonBounds } from '@/lib/scrapers-db'
import type { ScraperApiAdapter } from './adapters/scraper-adapter'
import { ApiUnexpectedResponseError } from './adapters/scraper-adapter'
import type { CheckSessionInput, EntityType, ApiDbCheckResult, PolygonCheckResult, ScraperEntity } from '@/types'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function runApiDbCheck(
  input: CheckSessionInput,
  adapter: ScraperApiAdapter,
  entityType: EntityType,
  allPolygons: PolygonBounds[],
): Promise<ApiDbCheckResult> {
  const polygonResults: PolygonCheckResult[] = []
  const allApiIds = new Set<string>()
  const apiEntityMap = new Map<string, Record<string, unknown>>()

  const strategy = adapter.polygonStrategy?.(entityType) ?? 'all'
  const centerPolygons = allPolygons.filter(
    (p) => p.polygonType?.['is_center'] === 'true' || p.polygonType?.['is_center'] === true,
  )
  const polygons = strategy === 'center_only'
    ? (centerPolygons.length > 0 ? centerPolygons.slice(0, 1) : allPolygons.slice(0, 1))
    : allPolygons

  // Process one polygon: fetch (with one retry), match against DB, record result.
  // Shared structures are mutated only in synchronous sections (no await between
  // read and write), so they are safe under the single-threaded event loop even
  // when multiple workers run concurrently.
  const processPolygon = async (bounds: PolygonBounds): Promise<void> => {
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
      return
    }

    // Normal path
    const apiEntityIds = entities.map((e) => e.id)
    for (const entity of entities) {
      allApiIds.add(entity.id)
      apiEntityMap.set(entity.id, entity as Record<string, unknown>)
    }

    const cityPolygonId = entityType === 'pricings' ? bounds.polygonId : undefined
    const foundMap = await findEntitiesByIds(apiEntityIds, entityType, input.appId, input.scrapersSessionId, cityPolygonId)
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

  // Worker pool: `workers` polygons in flight at once (default 1 = sequential).
  // Each worker keeps the inter-polygon delay between its own requests, so the
  // global request rate scales with worker count but the per-worker pacing (and
  // the scraper-friendly jitter) is unchanged. Result order becomes
  // non-deterministic — aggregates and PolygonCheck rows don't depend on it.
  const workers   = Math.max(1, adapter.maxConcurrentPolygons ?? 1)
  const baseDelay = adapter.interPolygonDelayMs ?? 500
  let next = 0

  adapter.beginRun?.(entityType)
  try {
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (true) {
          const i = next++
          if (i >= polygons.length) break
          // First `workers` polygons start immediately; the rest are paced.
          if (i >= workers) await sleep(baseDelay + Math.random() * baseDelay * 0.5)
          await processPolygon(polygons[i]!)
        }
      }),
    )
  } finally {
    adapter.endRun?.(entityType)
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
