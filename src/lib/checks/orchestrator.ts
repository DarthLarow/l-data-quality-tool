import { prisma } from '@/lib/quality-db'
import { runApiDbCheck } from './api-db-check'
import { runDeltaCheck } from './delta-check'
import { compareEntityFields } from './field-compare'
import { findEntitiesByIds, findPreviousScrapersSession, pingScrapersDb, resolvePolygons } from '@/lib/scrapers-db'
import { getAdapterRegistry } from './adapters/scraper-adapter'
import type { CheckSessionInput, EntityType } from '@/types'

export async function runCheckSession(input: CheckSessionInput): Promise<string> {
  try {
    await pingScrapersDb()
  } catch {
    throw new Error('scrapers_db is not reachable')
  }

  const session = await prisma.checkSession.create({
    data: {
      environment:       input.environment,
      appId:             input.appId,
      scrapersSessionId: input.scrapersSessionId,
      polygonIds:        input.polygonIds,
      entityTypes:       input.entityTypes,
      checksEnabled:     input.checksEnabled,
      aiSampleSize:      0, // field kept in DB schema for backwards compat; field compare has no limit
      status:            'running',
      triggeredBy:       'manual',
      totalPolygons:     0,
      completedPolygons: 0,
      progressMessage:   'Preparing…',
    },
  })

  try {
    const checks  = new Set(input.checksEnabled)
    const adapter = getAdapterRegistry().get(input.appId)

    // Auto-detect previous session if delta is enabled but no previous session was provided
    const previousScrapersSessionId =
      input.previousScrapersSessionId ??
      (checks.has('delta')
        ? (await findPreviousScrapersSession(input.scrapersSessionId)) ?? undefined
        : undefined)

    // Resolve polygons once so __random__ always picks the same polygon for all entity types
    const resolvedPolygons = (checks.has('api_db') || checks.has('ai'))
      ? await resolvePolygons(input.appId, input.polygonIds)
      : []

    // Fast, city-level entity types first; dockless (per-tile, two-step) last,
    // so partial results land early while the long crawl is still running.
    const ENTITY_ORDER: Record<EntityType, number> = {
      zones: 0, pricings: 1, docked: 2, dockless: 3,
    }
    const orderedEntityTypes = [...(input.entityTypes as EntityType[])]
      .sort((a, b) => ENTITY_ORDER[a] - ENTITY_ORDER[b])

    // Count how many polygons will actually be processed per entity type
    const polygonCountByType = new Map<EntityType, number>()
    if (adapter && resolvedPolygons.length > 0) {
      for (const et of orderedEntityTypes) {
        const strategy   = adapter.polygonStrategy?.(et) ?? 'all'
        const isCenter   = (p: typeof resolvedPolygons[number]) =>
          p.polygonType?.['is_center'] === 'true' || p.polygonType?.['is_center'] === true
        const centers    = resolvedPolygons.filter(isCenter)
        const effective  = strategy === 'center_only'
          ? (centers.length > 0 ? 1 : 1)
          : resolvedPolygons.length
        polygonCountByType.set(et, effective)
      }
    }
    const totalPolygons = [...polygonCountByType.values()].reduce((s, n) => s + n, 0)

    await prisma.checkSession.update({
      where: { id: session.id },
      data: { totalPolygons, progressMessage: `Starting — ${orderedEntityTypes.length} entity type(s)` },
    })

    // Cumulative counter shared across all progress callbacks — closures capture this
    let cumulativeCompleted = 0
    const updateProgress = async (entityCompleted: number, message: string) => {
      cumulativeCompleted += entityCompleted
      await prisma.checkSession.update({
        where: { id: session.id },
        data: { completedPolygons: cumulativeCompleted, progressMessage: message },
      })
    }

    for (const entityType of orderedEntityTypes) {
      if (checks.has('api_db') || checks.has('ai')) {
        if (!adapter) throw new Error(`No adapter registered for appId: ${input.appId}`)

        const result = await runApiDbCheck(
          input,
          adapter,
          entityType,
          resolvedPolygons,
          (entityCompleted, _total, msg) => updateProgress(entityCompleted, msg),
        )

        if (checks.has('api_db')) {
          // Snapshot completeness counters (generic across two-step adapters):
          // list_only = entity fields came from the list response only (detail
          // cap exceeded); everything else counts as detailed.
          const snapshots     = [...result.apiEntityMap.values()]
          const listOnlyCount = snapshots.filter((e) => e._snapshot === 'list_only').length
          const detailedCount = snapshots.length - listOnlyCount

          await prisma.entityCheckSummary.create({
            data: {
              checkSessionId:    session.id,
              entityType,
              totalUniqueInApi:  result.totalUniqueInApi,
              totalFoundInDb:    result.totalFoundInDb,
              totalNotFoundInDb: result.totalNotFoundInDb,
              failedPolygons:    result.polygonResults.flatMap((p) => p.failedPolygons),
              suspectedBlock:    result.suspectedBlock,
              detailedCount,
              listOnlyCount,
              coverageNote:      adapter.collectionNote?.(entityType) ?? null,
            },
          })

          for (const pr of result.polygonResults) {
            await prisma.polygonCheck.create({
              data: {
                checkSessionId: session.id,
                polygonId:      pr.polygonId,
                entityType,
                apiEntityIds:   pr.apiEntityIds,
                foundInDb:      pr.foundInDb,
                notFoundInDb:   pr.notFoundInDb,
              },
            })
          }
        }

        // Field comparison — all matched entities, no sampling limit
        if (checks.has('ai')) {
          const allFoundIds   = [...new Set(result.polygonResults.flatMap((p) => p.foundInDb))]
          const cityPolygonId = entityType === 'pricings' ? result.polygonResults[0]?.polygonId : undefined
          const dbMap         = await findEntitiesByIds(allFoundIds, entityType, input.appId, input.scrapersSessionId, cityPolygonId)

          for (const entityId of allFoundIds) {
            const dbSnapshot  = dbMap.get(entityId)
            if (!dbSnapshot) continue

            const apiSnapshot  = result.apiEntityMap.get(entityId) ?? { id: entityId }

            // List-only snapshots (two-step adapters beyond their detail cap) lack
            // static fields — field comparison would falsely report 'Different'.
            // Record a neutral 'Skipped' verdict instead. Completeness is unaffected:
            // the entity still counts in the API/DB ID sets.
            if (apiSnapshot._snapshot === 'list_only') {
              await prisma.aiComparison.create({
                data: {
                  checkSessionId: session.id,
                  entityType,
                  entityId,
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  apiSnapshot: JSON.parse(JSON.stringify(apiSnapshot)),
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  dbSnapshot:  JSON.parse(JSON.stringify(dbSnapshot)),
                  verdict:     'Skipped',
                  explanation: 'List-only snapshot (перевищено detail cap) — порівняння полів не виконувалось',
                },
              })
              continue
            }

            const comparison   = compareEntityFields(apiSnapshot, dbSnapshot, entityType, input.appId)

            await prisma.aiComparison.create({
              data: {
                checkSessionId: session.id,
                entityType,
                entityId,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                apiSnapshot: JSON.parse(JSON.stringify(apiSnapshot)),
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                dbSnapshot:  JSON.parse(JSON.stringify(dbSnapshot)),
                verdict:     comparison.verdict,
                explanation: comparison.explanation,
              },
            })
          }
        }
      }

      if (checks.has('delta') && previousScrapersSessionId) {
        const threshold = await prisma.alertThreshold.findUnique({
          where: { appId_entityType: { appId: input.appId, entityType } },
        })

        const result = await runDeltaCheck(
          input.appId,
          input.scrapersSessionId,
          previousScrapersSessionId,
          entityType,
          threshold
            ? { warning: threshold.warningThresholdPct, critical: threshold.criticalThresholdPct }
            : undefined,
        )

        await prisma.sessionDeltaCheck.create({
          data: {
            checkSessionId:            session.id,
            entityType,
            currentScrapersSessionId:  input.scrapersSessionId,
            previousScrapersSessionId: previousScrapersSessionId,
            currentCount:              result.currentCount,
            previousCount:             result.previousCount,
            deltaPercent:              result.deltaPercent,
            deltaFlag:                 result.deltaFlag,
          },
        })
      }
    }

    await prisma.checkSession.update({
      where: { id: session.id },
      data: { status: 'completed' },
    })
  } catch (error) {
    await prisma.checkSession.update({
      where: { id: session.id },
      data: { status: 'failed' },
    })
    throw error
  }

  return session.id
}
