import { prisma } from '@/lib/quality-db'
import { runApiDbCheck } from './api-db-check'
import { runDeltaCheck } from './delta-check'
import { compareEntities } from '@/lib/ai/compare'
import { findEntitiesByIds, pingScrapersDb } from '@/lib/scrapers-db'
import { adapterRegistry } from './adapters/scraper-adapter'
import type { CheckSessionInput, EntityType } from '@/types'

function sampleRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n)
}

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
      aiSampleSize:      input.aiSampleSize,
      status:            'running',
      triggeredBy:       'manual',
    },
  })

  try {
    const checks = new Set(input.checksEnabled)
    const adapter = adapterRegistry.get(input.appId)

    for (const entityType of input.entityTypes as EntityType[]) {
      // API fetch is needed for both api_db completeness check and ai comparison
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

        if (checks.has('ai') && input.aiSampleSize > 0) {
          const allFoundIds = result.polygonResults.flatMap((p) => p.foundInDb)
          const sampleIds = sampleRandom([...new Set(allFoundIds)], input.aiSampleSize)

          for (const entityId of sampleIds) {
            const dbMap = await findEntitiesByIds([entityId], entityType, input.appId)
            const dbSnapshot = dbMap.get(entityId)
            if (!dbSnapshot) continue

            const apiSnapshot = result.apiEntityMap.get(entityId) ?? { id: entityId }
            const comparison  = await compareEntities(apiSnapshot, dbSnapshot, entityType, input.appId)

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

      if (checks.has('delta') && input.previousScrapersSessionId) {
        const threshold = await prisma.alertThreshold.findUnique({
          where: { appId_entityType: { appId: input.appId, entityType } },
        })

        const result = await runDeltaCheck(
          input.appId,
          input.scrapersSessionId,
          input.previousScrapersSessionId,
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
            previousScrapersSessionId: input.previousScrapersSessionId,
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
