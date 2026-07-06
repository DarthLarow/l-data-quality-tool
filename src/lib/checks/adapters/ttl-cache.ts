/**
 * Minimal TTL cache for per-city adapter context (cityId, gps coords, zoneId, …).
 *
 * All tiles of one city share the same context, but adapters resolve it
 * per-polygon (the DB lookup takes a polygonId). Caching by city collapses
 * thousands of identical lookups into one per city per run.
 *
 * Only per-city values are cached here — per-tile parameters (iotLa/iotLo,
 * nearRadius, phoneLa/phoneLo) are computed from PolygonBounds in memory and
 * never touch the DB, so they never go through this cache.
 *
 * Concurrency-safe against the worker pool (step 5): concurrent getOrLoad calls
 * for the same key share a single in-flight promise instead of each firing a
 * DB query. The TTL guards against stale city_configs in a long-lived process.
 */
export class TtlCache<V> {
  private store = new Map<string, { v: Promise<V>; exp: number }>()

  constructor(private ttlMs = 15 * 60_000) {}

  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const now = Date.now()
    const hit = this.store.get(key)
    if (hit && hit.exp > now) return hit.v

    const promise = load()
    this.store.set(key, { v: promise, exp: now + this.ttlMs })

    try {
      return await promise
    } catch (err) {
      // Don't cache failures — drop the entry so the next call retries.
      if (this.store.get(key)?.v === promise) this.store.delete(key)
      throw err
    }
  }

  clear(): void {
    this.store.clear()
  }
}
