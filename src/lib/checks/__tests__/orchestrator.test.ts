import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

const aiCreate      = vi.fn((_a: unknown) => {})
const summaryCreate = vi.fn((_a: unknown) => {})
const polyCreate    = vi.fn((_a: unknown) => {})
const sessionCreate = vi.fn(async (_a: unknown) => ({ id: 'sess-1' }))
const sessionUpdate = vi.fn((_a: unknown) => {})

vi.mock('@/lib/quality-db', () => ({
  prisma: {
    checkSession:       { create: (a: unknown) => sessionCreate(a), update: (a: unknown) => sessionUpdate(a) },
    entityCheckSummary: { create: (a: unknown) => summaryCreate(a) },
    polygonCheck:       { create: (a: unknown) => polyCreate(a) },
    aiComparison:       { create: (a: unknown) => aiCreate(a) },
    alertThreshold:     { findUnique: vi.fn() },
  },
}))

const runApiDbCheck = vi.fn<(...a: unknown[]) => unknown>()
vi.mock('../api-db-check', () => ({ runApiDbCheck: (...a: unknown[]) => runApiDbCheck(...a) }))

const compareEntityFields = vi.fn<(...a: unknown[]) => unknown>(() => ({ verdict: 'Same', explanation: 'All fields match', mismatches: [] }))
vi.mock('../field-compare', () => ({ compareEntityFields: (...a: unknown[]) => compareEntityFields(...a) }))

vi.mock('../delta-check', () => ({ runDeltaCheck: vi.fn() }))

const findEntitiesByIds = vi.fn<(...a: unknown[]) => unknown>()
vi.mock('@/lib/scrapers-db', () => ({
  findEntitiesByIds:            (...a: unknown[]) => findEntitiesByIds(...a),
  findPreviousScrapersSession:  vi.fn(),
  pingScrapersDb:               vi.fn(async () => {}),
  resolvePolygons:              vi.fn(async () => [{ polygonId: '1', boundBox: {}, polygonType: null, city: 'Oslo' }]),
}))

vi.mock('../adapters/scraper-adapter', () => ({
  getAdapterRegistry: () => new Map([['ryde', { appId: 'ryde', collectionNote: () => 'note-x' }]]),
}))

import { runCheckSession } from '../orchestrator'
import type { CheckSessionInput } from '@/types'

const INPUT: CheckSessionInput = {
  environment: 'staging',
  appId: 'ryde',
  scrapersSessionId: 1,
  polygonIds: ['1'],
  entityTypes: ['dockless'],
  checksEnabled: ['api_db', 'ai'],
}

describe('runCheckSession — Skipped verdict for list-only snapshots', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records Skipped without calling compareEntityFields for list_only entities', async () => {
    runApiDbCheck.mockResolvedValue({
      entityType: 'dockless',
      totalUniqueInApi: 2,
      totalFoundInDb: 2,
      totalNotFoundInDb: 0,
      notFoundIds: [],
      polygonResults: [{ polygonId: '1', entityType: 'dockless', apiEntityIds: ['A', 'B'], foundInDb: ['A', 'B'], notFoundInDb: [], failedPolygons: [], suspectedBlock: false }],
      apiEntityMap: new Map<string, Record<string, unknown>>([
        ['A', { id: 'A', name: 'full',  _snapshot: 'detailed'  }],
        ['B', { id: 'B', name: null,    _snapshot: 'list_only' }],
      ]),
      suspectedBlock: false,
    })
    findEntitiesByIds.mockResolvedValue(new Map([
      ['A', { vehicle_id: 'A', name: 'full' }],
      ['B', { vehicle_id: 'B', name: 'real-name-in-db' }],
    ]))

    await runCheckSession(INPUT)

    // Two AiComparison rows: A compared normally, B skipped.
    expect(aiCreate).toHaveBeenCalledTimes(2)
    const verdicts = aiCreate.mock.calls.map(([arg]) => (arg as { data: { entityId: string; verdict: string } }).data)
    const a = verdicts.find((v) => v.entityId === 'A')!
    const b = verdicts.find((v) => v.entityId === 'B')!
    expect(a.verdict).toBe('Same')
    expect(b.verdict).toBe('Skipped')

    // compareEntityFields called only for the detailed entity (A), never for B.
    expect(compareEntityFields).toHaveBeenCalledTimes(1)
  })

  it('writes coverage counters and note into the EntityCheckSummary', async () => {
    runApiDbCheck.mockResolvedValue({
      entityType: 'dockless',
      totalUniqueInApi: 2,
      totalFoundInDb: 0,
      totalNotFoundInDb: 2,
      notFoundIds: ['A', 'B'],
      polygonResults: [{ polygonId: '1', entityType: 'dockless', apiEntityIds: ['A', 'B'], foundInDb: [], notFoundInDb: ['A', 'B'], failedPolygons: [], suspectedBlock: false }],
      apiEntityMap: new Map<string, Record<string, unknown>>([
        ['A', { id: 'A', _snapshot: 'detailed'  }],
        ['B', { id: 'B', _snapshot: 'list_only' }],
      ]),
      suspectedBlock: false,
    })
    findEntitiesByIds.mockResolvedValue(new Map())

    await runCheckSession({ ...INPUT, checksEnabled: ['api_db'] })

    expect(summaryCreate).toHaveBeenCalledTimes(1)
    const data = (summaryCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data.detailedCount).toBe(1)
    expect(data.listOnlyCount).toBe(1)
    expect(data.coverageNote).toBe('note-x')
  })
})
