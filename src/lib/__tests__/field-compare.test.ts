import { describe, it, expect } from 'vitest'
import { compareEntityFields } from '../checks/field-compare'
import { HF_UNLOCK_DESCRIPTION } from '../field-mappings'

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

describe('compareEntityFields — human_forest / pricings', () => {
  it('Same — bundle with creditsPerRide as name source', () => {
    const api = {
      id: 'bundle-1', name: 'day_pass', currency: 'GBP', amt: 9.99,
      pricingPlanName: '24hr unlimited rides', description: 'Unlimited rides',
    }
    const db = {
      pricing_plan_id: 'bundle-1', name: 'day_pass', currency: 'GBP', amt: 9.99,
      pricing_plan_name: '24hr unlimited rides', descriptions: 'Unlimited rides',
    }
    const r = compareEntityFields(api, db, 'pricings', 'human_forest')
    expect(r.verdict).toBe('Same')
  })

  it('Same — vehicle type unlock with descriptions (constant from mapping)', () => {
    const api = {
      id: 'uuid-unlock', name: 'unlock', currency: 'GBP', amt: 1.0,
      vehicleType: 'E-bike',
    }
    const db = {
      pricing_plan_id: 'uuid-unlock', name: 'unlock', currency: 'GBP', amt: 1.0,
      vehicle_type: 'E-bike', descriptions: HF_UNLOCK_DESCRIPTION,
    }
    const r = compareEntityFields(api, db, 'pricings', 'human_forest')
    expect(r.verdict).toBe('Same')
  })

  it('Different — bundle name mismatch (comma not stripped)', () => {
    const api = { id: 'b1', name: 'day_pass', currency: 'GBP', amt: 9.99 }
    const db  = { pricing_plan_id: 'b1', name: 'day,pass', currency: 'GBP', amt: 9.99 }
    const r = compareEntityFields(api, db, 'pricings', 'human_forest')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('name'))).toBe(true)
  })
})

// ─── Bolt ─────────────────────────────────────────────────────────────────────

const BOLT_DOCKLESS_API = {
  vehicle_id:   '515616',
  zone_id:      '114',
  category:     'scooter',
  battery:      32,
  location_lat: 44.4078,
  location_lng: 26.0598,
}
const BOLT_DOCKLESS_DB = {
  vehicle_id:   '515616',
  zone_id:      '114',
  category:     'scooter',
  battery:      32,
  location_lat: 44.4078,
  location_lng: 26.0598,
}

describe('compareEntityFields — bolt / dockless', () => {
  it('Same — all fields match', () => {
    const r = compareEntityFields(BOLT_DOCKLESS_API, BOLT_DOCKLESS_DB, 'dockless', 'bolt')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — vehicle_id mismatch', () => {
    const r = compareEntityFields(
      { ...BOLT_DOCKLESS_API, vehicle_id: '999' },
      BOLT_DOCKLESS_DB,
      'dockless', 'bolt',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('vehicle_id'))).toBe(true)
  })

  it('Different — category mismatch (base type differs)', () => {
    const r = compareEntityFields(
      { ...BOLT_DOCKLESS_API, category: 'ebike' },
      BOLT_DOCKLESS_DB,
      'dockless', 'bolt',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('category'))).toBe(true)
  })

  it('Same — battery ignored (dynamic, no threshold)', () => {
    const r = compareEntityFields(
      { ...BOLT_DOCKLESS_API, battery: 5 },
      { ...BOLT_DOCKLESS_DB,  battery: 95 },
      'dockless', 'bolt',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Same — GPS within 10km threshold', () => {
    const r = compareEntityFields(
      { ...BOLT_DOCKLESS_API, location_lat: 44.4078, location_lng: 26.0598 },
      { ...BOLT_DOCKLESS_DB,  location_lat: 44.4100, location_lng: 26.0598 },
      'dockless', 'bolt',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Different — GPS exceeds 10km threshold', () => {
    const r = compareEntityFields(
      { ...BOLT_DOCKLESS_API, location_lat: 44.4078, location_lng: 26.0598 },
      { ...BOLT_DOCKLESS_DB,  location_lat: 44.5100, location_lng: 26.0598 },
      'dockless', 'bolt',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('location'))).toBe(true)
  })
})

