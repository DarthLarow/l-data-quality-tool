import { describe, it, expect } from 'vitest'
import { compareEntityFields } from '../checks/field-compare'

const BASE_API = {
  carId:        42,
  stickerid:    'SC-001',
  type:         1,
  helmetStatus: 1,
  battery:      80,
  latitude:     50.4501,
  longitude:    30.5234,
}

const BASE_DB = {
  vehicle_id:   '42',
  name:         'SC-001',
  category:     'Ario TS 1.0',
  helmet_status:'attached',
  battery:      80,
  location_lat: 50.4501,
  location_lng: 30.5234,
}

describe('compareEntityFields — ario / dockless', () => {
  it('Same — all fields match', () => {
    const r = compareEntityFields(BASE_API, BASE_DB, 'dockless', 'ario')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
    expect(r.explanation).toBe('All fields match')
  })

  it('Different — vehicle_id mismatch (static)', () => {
    const r = compareEntityFields({ ...BASE_API, carId: 99 }, BASE_DB, 'dockless', 'ario')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('vehicle_id'))).toBe(true)
  })

  it('Different — category mismatch after transform', () => {
    const r = compareEntityFields(
      { ...BASE_API, type: 2 },
      { ...BASE_DB, category: 'Ario TS 1.0' },
      'dockless', 'ario',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('category'))).toBe(true)
  })

  it('Different — helmet_status mismatch after transform', () => {
    const r = compareEntityFields(
      { ...BASE_API, helmetStatus: 0 },
      BASE_DB,
      'dockless', 'ario',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('helmet_status'))).toBe(true)
  })

  it('Same — battery has no threshold, dynamic field is ignored', () => {
    const r = compareEntityFields(
      { ...BASE_API, battery: 10 },
      { ...BASE_DB,  battery: 90 },
      'dockless', 'ario',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Same — GPS within 5km threshold (~340m)', () => {
    const r = compareEntityFields(
      { ...BASE_API, latitude: 50.4501, longitude: 30.5234 },
      { ...BASE_DB,  location_lat: 50.4532, location_lng: 30.5234 },
      'dockless', 'ario',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Different — GPS exceeds 10km threshold (~12km)', () => {
    const r = compareEntityFields(
      { ...BASE_API, latitude: 50.4501, longitude: 30.5234 },
      { ...BASE_DB,  location_lat: 50.5600, location_lng: 30.5234 },
      'dockless', 'ario',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('location'))).toBe(true)
  })
})

describe('compareEntityFields — ario / pricings (onlyWhen)', () => {
  it('Same — unlock fee sub-type, all fields match', () => {
    const api = { id: 'uuid-unlock', unlockFeeAmount: 150, currency: 'A$' }
    const db  = {
      pricing_plan_id:   'uuid-unlock',
      name:              'unlock_fee',
      pricing_plan_name: 'Unlock fee',
      amt:               1.50,
      currency:          'AUD',
      vehicle_type:      'scooter',
    }
    const r = compareEntityFields(api, db, 'pricings', 'ario')
    expect(r.verdict).toBe('Same')
  })

  it('Different — unlock fee amount mismatch', () => {
    const api = { id: 'uuid-unlock', unlockFeeAmount: 200, currency: 'A$' }
    const db  = {
      pricing_plan_id: 'uuid-unlock', name: 'unlock_fee',
      pricing_plan_name: 'Unlock fee', amt: 1.50, currency: 'AUD', vehicle_type: 'scooter',
    }
    const r = compareEntityFields(api, db, 'pricings', 'ario')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('amt'))).toBe(true)
  })
})

describe('compareEntityFields — no mapping', () => {
  it('Same with skipped explanation when scraper has no mapping', () => {
    const r = compareEntityFields({}, {}, 'dockless', 'unknown-scraper')
    expect(r.verdict).toBe('Same')
    expect(r.explanation).toMatch(/No field mapping/)
  })
})
