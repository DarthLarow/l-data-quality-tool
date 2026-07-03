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

// ─── Voi ──────────────────────────────────────────────────────────────────────

describe('compareEntityFields — voi / dockless', () => {
  const API = {
    id:            '9771ec41-b2ec-45c1-8c8a-ab24a6dc3f4e',
    name:          '5rr9',
    category:      'ebike',
    zone_id:       '327',
    helmet_status: null,
    battery:       95,
    location_lat:  51.557748,
    location_lng:  -0.352991,
  }
  const DB = {
    vehicle_id:   '9771ec41-b2ec-45c1-8c8a-ab24a6dc3f4e',
    name:         '5rr9',
    category:     'ebike',
    zone_id:      '327',
    helmet_status: null,
    battery:      95,
    location_lat: 51.557748,
    location_lng: -0.352991,
  }

  it('Same — all fields match', () => {
    const r = compareEntityFields(API, DB, 'dockless', 'voi')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — vehicle_id mismatch', () => {
    const r = compareEntityFields({ ...API, id: 'other-uuid' }, DB, 'dockless', 'voi')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('vehicle_id'))).toBe(true)
  })

  it('Same — battery ignored (dynamic, no threshold)', () => {
    const r = compareEntityFields({ ...API, battery: 10 }, { ...DB, battery: 90 }, 'dockless', 'voi')
    expect(r.verdict).toBe('Same')
  })

  it('Same — GPS within 10km threshold', () => {
    const r = compareEntityFields(
      { ...API, location_lat: 51.557748, location_lng: -0.352991 },
      { ...DB,  location_lat: 51.558000, location_lng: -0.352991 },
      'dockless', 'voi',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Different — GPS exceeds 10km threshold (~12km)', () => {
    const r = compareEntityFields(
      { ...API, location_lat: 51.557748, location_lng: -0.352991 },
      { ...DB,  location_lat: 51.670000, location_lng: -0.352991 },
      'dockless', 'voi',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('location'))).toBe(true)
  })
})

describe('compareEntityFields — voi / pricings (ride)', () => {
  const API_RIDE = {
    id:                'uuid-ride-plan',
    pricing_plan_name: 'dynamic_price',
    name:              'unlock_fee',
    amt:               0,
    currency:          'GBP',
    discount_id:       null,
    discounted_amount: 0,
    discounted_reason: null,
    vehicle_type:      'ebike',
    zone_id:           '327',
    zone_name:         'London',
    expiration_date:   '2026-07-01T00:00:00.000Z',
  }
  const DB_RIDE = {
    pricing_plan_id:   'uuid-ride-plan',
    pricing_plan_name: 'dynamic_price',
    name:              'unlock_fee',
    amt:               0,
    currency:          'GBP',
    discount_id:       null,
    discounted_amount: 0,
    discounted_reason: null,
    vehicle_type:      'ebike',
    zone_id:           '327',
    zone_name:         'London',
    expiration_date:   '2026-06-01T00:00:00.000Z',  // stale — captured earlier
  }

  it('Same — ride pricing, all static fields match (expiration_date dynamic = ignored)', () => {
    const r = compareEntityFields(API_RIDE, DB_RIDE, 'pricings', 'voi')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — amt mismatch', () => {
    const r = compareEntityFields({ ...API_RIDE, amt: 0.25 }, DB_RIDE, 'pricings', 'voi')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('amt'))).toBe(true)
  })

  it('Different — currency mismatch', () => {
    const r = compareEntityFields({ ...API_RIDE, currency: 'EUR' }, DB_RIDE, 'pricings', 'voi')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('currency'))).toBe(true)
  })
})

