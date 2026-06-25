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

  it('returns empty Map for empty ids array', async () => {
    const { findEntitiesByIds } = await import('@/lib/scrapers-db')
    const result = await findEntitiesByIds([], 'dockless')
    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
  })
})
