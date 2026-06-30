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

  describe('fetchEntities pricings', () => {
    const mockAccount = {
      email: 'test@example.com', password: 'pw',
      access_token: 'tok', refresh_token: 'ref',
    }

    const bundlesResponse = {
      success: true,
      data: {
        items: [
          {
            id: 'e18ed7df-d1da-4fbe-807a-3128dab532cf',
            title: '24hrs unlimited rides',
            price: '£14.99',
            priceValue: 14.99,
            creditsValue: 1440,
            description: 'Ride as much as you like for 24 hours.',
            metadata: { expirationTimeSeconds: 86400 },
          },
        ],
      },
    }

    const vehicleTypesResponse = {
      status: 'OK',
      data: [
        {
          vehicleTypeId: 1,
          title: 'Forest Bike',
          pricingTime: '£0.33/min',
          pricingParking: '£0.33/min',
          unlockFee: '£1.0',
          pricing: { pricePerMinute: 0.33, pricePerParkingMinute: 0.33, unlockFee: 1.0, currencyCode: 'GBP' },
        },
      ],
    }

    it('returns bundle entities and vehicle-type pricing entities combined', async () => {
      mockGetAccount.mockResolvedValue(mockAccount)
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ status: 200, json: async () => bundlesResponse })
        .mockResolvedValueOnce({ status: 200, json: async () => vehicleTypesResponse }),
      )

      const adapter = new HumanForestScraperApiAdapter()
      const result = await adapter.fetchEntities(MOCK_POLYGON, 'pricings')

      // 1 bundle + 3 vehicle-type rows (unlock, per_minute, parking)
      expect(result).toHaveLength(4)

      const bundle = result.find((r) => r['id'] === 'e18ed7df-d1da-4fbe-807a-3128dab532cf')
      expect(bundle).toBeDefined()
      expect(bundle).toMatchObject({ currency: 'GBP', pricingPlanName: '24hrs unlimited rides' })

      const unlock = result.find((r) => (r['name'] as string) === 'unlock')
      expect(unlock).toBeDefined()
      expect(unlock!['id']).toMatch(/^[0-9a-f-]{36}$/) // uuid format
      expect(unlock).toMatchObject({ amt: 1.0, currency: 'GBP', vehicleType: 'Forest Bike' })

      const parking = result.find((r) => (r['name'] as string) === 'parking')
      expect(parking).toBeDefined()
      expect(parking).toMatchObject({ amt: 0.33, currency: 'GBP' })
    })

    it('throws ApiUnexpectedResponseError when bundles returns success: false', async () => {
      mockGetAccount.mockResolvedValue(mockAccount)
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ status: 200, json: async () => ({ success: false }) }),
      )

      const adapter = new HumanForestScraperApiAdapter()
      await expect(adapter.fetchEntities(MOCK_POLYGON, 'pricings')).rejects.toBeInstanceOf(
        (await import('@/lib/checks/adapters/scraper-adapter')).ApiUnexpectedResponseError,
      )
    })

    it('skips vehicle-type pricing rows where price string has no currency symbol', async () => {
      mockGetAccount.mockResolvedValue(mockAccount)
      const vtNoPrice = {
        status: 'OK',
        data: [{
          vehicleTypeId: 2,
          title: 'Test Bike',
          pricingTime: 'Free',     // no currency symbol → skip
          pricingParking: 'Free',  // no currency symbol → skip
          unlockFee: '£1.0',       // has symbol → include
          pricing: { pricePerMinute: 0, pricePerParkingMinute: 0, unlockFee: 1.0, currencyCode: 'GBP' },
        }],
      }
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ status: 200, json: async () => ({ success: true, data: { items: [] } }) })
        .mockResolvedValueOnce({ status: 200, json: async () => vtNoPrice }),
      )

      const adapter = new HumanForestScraperApiAdapter()
      const result = await adapter.fetchEntities(MOCK_POLYGON, 'pricings')
      expect(result).toHaveLength(1) // only unlock
      expect(result[0]!['name']).toBe('unlock')
    })
  })
})