describe('compareEntityFields — voi / pricings (pass)', () => {
  const API_PASS = {
    id:                '8ce0bb5d-b922-4b2d-8bcb-732c7344dc60',
    pricing_plan_name: 'Prepay and save',
    name:              '30 minutes',
    amt:               2.99,
    currency:          'GBP',
    descriptions:      'Valid for 1 day',
    discounted_reason: 'Save 61% on a 10-min ride',
    zone_id:           '327',
    zone_name:         'London',
  }
  const DB_PASS = {
    pricing_plan_id:   '8ce0bb5d-b922-4b2d-8bcb-732c7344dc60',
    pricing_plan_name: 'Prepay and save',
    name:              '30 minutes',
    amt:               2.99,
    currency:          'GBP',
    descriptions:      'Valid for 1 day',
    discounted_reason: 'Save 61% on a 10-min ride',
    zone_id:           '327',
    zone_name:         'London',
  }

  it('Same — pass pricing, all fields match', () => {
    const r = compareEntityFields(API_PASS, DB_PASS, 'pricings', 'voi')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — descriptions mismatch', () => {
    const r = compareEntityFields({ ...API_PASS, descriptions: 'Valid for 2 days' }, DB_PASS, 'pricings', 'voi')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('descriptions'))).toBe(true)
  })

  it('onlyWhen — ride-only fields (expiration_date, vehicle_type) not evaluated for pass entity', () => {
    const r = compareEntityFields(API_PASS, { ...DB_PASS, vehicle_type: 'scooter', expiration_date: '2099-01-01T00:00:00.000Z' }, 'pricings', 'voi')
    expect(r.verdict).toBe('Same')
  })

  it('onlyWhen — pass-only field (descriptions) not evaluated for ride entity', () => {
    // API snapshot has expiration_date → detected as ride sub-type → descriptions row skipped.
    // DB includes vehicle_type so the ride-only rows all match; only descriptions differs.
    const rideApi = { ...API_PASS, expiration_date: '2026-07-01T00:00:00.000Z', vehicle_type: 'ebike' }
    const rideDb  = { ...DB_PASS, vehicle_type: 'ebike', descriptions: 'WRONG' }
    const r = compareEntityFields(rideApi, rideDb, 'pricings', 'voi')
    expect(r.verdict).toBe('Same')
  })
})

describe('compareEntityFields — voi / zones', () => {
  const RULES_OBJ = { noRiding_isEnforced: true, vehicle_types: ['EBIKE'] }
  const RULES_STR = JSON.stringify(RULES_OBJ)

  const API = {
    id:               'b512210a-e65b-40a7-a628-7c75b78f6521',
    zone_name:        'Portobello Road',
    area_type:        'no-riding',
    area_description: null,
    area_priority:    null,
    area_zone_id:     '327',
    vehicle_type:     'ebike',
    geometry_type:    'MultiPolygon',
    area_rules:       RULES_STR,
  }
  const DB = {
    zone_id:          'b512210a-e65b-40a7-a628-7c75b78f6521',
    zone_name:        'Portobello Road',
    area_type:        'no-riding',
    area_description: null,
    area_priority:    null,
    area_zone_id:     '327',
    vehicle_type:     'ebike',
    geometry_type:    'MultiPolygon',
    area_rules:       RULES_STR,   // DB also stores as text
  }

  it('Same — all fields match (area_rules as JSON string both sides)', () => {
    const r = compareEntityFields(API, DB, 'zones', 'voi')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Same — area_rules: API string vs DB string, structurally equal (parseJsonStr normalizes both)', () => {
    const apiWithObj = { ...API, area_rules: RULES_STR }
    const dbWithStr  = { ...DB,  area_rules: RULES_STR }
    const r = compareEntityFields(apiWithObj, dbWithStr, 'zones', 'voi')
    expect(r.verdict).toBe('Same')
  })

  it('Different — area_rules content mismatch', () => {
    const r = compareEntityFields(
      API,
      { ...DB, area_rules: JSON.stringify({ vehicle_types: ['SCOOTER'] }) },
      'zones', 'voi',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('area_rules'))).toBe(true)
  })

  it('Different — area_type mismatch', () => {
    const r = compareEntityFields(API, { ...DB, area_type: 'no-parking' }, 'zones', 'voi')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('area_type'))).toBe(true)
  })

  it('Different — zone_id (id) mismatch', () => {
    const r = compareEntityFields({ ...API, id: 'other-uuid' }, DB, 'zones', 'voi')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('zone_id'))).toBe(true)
  })
})

// ─── Lyft ─────────────────────────────────────────────────────────────────────

