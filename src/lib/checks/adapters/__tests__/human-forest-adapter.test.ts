import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HumanForestScraperApiAdapter } from '@/lib/checks/adapters/human-forest-adapter'

vi.mock('@/lib/scrapers-db', () => ({
  getHumanForestAccount: vi.fn(),
  getHumanForestZoneContext: vi.fn(),
}))

import { getHumanForestAccount, getHumanForestZoneContext } from '@/lib/scrapers-db'
const mockGetAccount = vi.mocked(getHumanForestAccount)
const mockGetZoneContext = vi.mocked(getHumanForestZoneContext)

const MOCK_POLYGON = {
  polygonId: '42',
  boundBox:  { south: 51.28, west: -0.51, north: 51.69, east: 0.33 },
  polygonType: null,
  city: 'London',
}

describe('HumanForestScraperApiAdapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when no active account found', async () => {
    mockGetAccount.mockResolvedValue(null)
    const adapter = new HumanForestScraperApiAdapter()
    await expect(adapter.fetchEntities(MOCK_POLYGON, 'dockless')).rejects.toThrow(
      'No active Human Forest account found in scrapers_db',
    )
  })

  describe('fetchEntities dockless', () => {
    it('returns mapped entities with category from vehicle type map', async () => {
      mockGetAccount.mockResolvedValue({
        email: 'test@example.com', password: 'pw',
        access_token: 'tok', refresh_token: 'ref',
      })

      const vehicleTypesResponse = {
        status: 'OK',
        data: [
          { vehicleTypeId: 1, title: 'Forest Bike', pricingTime: '£0.33/min', pricingParking: '£0.33/min', unlockFee: '£1.0', pricing: { pricePerMinute: 0.33, pricePerParkingMinute: 0.33, unlockFee: 1.0, currencyCode: 'GBP' } },
        ],
      }
      const vehiclesResponse = [
        { id: 10203, fuelLevel: 57, lat: 51.507961, lon: -0.140269, vehicleTypeId: 1, vehicleStateId: 0, locationId: 1 },
        { id: 10204, fuelLevel: 30, lat: 51.508000, lon: -0.141000, vehicleTypeId: 99, vehicleStateId: 0, locationId: 1 },
      ]

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ status: 200, json: async () => vehicleTypesResponse })
        .mockResolvedValueOnce({ status: 200, json: async () => vehiclesResponse }),
      )

      const adapter = new HumanForestScraperApiAdapter()
      const result = await adapter.fetchEntities(MOCK_POLYGON, 'dockless')

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: '10203', battery: 57, lat: 51.507961, lon: -0.140269, category: 'Forest Bike' })
      expect(result[1]).toMatchObject({ id: '10204', category: null }) // unknown vehicleTypeId
    })

    it('throws ApiUnexpectedResponseError when vehicle types status is not OK', async () => {
      mockGetAccount.mockResolvedValue({
        email: 'test@example.com', password: 'pw',
        access_token: 'tok', refresh_token: 'ref',
      })
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ status: 200, json: async () => ({ status: 'ERROR', data: [] }) }),
      )

      const adapter = new HumanForestScraperApiAdapter()
      await expect(adapter.fetchEntities(MOCK_POLYGON, 'dockless')).rejects.toBeInstanceOf(
        (await import('@/lib/checks/adapters/scraper-adapter')).ApiUnexpectedResponseError,
      )
    })

    it('throws ApiUnexpectedResponseError when vehicles response is not an array', async () => {
      mockGetAccount.mockResolvedValue({
        email: 'test@example.com', password: 'pw',
        access_token: 'tok', refresh_token: 'ref',
      })
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ status: 200, json: async () => ({ status: 'OK', data: [{ vehicleTypeId: 1, title: 'Forest Bike' }] }) })
        .mockResolvedValueOnce({ status: 200, json: async () => ({ error: 'rate limited' }) }),
      )

      const adapter = new HumanForestScraperApiAdapter()
      await expect(adapter.fetchEntities(MOCK_POLYGON, 'dockless')).rejects.toBeInstanceOf(
        (await import('@/lib/checks/adapters/scraper-adapter')).ApiUnexpectedResponseError,
      )
    })

    it('returns [] for docked entity type', async () => {
      mockGetAccount.mockResolvedValue({
        email: 'test@example.com', password: 'pw',
        access_token: 'tok', refresh_token: 'ref',
      })
      const adapter = new HumanForestScraperApiAdapter()
      const result = await adapter.fetchEntities(MOCK_POLYGON, 'docked')
      expect(result).toEqual([])
    })
  })
})
