import { getFieldMapping } from '@/lib/field-mappings'
import type { EntityType, AiVerdict } from '@/types'

type Obj = Record<string, unknown>

export interface FieldCompareResult {
  verdict:     AiVerdict
  explanation: string
  mismatches:  string[]
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R   = 6_371_000
  const φ1  = (lat1 * Math.PI) / 180
  const φ2  = (lat2 * Math.PI) / 180
  const Δφ  = ((lat2 - lat1) * Math.PI) / 180
  const Δλ  = ((lng2 - lng1) * Math.PI) / 180
  const a   = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

export function compareEntityFields(
  api: Obj,
  db:  Obj,
  entityType: EntityType,
  appId: string,
): FieldCompareResult {
  const mapping = getFieldMapping(appId, entityType)

  if (mapping.length === 0) {
    return { verdict: 'Same', explanation: 'No field mapping defined — comparison skipped', mismatches: [] }
  }

  const mismatches: string[] = []

  let pendingLat: { apiLat: number; dbLat: number; lngKey: string; maxMeters: number } | null = null

  for (const row of mapping) {
    if (row.onlyWhen && !row.onlyWhen(api)) continue

    if (row.constant !== undefined) {
      if (!deepEqual(db[row.dbKey], row.constant)) {
        mismatches.push(`${row.dbKey}: expected ${JSON.stringify(row.constant)}, got ${JSON.stringify(db[row.dbKey])}`)
      }
      continue
    }

    if (!row.apiKey || !(row.apiKey in api)) continue

    const apiVal = row.transform ? row.transform(api[row.apiKey]) : api[row.apiKey]
    const dbVal  = db[row.dbKey]

    if (row.dynamic) {
      const threshold = row.threshold

      // lng partner row: no threshold of its own, but paired with a pending lat distance_m check
      if (!threshold && pendingLat && row.dbKey === pendingLat.lngKey) {
        const apiLng = Number(apiVal)
        const dbLng  = Number(dbVal)
        const dist   = Math.round(haversineMeters(pendingLat.apiLat, apiLng, pendingLat.dbLat, dbLng))
        if (dist > pendingLat.maxMeters) {
          mismatches.push(`location: ${dist}m from API position (threshold ${pendingLat.maxMeters}m)`)
        }
        pendingLat = null
        continue
      }

      if (!threshold) continue // dynamic field without threshold — ignore

      if (threshold.type === 'distance_m') {
        if (row.latPair) {
          // lat row — store for pairing with the subsequent lng row
          pendingLat = {
            apiLat:    Number(apiVal),
            dbLat:     Number(dbVal),
            lngKey:    row.latPair,
            maxMeters: threshold.maxMeters,
          }
        }
      } else if (threshold.type === 'absolute') {
        const diff = Math.abs(Number(apiVal) - Number(dbVal))
        if (diff > threshold.maxDelta) {
          mismatches.push(`${row.dbKey}: delta ${diff} exceeds threshold ${threshold.maxDelta}`)
        }
      } else if (threshold.type === 'percent') {
        const base = Number(dbVal)
        const pct  = base === 0 ? Infinity : (Math.abs(Number(apiVal) - base) / Math.abs(base)) * 100
        if (pct > threshold.maxPct) {
          mismatches.push(`${row.dbKey}: ${pct.toFixed(1)}% change exceeds threshold ${threshold.maxPct}%`)
        }
      }
    } else {
      if (!deepEqual(apiVal, dbVal)) {
        mismatches.push(`${row.dbKey}: expected ${JSON.stringify(apiVal)}, got ${JSON.stringify(dbVal)}`)
      }
    }
  }

  const verdict     = mismatches.length === 0 ? 'Same' : 'Different'
  const explanation = mismatches.length === 0 ? 'All fields match' : mismatches.join('; ')

  return { verdict, explanation, mismatches }
}