describe('compareEntityFields — bolt / zones', () => {
  const COORDS = [[47.37795, 8.54102], [47.3782, 8.54112], [47.37795, 8.54102]]

  it('Same — all fields match (geometry depth-2 both sides)', () => {
    const api = {
      zone_id: '3210717', area_type: 'restricted_speed_limited',
      area_priority: 42, area_zone_id: '96', vehicle_type: 'ebike,scooter',
      geometry_type: 'Polygon', geometry_coordinates: COORDS,
    }
    const db = {
      zone_id: '3210717', area_type: 'restricted_speed_limited',
      area_priority: 42, area_zone_id: '96', vehicle_type: 'ebike,scooter',
      geometry_type: 'Polygon', geometry_coordinates: COORDS,
    }
    const r = compareEntityFields(api, db, 'zones', 'bolt')
    expect(r.verdict).toBe('Same')
  })

  it('Different — vehicle_type mismatch', () => {
    const api = { zone_id: 'z1', area_type: 'no_parking', area_priority: 10, area_zone_id: '5', vehicle_type: 'scooter', geometry_coordinates: COORDS }
    const db  = { zone_id: 'z1', area_type: 'no_parking', area_priority: 10, area_zone_id: '5', vehicle_type: 'ebike',   geometry_coordinates: COORDS }
    const r = compareEntityFields(api, db, 'zones', 'bolt')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('vehicle_type'))).toBe(true)
  })

  it('Same — normalizeGeoCoords treats depth-2 and depth-3 wrapping as equal', () => {
    const flat   = [[47.37795, 8.54102], [47.3782, 8.54112]]           // depth 2
    const nested = [[[47.37795, 8.54102], [47.3782, 8.54112]]]         // depth 3
    const api = { zone_id: 'z1', geometry_coordinates: flat }
    const db  = { zone_id: 'z1', geometry_type: 'Polygon', geometry_coordinates: nested }
    const r = compareEntityFields(api, db, 'zones', 'bolt')
    expect(r.verdict).toBe('Same')
  })

  it('Different — geometry_coordinates point count differs', () => {
    const api = { zone_id: 'z1', geometry_coordinates: [[47.37795, 8.54102], [47.3782, 8.54112]] }
    const db  = { zone_id: 'z1', geometry_type: 'Polygon', geometry_coordinates: [[47.37795, 8.54102]] }
    const r = compareEntityFields(api, db, 'zones', 'bolt')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('geometry_coordinates'))).toBe(true)
  })
})

describe('compareEntityFields — bolt / pricings (subscription)', () => {
  const API_SUB = {
    pricing_plan_id:   '3648',
    name:              'ride_pass',
    pricing_plan_name: '25 minutes',
    amt:               3.9,
    currency:          'EUR',
    vehicle_type:      'scooter,ebike',
    discount_id:       '3648',
    discounted_amount: null,
    discounted_reason: 'Save 63%',
    descriptions:      'Valid 24 hours',
  }
  const DB_SUB = {
    pricing_plan_id:   '3648',
    name:              'ride_pass',
    pricing_plan_name: '25 minutes',
    amt:               3.9,
    currency:          'EUR',
    vehicle_type:      'scooter,ebike',
    discount_id:       '3648',
    discounted_amount: null,
    discounted_reason: 'Save 63%',
    descriptions:      'Valid 24 hours',
  }

  it('Same — subscription, all fields match', () => {
    const r = compareEntityFields(API_SUB, DB_SUB, 'pricings', 'bolt')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — amt mismatch', () => {
    const r = compareEntityFields({ ...API_SUB, amt: 4.5 }, DB_SUB, 'pricings', 'bolt')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('amt'))).toBe(true)
  })

  it('Different — name constant "ride_pass" violated in DB', () => {
    const r = compareEntityFields(API_SUB, { ...DB_SUB, name: 'other' }, 'pricings', 'bolt')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('name'))).toBe(true)
  })
})

describe('compareEntityFields — bolt / pricings (vehicle card)', () => {
  const API_CARD = {
    pricing_plan_id:   'ebike_unlock',
    name:              'unlock',
    pricing_plan_name: 'Unlock',
    amt:               0.35,
    currency:          'EUR',
    vehicle_type:      'ebike',
    descriptions:      '€0.35',
  }
  const DB_CARD = {
    pricing_plan_id:   'ebike_unlock',
    name:              'unlock',
    pricing_plan_name: 'Unlock',
    amt:               0.35,
    currency:          'EUR',
    vehicle_type:      'ebike',
    descriptions:      '€0.35',
  }

  it('Same — vehicle card, all fields match', () => {
    const r = compareEntityFields(API_CARD, DB_CARD, 'pricings', 'bolt')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — amt mismatch', () => {
    const r = compareEntityFields({ ...API_CARD, amt: 0.5 }, DB_CARD, 'pricings', 'bolt')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('amt'))).toBe(true)
  })

  it('onlyWhen — subscription fields not evaluated for vehicle card entity', () => {
    // discount_id is subscription-only; vehicle card never has it → should not flag as mismatch
    const r = compareEntityFields(API_CARD, { ...DB_CARD, discount_id: 'some-id' }, 'pricings', 'bolt')
    expect(r.verdict).toBe('Same')
  })

  it('onlyWhen — vehicle card fields not evaluated for subscription entity', () => {
    // "name" for subscription is a constant "ride_pass" row; the apiKey "name" vehicle card row is skipped
    const subApi = { ...API_CARD, name: 'ride_pass', pricing_plan_id: '999', discount_id: '999' }
    const subDb  = { ...DB_CARD,  name: 'ride_pass', pricing_plan_id: '999', discount_id: '999', pricing_plan_name: 'different' }
    // isBoltVehicleCard rows use apiKey "name" directly; subscription uses constant 'ride_pass'
    const r = compareEntityFields(subApi, subDb, 'pricings', 'bolt')
    // pricing_plan_name differs → Different (subscription row for it is active)
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('pricing_plan_name'))).toBe(true)
  })
})
