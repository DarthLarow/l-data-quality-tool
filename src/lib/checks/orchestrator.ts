import { prisma } from '@/lib/quality-db'
import { runApiDbCheck } from './api-db-check'
import { runDeltaCheck } from './delta-check'
import { compareEntityFields } from './field-compare'
import { findEntitiesByIds, findPreviousScrapersSession, pingScrapersDb } from '@/lib/scrapers-db'
import { adapterRegistry } from './adapters/scraper-adapter'
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
    },
  })

  try {
    const checks  = new Set(input.checksEnabled)
    const adapter = adapterRegistry.get(input.appId)

    // Auto-detect previous session if delta is enabled but no previous session was provided
    const previousScrapersSessionId =
      input.previousScrapersSessionId ??
      (checks.has('delta')
        ? (await findPreviousScrapersSession(input.scrapersSessionId)) ?? undefined
        : undefined)

    for (const entityType of input.entityTypes as EntityType[]) {
      if (checks.has('api_db') || checks.has('ai')) {
        if (!adapter) throw new Error(`No adapter registered for appId: ${input.appId}`)

        const result = await runApiDbCheck(input, adapter, entityType)

        if (checks.has('api_db')) {
          await prisma.entityCheckSummary.create({
            data: {
              checkSessionId:    session.id,
              entityType,
              totalUniqueInApi:  result.totalUniqueInApi,
              totalFoundInDb:    result.totalFoundInDb,
              totalNotFoundInDb: result.totalNotFoundInDb,
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
          const allFoundIds = [...new Set(result.polygonResults.flatMap((p) => p.foundInDb))]
          const dbMap       = await findEntitiesByIds(allFoundIds, entityType, input.appId)

          for (const entityId of allFoundIds) {
            const dbSnapshot  = dbMap.get(entityId)
            if (!dbSnapshot) continue

            const apiSnapshot  = result.apiEntityMap.get(entityId) ?? { id: entityId }
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
