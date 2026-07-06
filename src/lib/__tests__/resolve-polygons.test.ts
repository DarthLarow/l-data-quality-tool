import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted runs before vi.mock and module imports — refs are available in both
const { mockClientQuery, mockRelease } = vi.hoisted(() => ({
  mockClientQuery: vi.fn(),
  mockRelease:     vi.fn(),
}))

vi.mock('pg', () => {
  // Must use regular function so it can be called with `new Pool(...)`
  function Pool(this: Record<string, unknown>) {
    this.connect = vi.fn().mockResolvedValue({ query: mockClientQuery, release: mockRelease })
    this.on      = vi.fn()          // error handler registration
    this.end     = vi.fn().mockResolvedValue(undefined)
  }
  return { Pool }
})

import { resolvePolygons } from '@/lib/scrapers-db'

const makeRow = (id: string, city = 'Cairns') => ({
  id,
  bound_box: null,
  polygon_type: { type: 'point', lat: -16.93, lon: 145.77 },
  city,
})

beforeEach(() => {
  mockClientQuery.mockReset()
  mockRelease.mockReset()
})

describe('resolvePolygons', () => {
  it('direct ID — returns the matching polygon', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makeRow('poly-123')] })
    const result = await resolvePolygons('ario', ['poly-123'])
    expect(result).toHaveLength(1)
    expect(result[0]!.polygonId).toBe('poly-123')
  })

  it('direct ID — returns [] when polygon not found', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] })
    const result = await resolvePolygons('ario', ['nonexistent'])
    expect(result).toHaveLength(0)
  })

  it('__random__ — returns one polygon', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makeRow('rand-1')] })
    const result = await resolvePolygons('ario', ['__random__'])
    expect(result).toHaveLength(1)
    expect(result[0]!.polygonId).toBe('rand-1')
  })

  it('__random__ — returns [] when no polygons exist for app', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] })
    const result = await resolvePolygons('ario', ['__random__'])
    expect(result).toHaveLength(0)
  })

  it('__city_by_city_all__:Cairns — returns all polygons for that city', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makeRow('p1'), makeRow('p2'), makeRow('p3')] })
    const result = await resolvePolygons('ario', ['__city_by_city_all__:Cairns'])
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.polygonId)).toEqual(['p1', 'p2', 'p3'])
  })

  it('__city_by_city_random__:Singapore — returns exactly one polygon', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makeRow('rand-sg', 'Singapore')] })
    const result = await resolvePolygons('ario', ['__city_by_city_random__:Singapore'])
    expect(result).toHaveLength(1)
    expect(result[0]!.city).toBe('Singapore')
  })

  it('mixed sentinels — resolves each independently', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [makeRow('rand-x')] })   // __random__
      .mockResolvedValueOnce({ rows: [makeRow('direct-y')] }) // direct ID
    const result = await resolvePolygons('ario', ['__random__', 'direct-y'])
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.polygonId)).toEqual(['rand-x', 'direct-y'])
  })

  it('polygonType is passed through as JSONB object, not string', async () => {
    const pt = { type: 'point', lat: -16.93, lon: 145.77 }
    mockClientQuery.mockResolvedValueOnce({ rows: [{ ...makeRow('p1'), polygon_type: pt }] })
    const result = await resolvePolygons('ario', ['p1'])
    expect(result[0]!.polygonType).toEqual(pt)
    expect(typeof result[0]!.polygonType).toBe('object')
  })

  it('empty polygonIds — returns [] without querying DB', async () => {
    const result = await resolvePolygons('ario', [])
    expect(result).toHaveLength(0)
    expect(mockClientQuery).not.toHaveBeenCalled()
  })
})
