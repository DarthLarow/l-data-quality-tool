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
})
