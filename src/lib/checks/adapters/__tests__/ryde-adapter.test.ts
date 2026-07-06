import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RydeScraperApiAdapter } from '@/lib/checks/adapters/ryde-adapter'

vi.mock('@/lib/scrapers-db', () => ({
  getRydeAccount: vi.fn(),
  getRydeCityContext: vi.fn(),
}))

import { getRydeAccount, getRydeCityContext } from '@/lib/scrapers-db'
const mockGetAccount = vi.mocked(getRydeAccount)
const mockGetContext = vi.mocked(getRydeCityContext)

// Two overlapping tiles in the same city, both listing IMEI '111'.
const TILE_A = {
  polygonId: '1',
  boundBox:  { south: 59.9, west: 10.7, north: 59.91, east: 10.71 },
  polygonType: null,
  city: 'Oslo',
}
const TILE_B = {
  polygonId: '2',
  boundBox:  { south: 59.905, west: 10.705, north: 59.915, east: 10.715 },
  polygonType: null,
  city: 'Oslo',
}

// A nearby-vehicles list response containing one scooter (IMEI 111).
const listResponse = {
  scooters: [
    { memberByString: '111', coordinate: { latitude: 59.9, longitude: 10.7 } },
  ],
  ebikes: [],
}

// A detail response for IMEI 111 (lastGps is inverted: "lng,lat;...").
const detailResponse = {
  scooter: { deviceIMEI: '111', code: 'SC-111', sb: '80', lastGps: '10.7,59.9;x' },
}

describe('RydeScraperApiAdapter — cross-tile detail cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccount.mockResolvedValue({ access_token: 'tok' })
    mockGetContext.mockResolvedValue({ city_id: 5, gps_lat: 59.9, gps_lng: 10.7, city_unit: 'NOK' })
  })

  it('does not re-request details for an IMEI already enriched in a previous tile', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const isDetail = String(url).includes('getScooterInfoByCode')
      return { ok: true, status: 200, json: async () => (isDetail ? detailResponse : listResponse) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new RydeScraperApiAdapter()
    adapter.beginRun('dockless')

    const resA = await adapter.fetchEntities(TILE_A, 'dockless')
    const resB = await adapter.fetchEntities(TILE_B, 'dockless')

    // Both tiles report the vehicle (per-polygon completeness unchanged).
    expect(resA).toHaveLength(1)
    expect(resB).toHaveLength(1)
    expect(resA[0]).toMatchObject({ id: '111', name: 'SC-111', battery: 80 })
    expect(resB[0]).toMatchObject({ id: '111', name: 'SC-111', battery: 80 })

    // 2 list requests + exactly 1 detail request (tile B hit the cache).
    const detailCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('getScooterInfoByCode'))
    const listCalls   = fetchMock.mock.calls.filter(([u]) => String(u).includes('getNearScootersNew'))
    expect(listCalls).toHaveLength(2)
    expect(detailCalls).toHaveLength(1)
  })

  it('beginRun resets the cache so a new run re-fetches details', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const isDetail = String(url).includes('getScooterInfoByCode')
      return { ok: true, status: 200, json: async () => (isDetail ? detailResponse : listResponse) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new RydeScraperApiAdapter()

    adapter.beginRun('dockless')
    await adapter.fetchEntities(TILE_A, 'dockless')

    adapter.beginRun('dockless') // new run → cache cleared
    await adapter.fetchEntities(TILE_A, 'dockless')

    const detailCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('getScooterInfoByCode'))
    expect(detailCalls).toHaveLength(2)
  })
})

describe('RydeScraperApiAdapter — _snapshot completeness flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccount.mockResolvedValue({ access_token: 'tok' })
    mockGetContext.mockResolvedValue({ city_id: 5, gps_lat: 59.9, gps_lng: 10.7, city_unit: 'NOK' })
  })

  it('marks entities within the detail cap "detailed" and beyond it "list_only"', async () => {
    // 55 scooters in the list → first 50 get details, remaining 5 are list-only.
    const many = Array.from({ length: 55 }, (_, i) => ({
      memberByString: `imei-${i}`,
      coordinate: { latitude: 59.9 + i * 1e-5, longitude: 10.7 + i * 1e-5 },
    }))
    const bigList = { scooters: many, ebikes: [] }

    const fetchMock = vi.fn(async (url: string, opts: { body?: string }) => {
      if (String(url).includes('getScooterInfoByCode')) {
        // Echo back the requested IMEI so each detail is unique and valid.
        const imei = new URLSearchParams(opts.body).get('deviceIMEI')!
        return { ok: true, status: 200, json: async () => ({
          scooter: { deviceIMEI: imei, code: `code-${imei}`, sb: '80', lastGps: '10.7,59.9;x' },
        }) }
      }
      return { ok: true, status: 200, json: async () => bigList }
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new RydeScraperApiAdapter()
    adapter.beginRun('dockless')
    const result = await adapter.fetchEntities(TILE_A, 'dockless')

    expect(result).toHaveLength(55)
    const detailed = result.filter((e) => e._snapshot === 'detailed')
    const listOnly = result.filter((e) => e._snapshot === 'list_only')
    expect(detailed).toHaveLength(50)
    expect(listOnly).toHaveLength(5)

    // Only 50 detail requests were made (cap), matching the detailed count.
    const detailCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('getScooterInfoByCode'))
    expect(detailCalls).toHaveLength(50)
  }, 15_000) // 50 detail requests × 150ms inter-detail delay ≈ 7.5s

  it('exposes a collectionNote for dockless and none for other types', () => {
    const adapter = new RydeScraperApiAdapter()
    expect(adapter.collectionNote('dockless')).toContain('list-only')
    expect(adapter.collectionNote('zones')).toBeNull()
  })
})
