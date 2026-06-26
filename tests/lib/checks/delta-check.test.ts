import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/scrapers-db', () => ({
  countEntitiesForSession: vi.fn()
    .mockResolvedValueOnce(100)   // currentCount
    .mockResolvedValueOnce(1000), // previousCount
}))

describe('calculateDeltaFlag', () => {
  it('returns ok when change is within warning threshold', async () => {
    const { calculateDeltaFlag } = await import('@/lib/checks/delta-check')
    expect(calculateDeltaFlag(5)).toBe('ok')
  })

  it('returns warning when change exceeds 20%', async () => {
    const { calculateDeltaFlag } = await import('@/lib/checks/delta-check')
    expect(calculateDeltaFlag(25)).toBe('warning')
  })

  it('returns critical when change exceeds 50%', async () => {
    const { calculateDeltaFlag } = await import('@/lib/checks/delta-check')
    expect(calculateDeltaFlag(75)).toBe('critical')
  })

  it('uses absolute value — negative delta treated same as positive', async () => {
    const { calculateDeltaFlag } = await import('@/lib/checks/delta-check')
    expect(calculateDeltaFlag(-75)).toBe('critical')
    expect(calculateDeltaFlag(-25)).toBe('warning')
    expect(calculateDeltaFlag(-5)).toBe('ok')
  })

  it('uses custom thresholds when provided', async () => {
    const { calculateDeltaFlag } = await import('@/lib/checks/delta-check')
    expect(calculateDeltaFlag(15, { warning: 10, critical: 30 })).toBe('warning')
  })
})

describe('runDeltaCheck', () => {
  it('calculates deltaPercent and flag correctly', async () => {
    const { runDeltaCheck } = await import('@/lib/checks/delta-check')
    const result = await runDeltaCheck('lime', 2, 1, 'dockless')
    // 100 now, 1000 before → -90%
    expect(result.deltaPercent).toBeCloseTo(-90)
    expect(result.deltaFlag).toBe('critical')
    expect(result.currentCount).toBe(100)
    expect(result.previousCount).toBe(1000)
  })
})
