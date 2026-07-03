type ApiSnapshot = Record<string, unknown>

// Parse a JSON string to a JS object so both API and DB sides are compared structurally.
// This handles Python int/float serialization differences (1 vs 1.0) since JS treats them identically.
const parseJsonStr = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}

export type DynamicThreshold =
  | { type: 'distance_m'; maxMeters: number }
  | { type: 'absolute';   maxDelta:  number }
  | { type: 'percent';    maxPct:    number }

// Normalize geometry_coordinates to rings format [[[lng,lat],...], ...] (depth 3).
// Handles Polygon (depth 3), MultiPolygon (depth 4 → flat 1), and bare ring (depth 2 → wrap).
function geoDepth(arr: unknown): number {
  let d = 0; let cur: unknown = arr
  while (Array.isArray(cur)) { d++; cur = (cur as unknown[])[0] }
  return d
}
function toRings(arr: unknown[]): unknown[][] {
  const d = geoDepth(arr)
  if (d === 4) return (arr as unknown[][][]).flat(1)
  if (d === 3) return arr as unknown[][]
  if (d === 2) return [arr]
  return arr as unknown[][]
}
const normalizeGeoCoords = (v: unknown): unknown => Array.isArray(v) ? toRings(v) : v

export type MappingRow = {
  apiKey?:    string
  dbKey:      string
  normalize?: (v: unknown) => unknown  // applied to BOTH api and db values before comparison
  transform?: (v: unknown) => unknown
  note?:      string
  constant?:  unknown
  dynamic?:   true              // battery, coordinates — expected to change between captures
  threshold?: DynamicThreshold  // tolerance for dynamic fields; no threshold = field is ignored
  latPair?:   string            // partner dbKey for distance_m (lat row sets this to the lng dbKey)
  onlyWhen?:  (api: ApiSnapshot) => boolean  // sub-type filter: row included only when predicate is true
}

export type FieldMapping = MappingRow[]

const helmetStatus = (v: unknown) =>
  v === 0 ? 'absent' : v === 1 ? 'attached' : v

const ARIO_VEHICLE_TYPES: Record<number, string> = { 1: 'Ario TS 1.0', 2: 'E-bike', 3: 'Ario TS 1.5' }
const arioCategory = (v: unknown) => {
  if (v == null) return null
  return ARIO_VEHICLE_TYPES[v as number] ?? `type_${v}`
}

const div100 = (v: unknown) =>
  typeof v === 'number' ? v / 100 : v

const currencySymbol = (v: unknown) => {
  if (v === '$' || v === 'A$') return 'AUD'
  if (v === 'NZ$') return 'NZD'
  return v
}

const validDayToDesc = (v: unknown) =>
  typeof v === 'number'
    ? `Valid for ${v} day${v !== 1 ? 's' : ''}`
    : v

const toStr = (v: unknown) => String(v)

// Ario pricings sub-type predicates
const isRidePass    = (api: ApiSnapshot) => 'currentPrice'    in api
const isUnlock      = (api: ApiSnapshot) => 'unlockFeeAmount' in api
const isPerMinute   = (api: ApiSnapshot) => 'timeFeeAmount'   in api
const isBasePricing = (api: ApiSnapshot) => !isRidePass(api)

// Human Forest pricings sub-type predicates
const isHfBundle      = (api: ApiSnapshot) => !('vehicleType' in api)
const isHfVehicleType = (api: ApiSnapshot) =>   'vehicleType' in api
const isHfUnlock      = (api: ApiSnapshot) =>   'vehicleType' in api && api['name'] === 'unlock'

// Bolt pricings sub-type predicates
const isBoltSubscription = (api: ApiSnapshot) => api['name'] === 'ride_pass'
const isBoltVehicleCard  = (api: ApiSnapshot) => api['name'] !== 'ride_pass'

// Voi pricings sub-type predicates
// Ride pricings carry expiration_date (JWT exp); pass pricings do not.
const isVoiRidePricing = (api: ApiSnapshot) => 'expiration_date' in api
const isVoiPassPricing = (api: ApiSnapshot) => !('expiration_date' in api)

export const HF_UNLOCK_DESCRIPTION =
  'Pay as you go rides only. ' +
  'Pay £1 to unlock, then choose a bike with 1,2,5,10 or 30 minutes included. ' +
  'Minute allocation is based on ebike availability, location and time and is subject to T&Cs. ' +
  "After the minutes included are used, you'll be charged per minute."

