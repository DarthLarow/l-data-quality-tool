export type MappingRow = {
  apiKey?:    string           // absent for constant-only DB fields
  dbKey:      string
  transform?: (v: unknown) => unknown
  note?:      string           // shown as Transform rule; auto-shows "copy" when absent
  constant?:  unknown          // DB-side constant (no API source)
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

// Sources: externalSystemDocs/ecommerce-scraper-main/docs/ario/API_to_DB_mapping.md
//          + ario_fleet_dockless_parser.py, ario_zone_parser.py,
//            ario_pricing_parser.py, ario_pass_pricing_parser.py
export const ENTITY_FIELD_MAPPINGS: Record<string, FieldMapping> = {
  // POST /app/api/carlist → dockless_fleets
  dockless: [
    { apiKey: 'carId',        dbKey: 'vehicle_id',    transform: toStr,        note: 'str()'                   },
    { apiKey: 'stickerid',    dbKey: 'name'                                                                      },
    { apiKey: 'battery',      dbKey: 'battery'                                                                   },
    { apiKey: 'latitude',     dbKey: 'location_lat'                                                              },
    { apiKey: 'longitude',    dbKey: 'location_lng'                                                              },
    { apiKey: 'helmetStatus', dbKey: 'helmet_status', transform: helmetStatus,  note: '0→"absent", 1→"attached"'              },
    { apiKey: 'type',         dbKey: 'category',      transform: arioCategory,  note: '1→"Ario TS 1.0", 2→"E-bike", 3→"Ario TS 1.5"' },
  ],

  // POST /app/api/getoutofoalist → zones
  // Snapshot excludes *_coordinate_list arrays (captured in geometry).
  // type/area_type are derived from the coordinate key — not in snapshot.
  zones: [
    { apiKey: 'id',        dbKey: 'zone_id'              },
    { apiKey: 'area_name', dbKey: 'zone_name'             },
    { apiKey: 'area_id',   dbKey: 'area_zone_id',  transform: toStr, note: 'str()' },
    { apiKey: 'geometry',  dbKey: 'geometry_coordinates'  },
    {                      dbKey: 'geometry_type',  constant: 'Polygon', note: 'constant "Polygon"' },
    {                      dbKey: 'vehicle_type',   constant: 'scooter', note: 'constant "scooter"' },
  ],

  // POST /app/api/pay/pricelist + /app/api/getridepassbycity → pricings
  // Adapter creates separate snapshots per fee type (only one fee field per entity).
  pricings: [
    // id = uuid5("ario_unlock_{city}") or "ario_per_minute_{city}" or "ario_ride_pass_{id}")
    // discount_id = same uuid5 as pricing_plan_id (ride pass only; NULL for base pricing)
    { apiKey: 'id',              dbKey: 'pricing_plan_id'                                                    },
    { apiKey: 'id',              dbKey: 'discount_id'                                                        },
    // base pricing — unlock entity has unlockFeeAmount; per-minute has timeFeeAmount
    { apiKey: 'unlockFeeAmount', dbKey: 'amt',               transform: div100,         note: '/100'         },
    { apiKey: 'timeFeeAmount',   dbKey: 'amt',               transform: div100,         note: '/100'         },
    { apiKey: 'currency',        dbKey: 'currency',          transform: currencySymbol, note: '$→AUD, NZ$→NZD' },
    // ride pass
    { apiKey: 'ridePassName',    dbKey: 'pricing_plan_name'                                                  },
    { apiKey: 'currentPrice',    dbKey: 'amt',               transform: div100,         note: '/100'         },
    { apiKey: 'minutePrice',     dbKey: 'discounted_amount', transform: div100,         note: '/100'         },
    { apiKey: 'currencyName',    dbKey: 'currency'                                                           },
    { apiKey: 'validDay',        dbKey: 'descriptions',      transform: validDayToDesc, note: '"Valid for N day(s)"' },
    {                            dbKey: 'vehicle_type',      constant: 'scooter',       note: 'constant "scooter"'  },
  ],

  // Placeholder — update when a real docked adapter exists
  docked: [
    { apiKey: 'id',       dbKey: 'station_id'   },
    { apiKey: 'name',     dbKey: 'station_name' },
    { apiKey: 'capacity', dbKey: 'capacity'     },
    { apiKey: 'lat',      dbKey: 'location_lat' },
    { apiKey: 'lon',      dbKey: 'location_lng' },
  ],
}