describe('compareEntityFields — lyft / dockless', () => {
  const API = {
    id:           '1753470622359260384',
    name:         '357-0868',
    category:     'electric_bike',
    battery:      99,
    location_lat: 38.807043552,
    location_lng: -77.108097911,
  }
  const DB = {
    vehicle_id:   '1753470622359260384',
    name:         '357-0868',
    category:     'electric_bike',
    battery:      99,
    location_lat: 38.807043552,
    location_lng: -77.108097911,
  }

  it('Same — all fields match', () => {
    const r = compareEntityFields(API, DB, 'dockless', 'lyft')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — vehicle_id mismatch', () => {
    const r = compareEntityFields({ ...API, id: '9999' }, DB, 'dockless', 'lyft')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('vehicle_id'))).toBe(true)
  })

  it('Different — category mismatch', () => {
    const r = compareEntityFields({ ...API, category: 'scooter' }, DB, 'dockless', 'lyft')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('category'))).toBe(true)
  })

  it('Same — battery ignored (dynamic, no threshold)', () => {
    const r = compareEntityFields({ ...API, battery: 5 }, { ...DB, battery: 95 }, 'dockless', 'lyft')
    expect(r.verdict).toBe('Same')
  })

  it('Same — GPS within 10km threshold (~200m)', () => {
    const r = compareEntityFields(
      { ...API, location_lat: 38.807043552, location_lng: -77.108097911 },
      { ...DB,  location_lat: 38.809000000, location_lng: -77.108097911 },
      'dockless', 'lyft',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Different — GPS exceeds 10km threshold (~12km)', () => {
    const r = compareEntityFields(
      { ...API, location_lat: 38.807043552, location_lng: -77.108097911 },
      { ...DB,  location_lat: 38.916000000, location_lng: -77.108097911 },
      'dockless', 'lyft',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('location'))).toBe(true)
  })
})

describe('compareEntityFields — lyft / docked', () => {
  const STATION_ID = '00284700-9d22-42ce-8485-113fed9879c1'
  const API = {
    station_id:          STATION_ID,
    station_name:        STATION_ID,
    location_lat:        40.764089,
    location_lng:        -73.910651,
    num_bikes_available: 29,
    num_docks_available: 0,
    is_installed:        1,
    is_renting:          1,
    is_returning:        1,
  }
  const DB = {
    station_id:          STATION_ID,
    station_name:        STATION_ID,
    location_lat:        40.764089,
    location_lng:        -73.910651,
    num_bikes_available: 29,
    num_docks_available: 0,
    is_installed:        1,
    is_renting:          1,
    is_returning:        1,
  }

  it('Same — all fields match', () => {
    const r = compareEntityFields(API, DB, 'docked', 'lyft')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — station_id mismatch', () => {
    const r = compareEntityFields({ ...API, station_id: 'other-id' }, DB, 'docked', 'lyft')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('station_id'))).toBe(true)
  })

  it('Different — is_installed mismatch (station went offline)', () => {
    const r = compareEntityFields({ ...API, is_installed: 0 }, DB, 'docked', 'lyft')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('is_installed'))).toBe(true)
  })

  it('Same — num_bikes_available ignored (dynamic, no threshold)', () => {
    const r = compareEntityFields(
      { ...API, num_bikes_available: 5  },
      { ...DB,  num_bikes_available: 25 },
      'docked', 'lyft',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Same — num_docks_available ignored (dynamic, no threshold)', () => {
    const r = compareEntityFields(
      { ...API, num_docks_available: 0  },
      { ...DB,  num_docks_available: 15 },
      'docked', 'lyft',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Same — GPS within 10km threshold', () => {
    const r = compareEntityFields(
      { ...API, location_lat: 40.764089, location_lng: -73.910651 },
      { ...DB,  location_lat: 40.764200, location_lng: -73.910651 },
      'docked', 'lyft',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Different — GPS exceeds 10km threshold (~12km)', () => {
    const r = compareEntityFields(
      { ...API, location_lat: 40.764089, location_lng: -73.910651 },
      { ...DB,  location_lat: 40.872000, location_lng: -73.910651 },
      'docked', 'lyft',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('location'))).toBe(true)
  })
})

