import { describe, it, expect, vi } from 'vitest'
import { TtlCache } from '../ttl-cache'

describe('TtlCache', () => {
  it('loads once per key and returns cached value on subsequent calls', async () => {
    const cache = new TtlCache<number>()
    const load = vi.fn().mockResolvedValue(42)

    const a = await cache.getOrLoad('city', load)
    const b = await cache.getOrLoad('city', load)

    expect(a).toBe(42)
    expect(b).toBe(42)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('loads separately for distinct keys', async () => {
    const cache = new TtlCache<string>()
    const load = vi.fn((k: string) => Promise.resolve(`v:${k}`))

    const a = await cache.getOrLoad('oslo', () => load('oslo'))
    const b = await cache.getOrLoad('bergen', () => load('bergen'))

    expect(a).toBe('v:oslo')
    expect(b).toBe('v:bergen')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent in-flight calls for the same key', async () => {
    const cache = new TtlCache<number>()
    let resolve!: (n: number) => void
    const load = vi.fn(() => new Promise<number>((r) => { resolve = r }))

    const p1 = cache.getOrLoad('city', load)
    const p2 = cache.getOrLoad('city', load)
    resolve(7)

    expect(await p1).toBe(7)
    expect(await p2).toBe(7)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures — next call retries', async () => {
    const cache = new TtlCache<number>()
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(99)

    await expect(cache.getOrLoad('city', load)).rejects.toThrow('db down')
    const v = await cache.getOrLoad('city', load)

    expect(v).toBe(99)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reloads after the TTL expires', async () => {
    const cache = new TtlCache<number>(10)
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)

    vi.useFakeTimers()
    try {
      const a = await cache.getOrLoad('city', load)
      vi.advanceTimersByTime(20)
      const b = await cache.getOrLoad('city', load)

      expect(a).toBe(1)
      expect(b).toBe(2)
      expect(load).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clear() drops all entries', async () => {
    const cache = new TtlCache<number>()
    const load = vi.fn().mockResolvedValue(5)

    await cache.getOrLoad('city', load)
    cache.clear()
    await cache.getOrLoad('city', load)

    expect(load).toHaveBeenCalledTimes(2)
  })
})
