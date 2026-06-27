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
    throw new Error('scrapers_db is not reachable — activate port-forward first (npm run scrapers-db:stage or :prod)')
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
    for (const entityType of input.entityTypes as EntityType[]) {
      if (input.checksEnabled.includes('api_db')) {
        const adapter = adapterRegistry.get(input.appId)
        if (!adapter) throw new Error(`No adapter registered for appId: ${input.appId}`)

        const result = await runApiDbCheck(input, adapter, entityType)

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

        // AI comparison on a random sample of found entities
        const allFoundIds = result.polygonResults.flatMap((p) => p.foundInDb)
        const sampleIds = sampleRandom([...new Set(allFoundIds)], input.aiSampleSize)

        for (const entityId of sampleIds) {
          const dbMap = await findEntitiesByIds([entityId], entityType, input.appId)
          const dbSnapshot = dbMap.get(entityId)
          if (!dbSnapshot) continue

          const apiSnapshot = result.apiEntityMap.get(entityId) ?? { id: entityId }

          const comparison = await compareEntities(apiSnapshot, dbSnapshot, entityType)

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

      if (input.checksEnabled.includes('delta') && input.previousScrapersSessionId) {
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