describe('compareEntityFields — lyft / pricings', () => {
  const API = {
    pricing_plan_id:   '2968a13c-8dfd-5649-8606-c84786d1a3f5',
    pricing_plan_name: 'Unlock Fee',
    vehicle_type:      'Ebike',
    name:              'unlock',
    amt:               4.99,
    currency:          'USD',
    descriptions:      '$4.99 to unlock',
    station_id:        '1835247352748090208',
  }
  const DB = {
    pricing_plan_id:   '2968a13c-8dfd-5649-8606-c84786d1a3f5',
    pricing_plan_name: 'Unlock Fee',
    vehicle_type:      'Ebike',
    name:              'unlock',
    amt:               4.99,
    currency:          'USD',
    descriptions:      '$4.99 to unlock',
    station_id:        '1835247352748090208',
  }

  it('Same — all fields match', () => {
    const r = compareEntityFields(API, DB, 'pricings', 'lyft')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — pricing_plan_id mismatch', () => {
    const r = compareEntityFields({ ...API, pricing_plan_id: 'other-uuid' }, DB, 'pricings', 'lyft')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('pricing_plan_id'))).toBe(true)
  })

  it('Different — amt mismatch', () => {
    const r = compareEntityFields({ ...API, amt: 3.99 }, DB, 'pricings', 'lyft')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('amt'))).toBe(true)
  })

  it('Different — currency mismatch', () => {
    const r = compareEntityFields({ ...API, currency: 'GBP' }, DB, 'pricings', 'lyft')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('currency'))).toBe(true)
  })

  it('Different — vehicle_type mismatch', () => {
    const r = compareEntityFields({ ...API, vehicle_type: 'Classic bike' }, DB, 'pricings', 'lyft')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('vehicle_type'))).toBe(true)
  })
})

describe('compareEntityFields — lyft / zones', () => {
  it('Same with skipped explanation — zones has no mapping for Lyft', () => {
    const r = compareEntityFields({ id: 'z1' }, { zone_id: 'z1' }, 'zones', 'lyft')
    expect(r.verdict).toBe('Same')
    expect(r.explanation).toMatch(/No field mapping/)
  })
})

// ─── Ryde ─────────────────────────────────────────────────────────────────────

describe('compareEntityFields — ryde / dockless', () => {
  // Real stage sample (session 268, Trondheim): vehicle_id = IMEI, name = code
  const API = {
    id:            '861685071656215',
    name:          '319768',
    category:      'scooter',
    zone_id:       '5',
    zone_name:     'Trondheim',
    helmet_status: null,
    battery:       95,
    location_lat:  63.354675,
    location_lng:  10.407025,
  }
  const DB = {
    vehicle_id:    '861685071656215',
    name:          '319768',
    category:      'scooter',
    zone_id:       '5',
    zone_name:     'Trondheim',
    helmet_status: null,
    battery:       95,
    location_lat:  63.354675,
    location_lng:  10.407025,
  }

  it('Same — all fields match (helmet_status null on both sides)', () => {
    const r = compareEntityFields(API, DB, 'dockless', 'ryde')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — vehicle_id mismatch', () => {
    const r = compareEntityFields({ ...API, id: '861685072705870' }, DB, 'dockless', 'ryde')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('vehicle_id'))).toBe(true)
  })

  it('Same — battery ignored (dynamic, no threshold)', () => {
    const r = compareEntityFields({ ...API, battery: 12 }, { ...DB, battery: 95 }, 'dockless', 'ryde')
    expect(r.verdict).toBe('Same')
  })

  it('Same — GPS within 10km threshold', () => {
    const r = compareEntityFields(
      { ...API, location_lat: 63.354675, location_lng: 10.407025 },
      { ...DB,  location_lat: 63.360000, location_lng: 10.410000 },
      'dockless', 'ryde',
    )
    expect(r.verdict).toBe('Same')
  })

  it('Different — GPS exceeds 10km threshold (~11km)', () => {
    const r = compareEntityFields(
      { ...API, location_lat: 63.354675, location_lng: 10.407025 },
      { ...DB,  location_lat: 63.455000, location_lng: 10.407025 },
      'dockless', 'ryde',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('location'))).toBe(true)
  })
})

