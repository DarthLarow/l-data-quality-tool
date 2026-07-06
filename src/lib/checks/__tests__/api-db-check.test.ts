import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/scrapers-db', () => ({
  findEntitiesByIds: vi.fn(async () => new Map()),
}))

import { runApiDbCheck } from '@/lib/checks/api-db-check'
import type { PolygonBounds, ScraperApiAdapter } from '@/lib/checks/adapters/scraper-adapter'
import type { CheckSessionInput, EntityType, ScraperEntity } from '@/types'

const INPUT: CheckSessionInput = {
  environment: 'staging',
  appId: 'test',
  scrapersSessionId: 1,
  polygonIds: [],
  entityTypes: ['dockless'],
  checksEnabled: ['api_db'],
}

function makePolygons(n: number): PolygonBounds[] {
  return Array.from({ length: n }, (_, i) => ({
    polygonId: String(i),
    boundBox: {},
    polygonType: null,
    city: 'Oslo',
  }))
}

/** Adapter that records concurrency and per-polygon call counts. */
class InstrumentedAdapter implements ScraperApiAdapter {
  appId = 'test'
  interPolygonDelayMs = 0
  inFlight = 0
  maxObserved = 0
  calls = new Map<string, number>()

  constructor(public maxConcurrentPolygons: number) {}

  async fetchEntities(polygon: PolygonBounds, _entityType: EntityType): Promise<ScraperEntity[]> {
    this.inFlight++
    this.maxObserved = Math.max(this.maxObserved, this.inFlight)
    this.calls.set(polygon.polygonId, (this.calls.get(polygon.polygonId) ?? 0) + 1)
    await new Promise((r) => setTimeout(r, 5))
    this.inFlight--
    return []
  }
}

describe('runApiDbCheck — worker pool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('never exceeds maxConcurrentPolygons and processes each polygon exactly once', async () => {
    const adapter = new InstrumentedAdapter(4)
    const polygons = makePolygons(20)

    const result = await runApiDbCheck(INPUT, adapter, 'dockless', polygons)

    expect(adapter.maxObserved).toBeLessThanOrEqual(4)
    expect(adapter.maxObserved).toBeGreaterThan(1) // actually ran concurrently
    expect(adapter.calls.size).toBe(20)
    expect([...adapter.calls.values()].every((c) => c === 1)).toBe(true)
    expect(result.polygonResults).toHaveLength(20)
  })

  it('defaults to sequential (concurrency 1) when maxConcurrentPolygons is unset', async () => {
    const adapter = new InstrumentedAdapter(1)
    // Simulate an adapter that didn't opt in.
    delete (adapter as { maxConcurrentPolygons?: number }).maxConcurrentPolygons
    const polygons = makePolygons(6)

    await runApiDbCheck(INPUT, adapter, 'dockless', polygons)

    expect(adapter.maxObserved).toBe(1)
    expect(adapter.calls.size).toBe(6)
  })
})