// Per-scraper field mapping registry.
// Key: scrapers_db.apps.name (= quality_db.Scraper.appId).
// Used by both the AI comparison builder and the DiffTable UI.
const FIELD_MAPPINGS: Record<string, Record<string, FieldMapping>> = {
  ario: {
    // POST /app/api/carlist → dockless_fleets
    dockless: [
      { apiKey: 'carId',        dbKey: 'vehicle_id',    transform: toStr,        note: 'str()'                                          },
      { apiKey: 'stickerid',    dbKey: 'name'                                                                                             },
      { apiKey: 'type',         dbKey: 'category',      transform: arioCategory,  note: '1→"Ario TS 1.0", 2→"E-bike", 3→"Ario TS 1.5"'  },
      { apiKey: 'helmetStatus', dbKey: 'helmet_status', transform: helmetStatus,  note: '0→"absent", 1→"attached"'                        },
      { apiKey: 'battery',      dbKey: 'battery',       dynamic: true                                                                                                              },
      { apiKey: 'latitude',     dbKey: 'location_lat',  dynamic: true, threshold: { type: 'distance_m', maxMeters: 10000 }, latPair: 'location_lng' },
      { apiKey: 'longitude',    dbKey: 'location_lng',  dynamic: true                                                                                                              },
    ],

    // POST /app/api/getoutofoalist → zones
    // Snapshot excludes *_coordinate_list arrays (captured in geometry).
    // type/area_type derived from coordinate key — not in snapshot.
    zones: [
      { apiKey: 'id',        dbKey: 'zone_id'                                       },
      { apiKey: 'area_name', dbKey: 'zone_name'                                      },
      { apiKey: 'type',      dbKey: 'type'                                            },
      { apiKey: 'type',      dbKey: 'area_type'                                       },
      { apiKey: 'area_id',   dbKey: 'area_zone_id',  transform: toStr, note: 'str()' },
      { apiKey: 'geometry',  dbKey: 'geometry_coordinates'                            },
      {                      dbKey: 'geometry_type',  constant: 'Polygon', note: 'constant "Polygon"' },
      {                      dbKey: 'vehicle_type',   constant: 'scooter', note: 'constant "scooter"' },
    ],

    // POST /app/api/pay/pricelist  → unlock fee entity (unlockFeeAmount) + per-minute entity (timeFeeAmount)
    // POST /app/api/getridepassbycity → ride pass entities
    // Adapter creates one snapshot per fee type — only the relevant fee field is present.
    // onlyWhen guards rows that exist in only one sub-type to prevent false mismatches.
    pricings: [
      { apiKey: 'id',              dbKey: 'pricing_plan_id'                                                                           },
      // discount_id = same uuid as pricing_plan_id for ride pass; NULL in DB for base pricing
      { apiKey: 'id',              dbKey: 'discount_id',             onlyWhen: isRidePass                                             },
      // name — internal identifier, always a constant per sub-type
      {                            dbKey: 'name', constant: 'unlock_fee',      note: 'constant "unlock_fee"',      onlyWhen: isUnlock    },
      {                            dbKey: 'name', constant: 'per_minute_cost', note: 'constant "per_minute_cost"', onlyWhen: isPerMinute },
      {                            dbKey: 'name', constant: 'ride_pass',       note: 'constant "ride_pass"',       onlyWhen: isRidePass  },
      // pricing_plan_name — human-readable label
      {                            dbKey: 'pricing_plan_name', constant: 'Unlock fee',      note: 'constant "Unlock fee"',      onlyWhen: isUnlock    },
      {                            dbKey: 'pricing_plan_name', constant: 'Per-minute cost', note: 'constant "Per-minute cost"', onlyWhen: isPerMinute },
      { apiKey: 'ridePassName',    dbKey: 'pricing_plan_name',                                                                   onlyWhen: isRidePass  },
      // base pricing fee fields
      { apiKey: 'unlockFeeAmount', dbKey: 'amt',               transform: div100,         note: '/100',              onlyWhen: isUnlock    },
      { apiKey: 'timeFeeAmount',   dbKey: 'amt',               transform: div100,         note: '/100',              onlyWhen: isPerMinute },
      { apiKey: 'currency',        dbKey: 'currency',          transform: currencySymbol, note: '$→AUD, NZ$→NZD',    onlyWhen: isBasePricing },
      // ride pass fee fields
      { apiKey: 'currentPrice',    dbKey: 'amt',               transform: div100,         note: '/100',              onlyWhen: isRidePass  },
      { apiKey: 'minutePrice',     dbKey: 'discounted_amount', transform: div100,         note: '/100',              onlyWhen: isRidePass  },
      { apiKey: 'currencyName',    dbKey: 'currency',                                                                onlyWhen: isRidePass  },
      { apiKey: 'validDay',        dbKey: 'descriptions',      transform: validDayToDesc, note: '"Valid for N day(s)"', onlyWhen: isRidePass },
      {                            dbKey: 'vehicle_type',      constant: 'scooter',       note: 'constant "scooter"'                        },
    ],

    // Placeholder — update when a real docked adapter exists
    docked: [
      { apiKey: 'id',       dbKey: 'station_id'   },
      { apiKey: 'name',     dbKey: 'station_name' },
      { apiKey: 'capacity', dbKey: 'capacity'     },
      { apiKey: 'lat',      dbKey: 'location_lat' },
      { apiKey: 'lon',      dbKey: 'location_lng' },
    ],
  },

  human_forest: {
    // GET /v1/vehicles → dockless_fleets
    dockless: [
      { apiKey: 'id',       dbKey: 'vehicle_id'                                                                                          },
      { apiKey: 'category', dbKey: 'category'                                                                                            },
      { apiKey: 'battery',  dbKey: 'battery',      dynamic: true                                                                         },
      { apiKey: 'lat',      dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 10000 }, latPair: 'location_lng' },
      { apiKey: 'lon',      dbKey: 'location_lng', dynamic: true                                                                         },
    ],

    // GET /v1/minutes-view/subscriptions-and-bundles?version=3 → pricings (bundles sub-type)
    // GET /v1/vehicles/types → pricings (vehicle-type sub-type: unlock/per_minute/parking)
    pricings: [
      { apiKey: 'id',           dbKey: 'pricing_plan_id'                                  },
      { apiKey: 'name',         dbKey: 'name'                                             },
      { apiKey: 'currency',     dbKey: 'currency'                                         },
      { apiKey: 'amt',          dbKey: 'amt'                                              },
      { apiKey: 'pricingPlanName', dbKey: 'pricing_plan_name', onlyWhen: isHfBundle      },
      { apiKey: 'description',  dbKey: 'descriptions',         onlyWhen: isHfBundle      },
      { apiKey: 'vehicleType',  dbKey: 'vehicle_type',         onlyWhen: isHfVehicleType },
      { constant: HF_UNLOCK_DESCRIPTION, dbKey: 'descriptions', onlyWhen: isHfUnlock      },
    ],

    // GET /v1/territories → zones
    zones: [
      { apiKey: 'id',              dbKey: 'zone_id'          },
      { apiKey: 'zoneName',        dbKey: 'zone_name'        },
      { apiKey: 'type',            dbKey: 'type'             },
      { apiKey: 'geometryType',    dbKey: 'geometry_type'    },
      { apiKey: 'areaType',        dbKey: 'area_type'        },
      { apiKey: 'areaDescription', dbKey: 'area_description' },
      { apiKey: 'areaPriority',    dbKey: 'area_priority'    },
      { apiKey: 'areaZoneId',          dbKey: 'area_zone_id'          },
      { apiKey: 'areaRules',           dbKey: 'area_rules',           normalize: parseJsonStr },
      { apiKey: 'geometryCoordinates', dbKey: 'geometry_coordinates', normalize: normalizeGeoCoords },
    ],

    docked: [],
  },

  bolt: {
    // POST /micromobility/search/getVehicles/v2 → dockless_fleets
    // category is already rsplit("_", 1)[0] in adapter (e.g. "scooter_43" → "scooter").
    // zone_id stores the API category id (not a geographic zone).
    dockless: [
      { apiKey: 'vehicle_id',   dbKey: 'vehicle_id'                                                                                                      },
      { apiKey: 'zone_id',      dbKey: 'zone_id'                                                                                                          },
      { apiKey: 'category',     dbKey: 'category'                                                                                                         },
      { apiKey: 'battery',      dbKey: 'battery',      dynamic: true                                                                                      },
      { apiKey: 'location_lat', dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 10000 }, latPair: 'location_lng'        },
      { apiKey: 'location_lng', dbKey: 'location_lng', dynamic: true                                                                                      },
    ],

    // GET /micromobility/cityArea/listByTile → zones
    // geometry_coordinates is [[lat, lng], ...] (depth 2) in both API and DB —
    // normalizeGeoCoords wraps both sides to depth 3 for comparison.
    zones: [
      { apiKey: 'zone_id',              dbKey: 'zone_id'                                                              },
      { apiKey: 'area_type',            dbKey: 'area_type'                                                            },
      { apiKey: 'area_priority',        dbKey: 'area_priority'                                                        },
      { apiKey: 'area_zone_id',         dbKey: 'area_zone_id'                                                         },
      { apiKey: 'vehicle_type',         dbKey: 'vehicle_type'                                                         },
      { constant: 'Polygon',            dbKey: 'geometry_type'                                                        },
      { apiKey: 'geometry_coordinates', dbKey: 'geometry_coordinates', normalize: normalizeGeoCoords                  },
    ],

    // POST /micromobility/subscription/list → pricings (ride_pass sub-type)
    // POST /micromobility/vehicle/getCard   → pricings (PAYG sub-type)
    pricings: [
      // Subscription (ride_pass) ──────────────────────────────────────────────
      { apiKey: 'pricing_plan_id',   dbKey: 'pricing_plan_id',   onlyWhen: isBoltSubscription },
      { constant: 'ride_pass',       dbKey: 'name',              onlyWhen: isBoltSubscription },
      { apiKey: 'pricing_plan_name', dbKey: 'pricing_plan_name', onlyWhen: isBoltSubscription },
      { apiKey: 'amt',               dbKey: 'amt',               onlyWhen: isBoltSubscription },
      { apiKey: 'currency',          dbKey: 'currency',          onlyWhen: isBoltSubscription },
      { apiKey: 'vehicle_type',      dbKey: 'vehicle_type',      onlyWhen: isBoltSubscription },
      { apiKey: 'discount_id',       dbKey: 'discount_id',       onlyWhen: isBoltSubscription },
      { apiKey: 'discounted_amount', dbKey: 'discounted_amount', onlyWhen: isBoltSubscription },
      { apiKey: 'discounted_reason', dbKey: 'discounted_reason', onlyWhen: isBoltSubscription },
      { apiKey: 'descriptions',      dbKey: 'descriptions',      onlyWhen: isBoltSubscription },
      // Vehicle card / PAYG ────────────────────────────────────────────────────
      { apiKey: 'pricing_plan_id',   dbKey: 'pricing_plan_id',   onlyWhen: isBoltVehicleCard  },
      { apiKey: 'name',              dbKey: 'name',              onlyWhen: isBoltVehicleCard  },
      { apiKey: 'pricing_plan_name', dbKey: 'pricing_plan_name', onlyWhen: isBoltVehicleCard  },
      { apiKey: 'amt',               dbKey: 'amt',               onlyWhen: isBoltVehicleCard  },
      { apiKey: 'currency',          dbKey: 'currency',          onlyWhen: isBoltVehicleCard  },
      { apiKey: 'vehicle_type',      dbKey: 'vehicle_type',      onlyWhen: isBoltVehicleCard  },
      { apiKey: 'descriptions',      dbKey: 'descriptions',      onlyWhen: isBoltVehicleCard  },
    ],

    docked: [],
  },

  voi: {
    // GET /v2/rides/vehicles → dockless_fleets
    dockless: [
      { apiKey: 'id',            dbKey: 'vehicle_id'                                                                                                  },
      { apiKey: 'name',          dbKey: 'name'                                                                                                        },
      { apiKey: 'category',      dbKey: 'category'                                                                                                    },
      { apiKey: 'zone_id',       dbKey: 'zone_id'                                                                                                     },
      { apiKey: 'helmet_status', dbKey: 'helmet_status'                                                                                               },
      { apiKey: 'battery',       dbKey: 'battery',      dynamic: true                                                                                 },
      { apiKey: 'location_lat',  dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 10000 }, latPair: 'location_lng'   },
      { apiKey: 'location_lng',  dbKey: 'location_lng', dynamic: true                                                                                 },
    ],

    // GET /v2/rides/vehicles (JWT price_token decode) → pricings (ride sub-type)
    // GET /v2/payments/layout/{zone_id}/product-page  → pricings (pass sub-type)
    // Ride pricings carry expiration_date (JWT exp, changes per request → dynamic).
    pricings: [
      // Common ──────────────────────────────────────────────────────────────────
      { apiKey: 'id',                dbKey: 'pricing_plan_id'                                  },
      { apiKey: 'pricing_plan_name', dbKey: 'pricing_plan_name'                                },
      { apiKey: 'name',              dbKey: 'name'                                             },
      { apiKey: 'amt',               dbKey: 'amt'                                              },
      { apiKey: 'currency',          dbKey: 'currency'                                         },
      { apiKey: 'zone_id',           dbKey: 'zone_id'                                          },
      { apiKey: 'zone_name',         dbKey: 'zone_name'                                        },
      { apiKey: 'discounted_reason', dbKey: 'discounted_reason'                                },
      // Ride pricing only ───────────────────────────────────────────────────────
      { apiKey: 'vehicle_type',      dbKey: 'vehicle_type',      onlyWhen: isVoiRidePricing   },
      { apiKey: 'discount_id',       dbKey: 'discount_id',       onlyWhen: isVoiRidePricing   },
      { apiKey: 'discounted_amount', dbKey: 'discounted_amount', onlyWhen: isVoiRidePricing   },
      { apiKey: 'expiration_date',   dbKey: 'expiration_date',   dynamic: true, onlyWhen: isVoiRidePricing },
      // Pass pricing only ───────────────────────────────────────────────────────
      { apiKey: 'descriptions',      dbKey: 'descriptions',      onlyWhen: isVoiPassPricing   },
    ],

    // GET /v1/rides/zones/{zone_id}/areas → zones
    zones: [
      { apiKey: 'id',               dbKey: 'zone_id'                                              },
      { apiKey: 'zone_name',        dbKey: 'zone_name'                                            },
      { apiKey: 'area_type',        dbKey: 'area_type'                                            },
      { apiKey: 'area_description', dbKey: 'area_description'                                     },
      { apiKey: 'area_priority',    dbKey: 'area_priority'                                        },
      { apiKey: 'area_zone_id',     dbKey: 'area_zone_id'                                         },
      { apiKey: 'vehicle_type',     dbKey: 'vehicle_type'                                         },
      { apiKey: 'geometry_type',    dbKey: 'geometry_type'                                        },
      // area_rules: adapter stores JSON.stringify(rules); DB stores text → parse both sides
      { apiKey: 'area_rules',       dbKey: 'area_rules',  normalize: parseJsonStr                 },
    ],

    docked: [],
  },

  ryde: {
    // POST /appRyde/getNearScootersNew + /appRyde/getScooterInfoByCode → dockless_fleets
    // helmet_status is always null for Ryde (no helmeted flag anywhere in context).
    dockless: [
      { apiKey: 'id',            dbKey: 'vehicle_id'                                                                                                  },
      { apiKey: 'name',          dbKey: 'name'                                                                                                        },
      { apiKey: 'category',      dbKey: 'category'                                                                                                    },
      { apiKey: 'zone_id',       dbKey: 'zone_id'                                                                                                     },
      { apiKey: 'zone_name',     dbKey: 'zone_name'                                                                                                   },
      { apiKey: 'helmet_status', dbKey: 'helmet_status'                                                                                               },
      { apiKey: 'battery',       dbKey: 'battery',      dynamic: true                                                                                 },
      { apiKey: 'location_lat',  dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 10000 }, latPair: 'location_lng'   },
      { apiKey: 'location_lng',  dbKey: 'location_lng', dynamic: true                                                                                 },
    ],

    // POST /appRyde/getFeeRuleByCityId → pricings
    // One rule per city → up to 5 fee rows; pricing_plan_id = uuidv5("{cityId}_{vehicle_type}_{name}").
    pricings: [
      { apiKey: 'id',                dbKey: 'pricing_plan_id'   },
      { apiKey: 'pricing_plan_name', dbKey: 'pricing_plan_name' },
      { apiKey: 'name',              dbKey: 'name'              },
      { apiKey: 'amt',               dbKey: 'amt'               },
      { apiKey: 'currency',          dbKey: 'currency'          },
      { apiKey: 'vehicle_type',      dbKey: 'vehicle_type'      },
      { apiKey: 'zone_id',           dbKey: 'zone_id'           },
      { apiKey: 'zone_name',         dbKey: 'zone_name'         },
      { apiKey: 'station_id',        dbKey: 'station_id'        },
    ],

    // POST /appRyde/getCityFences → zones
    zones: [
      { apiKey: 'id',               dbKey: 'zone_id'                                              },
      { apiKey: 'zone_name',        dbKey: 'zone_name'                                            },
      { apiKey: 'area_type',        dbKey: 'area_type'                                            },
      { apiKey: 'area_description', dbKey: 'area_description'                                     },
      { apiKey: 'area_priority',    dbKey: 'area_priority'                                        },
      { apiKey: 'area_zone_id',     dbKey: 'area_zone_id'                                         },
      { apiKey: 'vehicle_type',     dbKey: 'vehicle_type'                                         },
      { apiKey: 'geometry_type',    dbKey: 'geometry_type'                                        },
      // area_rules: adapter stores compact JSON, DB stores Python-spaced JSON → parse both sides
      { apiKey: 'area_rules',       dbKey: 'area_rules',  normalize: parseJsonStr                 },
    ],

    docked: [],
  },

  lyft: {
    // POST /v1/last-mile/map-items → dockless_fleets
    dockless: [
      { apiKey: 'id',           dbKey: 'vehicle_id'                                                                                                  },
      { apiKey: 'name',         dbKey: 'name'                                                                                                        },
      { apiKey: 'category',     dbKey: 'category'                                                                                                    },
      { apiKey: 'battery',      dbKey: 'battery',      dynamic: true                                                                                 },
      { apiKey: 'location_lat', dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 10000 }, latPair: 'location_lng'   },
      { apiKey: 'location_lng', dbKey: 'location_lng', dynamic: true                                                                                 },
    ],

    // POST /v1/lbsbff/map/inventory → docked_fleets
    // num_bikes_available and num_docks_available change as bikes are rented → dynamic (ignored).
    // is_installed / is_renting / is_returning reflect station status → static (flagged on change).
    docked: [
      { apiKey: 'station_id',          dbKey: 'station_id'                                                                                                },
      { apiKey: 'station_name',        dbKey: 'station_name'                                                                                             },
      { apiKey: 'location_lat',        dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 10000 }, latPair: 'location_lng' },
      { apiKey: 'location_lng',        dbKey: 'location_lng', dynamic: true                                                                               },
      { apiKey: 'num_bikes_available', dbKey: 'num_bikes_available', dynamic: true                                                                        },
      { apiKey: 'num_docks_available', dbKey: 'num_docks_available', dynamic: true                                                                        },
      { apiKey: 'is_installed',        dbKey: 'is_installed'                                                                                              },
      { apiKey: 'is_renting',          dbKey: 'is_renting'                                                                                                },
      { apiKey: 'is_returning',        dbKey: 'is_returning'                                                                                              },
    ],

    // POST /v1/lbsbff/panel/pre-ride-station → pricings
    pricings: [
      { apiKey: 'pricing_plan_id',   dbKey: 'pricing_plan_id'   },
      { apiKey: 'pricing_plan_name', dbKey: 'pricing_plan_name' },
      { apiKey: 'vehicle_type',      dbKey: 'vehicle_type'      },
      { apiKey: 'name',              dbKey: 'name'              },
      { apiKey: 'amt',               dbKey: 'amt'               },
      { apiKey: 'currency',          dbKey: 'currency'          },
      { apiKey: 'descriptions',      dbKey: 'descriptions'      },
      { apiKey: 'station_id',        dbKey: 'station_id'        },
    ],

    zones: [],
  },
}

export function getFieldMapping(appId: string, entityType: string): FieldMapping {
  return FIELD_MAPPINGS[appId]?.[entityType] ?? []
}

// Kept for backwards compatibility with DiffTable (which receives entityType but not appId).
// Falls back to ario mappings since that is the only scraper currently implemented.
export const ENTITY_FIELD_MAPPINGS: Record<string, FieldMapping> =
  FIELD_MAPPINGS['ario'] ?? {}
