import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

async function main() {
  const scraper = await prisma.scraper.upsert({
    where:  { appId: 'test-scraper' },
    update: {},
    create: {
      appId:                'test-scraper',
      name:                 'Test Scraper',
      supportedEntityTypes: ['dockless', 'docked'],
      isActive:             true,
    },
  })

  const session = await prisma.checkSession.create({
    data: {
      environment:    'staging',
      appId:          'test-scraper',
      scrapersSessionId: 1001,
      polygonIds:     ['poly-1'],
      entityTypes:    ['dockless'],
      checksEnabled:  ['api_db', 'delta'],
      aiSampleSize:   3,
      status:         'completed',
      triggeredBy:    'manual',
    },
  })

  await prisma.entityCheckSummary.create({
    data: {
      checkSessionId:    session.id,
      entityType:        'dockless',
      totalUniqueInApi:  150,
      totalFoundInDb:    145,
      totalNotFoundInDb: 5,
    },
  })

  await prisma.polygonCheck.create({
    data: {
      checkSessionId: session.id,
      polygonId:      'poly-1',
      entityType:     'dockless',
      apiEntityIds:   ['ent-1', 'ent-2', 'ent-3'],
      notFoundInDb:   ['ent-missing-1'],
    },
  })

  await prisma.sessionDeltaCheck.create({
    data: {
      checkSessionId:            session.id,
      entityType:                'dockless',
      currentScrapersSessionId:  1001,
      previousScrapersSessionId: 1000,
      currentCount:              150,
      previousCount:             160,
      deltaPercent:              -6.25,
      deltaFlag:                 'ok',
    },
  })

  await prisma.aiComparison.createMany({
    data: [
      {
        checkSessionId: session.id,
        entityType:     'dockless',
        entityId:       'ent-1',
        apiSnapshot:    { id: 'ent-1', lat: 50.1, lng: 30.2 },
        dbSnapshot:     { id: 'ent-1', lat: 50.11, lng: 30.21 },
        verdict:        'Same',
        explanation:    'Minor coordinate drift within city bounds.',
      },
      {
        checkSessionId: session.id,
        entityType:     'dockless',
        entityId:       'ent-2',
        apiSnapshot:    { id: 'ent-2', name: 'Scooter A' },
        dbSnapshot:     { id: 'ent-2', name: 'Scooter B' },
        verdict:        'Different',
        explanation:    'Name field does not match.',
      },
    ],
  })

  await prisma.alertThreshold.upsert({
    where:  { appId_entityType: { appId: 'test-scraper', entityType: 'dockless' } },
    update: {},
    create: {
      appId:                'test-scraper',
      entityType:           'dockless',
      warningThresholdPct:  20,
      criticalThresholdPct: 50,
    },
  })

  console.log('Seed complete:', { scraperId: scraper.id, sessionId: session.id })
}

main().finally(() => prisma.$disconnect())