describe('compareEntityFields — ryde / pricings', () => {
  // Real stage sample (session 268, Höganäs): uuidv5("98_scooter_unlock_fee")
  const API = {
    id:                '20e504de-40b0-58d0-941e-72972220c0b2',
    pricing_plan_name: 'pricing',
    name:              'unlock_fee',
    amt:               10,
    currency:          'SEK',
    vehicle_type:      'scooter',
    zone_id:           '98',
    zone_name:         'Höganäs',
    station_id:        null,
  }
  const DB = {
    pricing_plan_id:   '20e504de-40b0-58d0-941e-72972220c0b2',
    pricing_plan_name: 'pricing',
    name:              'unlock_fee',
    amt:               10,
    currency:          'SEK',
    vehicle_type:      'scooter',
    zone_id:           '98',
    zone_name:         'Höganäs',
    station_id:        null,
  }

  it('Same — all fields match', () => {
    const r = compareEntityFields(API, DB, 'pricings', 'ryde')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — amt mismatch (fee changed)', () => {
    const r = compareEntityFields({ ...API, amt: 15 }, DB, 'pricings', 'ryde')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('amt'))).toBe(true)
  })

  it('Different — currency mismatch', () => {
    const r = compareEntityFields({ ...API, currency: 'NOK' }, DB, 'pricings', 'ryde')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('currency'))).toBe(true)
  })

  it('Different — pricing_plan_id mismatch', () => {
    const r = compareEntityFields({ ...API, id: 'dce71675-b790-5aec-b8cd-5d4a9bf00307' }, DB, 'pricings', 'ryde')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('pricing_plan_id'))).toBe(true)
  })
})

describe('compareEntityFields — ryde / zones', () => {
  // Adapter emits compact JSON; DB stores Python-spaced json.dumps output.
  const RULES_COMPACT = '{"outNoRide":0,"isLimitSpeed":0,"prohibitLock":0,"openAreaType":1,"zoneDesign":0}'
  const RULES_PYTHON  = '{"outNoRide": 0, "isLimitSpeed": 0, "prohibitLock": 0, "openAreaType": 1, "zoneDesign": 0}'

  const API = {
    id:               '33308',
    zone_name:        'IPZ- Bussholdeplass Bratsbergveien-15',
    area_type:        '0',
    area_description: 'fid:Turer som stopper her blir rabbatert.',
    area_priority:    null,
    area_zone_id:     '5',
    vehicle_type:     null,
    geometry_type:    'MultiPolygon',
    area_rules:       RULES_COMPACT,
  }
  const DB = {
    zone_id:          '33308',
    zone_name:        'IPZ- Bussholdeplass Bratsbergveien-15',
    area_type:        '0',
    area_description: 'fid:Turer som stopper her blir rabbatert.',
    area_priority:    null,
    area_zone_id:     '5',
    vehicle_type:     null,
    geometry_type:    'MultiPolygon',
    area_rules:       RULES_PYTHON,
  }

  it('Same — area_rules compact JSON vs Python-spaced JSON (parseJsonStr normalizes both)', () => {
    const r = compareEntityFields(API, DB, 'zones', 'ryde')
    expect(r.verdict).toBe('Same')
    expect(r.mismatches).toHaveLength(0)
  })

  it('Different — area_rules content mismatch', () => {
    const r = compareEntityFields(
      API,
      { ...DB, area_rules: '{"outNoRide": 1, "isLimitSpeed": 0, "prohibitLock": 0, "openAreaType": 1, "zoneDesign": 0}' },
      'zones', 'ryde',
    )
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('area_rules'))).toBe(true)
  })

  it('Different — zone_name mismatch', () => {
    const r = compareEntityFields({ ...API, zone_name: 'NPZ - Ugla Skole' }, DB, 'zones', 'ryde')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('zone_name'))).toBe(true)
  })

  it('Different — zone_id (fenId) mismatch', () => {
    const r = compareEntityFields({ ...API, id: '33307' }, DB, 'zones', 'ryde')
    expect(r.verdict).toBe('Different')
    expect(r.mismatches.some((m) => m.includes('zone_id'))).toBe(true)
  })
})

describe('compareEntityFields — ryde / docked', () => {
  it('Same with skipped explanation — docked has no mapping for Ryde', () => {
    const r = compareEntityFields({ id: 's1' }, { station_id: 's1' }, 'docked', 'ryde')
    expect(r.verdict).toBe('Same')
    expect(r.explanation).toMatch(/No field mapping/)
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
