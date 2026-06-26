import { describe, it, expect, vi } from 'vitest'
import { MockScraperApiAdapter } from '@/lib/checks/adapters/mock-adapter'
import type { CheckSessionInput } from '@/types'

vi.mock('@/lib/scrapers-db', () => ({
  findEntitiesByIds: vi.fn().mockImplementation(async (ids: string[]) => {
    const map = new Map()
    if (ids.includes('id-1')) map.set('id-1', { vehicle_id: 'id-1' })
    if (ids.includes('id-2')) map.set('id-2', { vehicle_id: 'id-2' })
    return map
  }),
  resolvePolygons: vi.fn().mockImplementation(async (_appId: string, polygonIds: string[]) =>
    polygonIds.map((pid) => ({ polygonId: pid, boundBox: null, polygonType: null, city: null })),
  ),
}))

const baseInput: CheckSessionInput = {
  environment: 'staging',
  appId: 'mock',
  scrapersSessionId: 1,
  polygonIds: ['poly-1'],
  entityTypes: ['dockless'],
  checksEnabled: ['api_db'],
  aiSampleSize: 5,
}

describe('runApiDbCheck', () => {
  it('counts found and not-found entities correctly', async () => {
    const { runApiDbCheck } = await import('@/lib/checks/api-db-check')
    const adapter = new MockScraperApiAdapter('mock', [
      { id: 'id-1' }, { id: 'id-2' }, { id: 'id-3' },
    ])
    const result = await runApiDbCheck(baseInput, adapter, 'dockless')
    expect(result.totalUniqueInApi).toBe(3)
    expect(result.totalFoundInDb).toBe(2)
    expect(result.totalNotFoundInDb).toBe(1)
    expect(result.notFoundIds).toEqual(['id-3'])
  })

  it('deduplicates entities across multiple polygons', async () => {
    const { runApiDbCheck } = await import('@/lib/checks/api-db-check')
    const input = { ...baseInput, polygonIds: ['poly-1', 'poly-2'] }
    const adapter = new MockScraperApiAdapter('mock', [{ id: 'id-1' }])
    const result = await runApiDbCheck(input, adapter, 'dockless')
    expect(result.totalUniqueInApi).toBe(1)
  })

  it('returns correct polygon-level breakdown', async () => {
    const { runApiDbCheck } = await import('@/lib/checks/api-db-check')
    const adapter = new MockScraperApiAdapter('mock', [{ id: 'id-1' }, { id: 'id-3' }])
    const result = await runApiDbCheck(baseInput, adapter, 'dockless')
    expect(result.polygonResults).toHaveLength(1)
    expect(result.polygonResults[0]?.foundInDb).toContain('id-1')
    expect(result.polygonResults[0]?.notFoundInDb).toContain('id-3')
  })
})
