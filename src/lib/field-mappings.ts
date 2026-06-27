type ApiSnapshot = Record<string, unknown>

export type MappingRow = {
  apiKey?:    string
  dbKey:      string
  transform?: (v: unknown) => unknown
  note?:      string
  constant?:  unknown
  dynamic?:   true              // battery, coordinates — expected to change between captures
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

// Pricings sub-type predicates
const isRidePass    = (api: ApiSnapshot) => 'currentPrice'    in api
const isUnlock      = (api: ApiSnapshot) => 'unlockFeeAmount' in api
const isPerMinute   = (api: ApiSnapshot) => 'timeFeeAmount'   in api
const isBasePricing = (api: ApiSnapshot) => !isRidePass(api)

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
      { apiKey: 'battery',      dbKey: 'battery',       dynamic: true                                                                     },
      { apiKey: 'latitude',     dbKey: 'location_lat',  dynamic: true                                                                     },
      { apiKey: 'longitude',    dbKey: 'location_lng',  dynamic: true                                                                     },
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
}

export function getFieldMapping(appId: string, entityType: string): FieldMapping {
  return FIELD_MAPPINGS[appId]?.[entityType] ?? []
}

// Kept for backwards compatibility with DiffTable (which receives entityType but not appId).
// Falls back to ario mappings since that is the only scraper currently implemented.
export const ENTITY_FIELD_MAPPINGS: Record<string, FieldMapping> =
  FIELD_MAPPINGS['ario'] ?? {}
