import { describe, it, expect, vi, beforeEach } from 'vitest'

// Controllable pg mock: each new Pool() pulls the next connect() behaviour from
// a queue, so we can simulate a dropped port-forward then a recovery.
const { connectQueue, endSpy } = vi.hoisted(() => ({
  connectQueue: [] as Array<() => Promise<unknown>>,
  endSpy: vi.fn(),
}))

vi.mock('pg', () => {
  function Pool(this: Record<string, unknown>) {
    this.connect = vi.fn(() => {
      const next = connectQueue.shift()
      if (!next) throw new Error('connectQueue exhausted')
      return next()
    })
    this.on  = vi.fn()
    this.end = vi.fn(() => { endSpy(); return Promise.resolve() })
  }
  return { Pool }
})

import { scrapersQuery } from '@/lib/scrapers-db'

const okClient = (rows: unknown[]) => ({
  query:   vi.fn().mockResolvedValue({ rows }),
  release: vi.fn(),
})

beforeEach(() => {
  connectQueue.length = 0
  endSpy.mockClear()
  vi.useFakeTimers()
})

describe('scrapersQuery — connection retry', () => {
  it('retries a retryable connection error and resets the pool between attempts', async () => {
    // Attempt 1: connection refused. Attempt 2: success.
    connectQueue.push(() => Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })))
    connectQueue.push(() => Promise.resolve(okClient([{ id: 1 }])))

    const p = scrapersQuery('SELECT 1')
    await vi.runAllTimersAsync() // fast-forward the backoff sleep

    await expect(p).resolves.toEqual([{ id: 1 }])
    expect(endSpy).toHaveBeenCalledTimes(1) // pool reset once after the failure
  })

  it('does not retry a non-retryable (SQL/logic) error', async () => {
    connectQueue.push(() => Promise.resolve({
      query:   vi.fn().mockRejectedValue(Object.assign(new Error('syntax error'), { code: '42601' })),
      release: vi.fn(),
    }))

    const p = scrapersQuery('SELECT bad')
    const assertion = expect(p).rejects.toThrow('syntax error')
    await vi.runAllTimersAsync()
    await assertion
    expect(endSpy).not.toHaveBeenCalled()
  })

  it('gives up after MAX_ATTEMPTS on persistent connection failure', async () => {
    for (let i = 0; i < 4; i++) {
      connectQueue.push(() => Promise.reject(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })))
    }

    const p = scrapersQuery('SELECT 1')
    const assertion = expect(p).rejects.toThrow('ETIMEDOUT')
    await vi.runAllTimersAsync()
    await assertion
    // 3 resets (one per failed-but-retried attempt); the 4th throws without reset.
    expect(endSpy).toHaveBeenCalledTimes(3)
  })
})
