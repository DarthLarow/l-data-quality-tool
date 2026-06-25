import { describe, it, expect } from 'vitest'

describe('countEntitiesForSession', () => {
  it('exports countEntitiesForSession as a function', async () => {
    const { countEntitiesForSession } = await import('@/lib/scrapers-db')
    expect(typeof countEntitiesForSession).toBe('function')
  })
})

describe('findEntitiesByIds', () => {
  it('exports findEntitiesByIds as a function', async () => {
    const { findEntitiesByIds } = await import('@/lib/scrapers-db')
    expect(typeof findEntitiesByIds).toBe('function')
  })

  it('returns empty Map for empty ids array (no DB call needed)', async () => {
    const { findEntitiesByIds } = await import('@/lib/scrapers-db')
    const result = await findEntitiesByIds([], 'dockless')
    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
  })
})

describe('getPolygonBounds', () => {
  it('exports getPolygonBounds as a function', async () => {
    const { getPolygonBounds } = await import('@/lib/scrapers-db')
    expect(typeof getPolygonBounds).toBe('function')
  })
})

describe('getScrapersApps', () => {
  it('exports getScrapersApps as a function', async () => {
    const { getScrapersApps } = await import('@/lib/scrapers-db')
    expect(typeof getScrapersApps).toBe('function')
  })
})
