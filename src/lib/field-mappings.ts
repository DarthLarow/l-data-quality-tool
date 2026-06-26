export type MappingRow = {
  apiKey:     string
  dbKey:      string
  // Normalize API value before comparing with DB value.
  // If present, the transformed result is shown next to the raw value.
  transform?: (v: unknown) => unknown
  note?:      string
}

export type FieldMapping = MappingRow[]

const helmetStatus = (v: unknown) =>
  v === 0 ? 'absent' : v === 1 ? 'attached' : v

const div100 = (v: unknown) =>
  typeof v === 'number' ? v / 100 : v

const currencySymbol = (v: unknown) => {
  if (v === '$' || v === 'A$') return 'AUD'
  if (v === 'NZ$') return 'NZD'
  return v
}

const validDayToDesc = (v: unknown) =>
  typeof v === 'number' ? `Valid for ${v} day(s)` : v

const toString = (v: unknown) => String(v)

// Sources: externalSystemDocs/ecommerce-scraper-main/docs/ario/API_to_DB_mapping.md
export const ENTITY_FIELD_MAPPINGS: Record<string, FieldMapping> = {
  // POST /app/api/carlist → dockless_fleets
  dockless: [
    { apiKey: 'carId',        dbKey: 'vehicle_id'   },
    { apiKey: 'stickerid',    dbKey: 'name'          },
    { apiKey: 'battery',      dbKey: 'battery'       },
    { apiKey: 'latitude',     dbKey: 'location_lat'  },
    { apiKey: 'longitude',    dbKey: 'location_lng'  },
    { apiKey: 'helmetStatus', dbKey: 'helmet_status', transform: helmetStatus, note: '0→absent, 1→attached' },
  ],

  // POST /app/api/getoutofoalist → zones
  // Snapshot excludes *_coordinate_list arrays (captured in `geometry`).
  zones: [
    { apiKey: 'id',       dbKey: 'zone_id'          },
    { apiKey: 'area_name', dbKey: 'zone_name'        },
    { apiKey: 'area_id',  dbKey: 'area_zone_id',     transform: toString, note: 'str()' },
    { apiKey: 'geometry', dbKey: 'geometry_coordinates' },
  ],

  // POST /app/api/pay/pricelist + /app/api/getridepassbycity → pricings
  // Adapter creates separate snapshots per fee type, so each entity has only
  // its own fee field (unlockFeeAmount XOR timeFeeAmount XOR currentPrice).
  pricings: [
    { apiKey: 'id',              dbKey: 'pricing_plan_id'   },
    // base pricing (each entity snapshot contains only one of these two)
    { apiKey: 'unlockFeeAmount', dbKey: 'amt',               transform: div100,         note: '÷100' },
    { apiKey: 'timeFeeAmount',   dbKey: 'amt',               transform: div100,         note: '÷100' },
    { apiKey: 'currency',        dbKey: 'currency',          transform: currencySymbol, note: '$→AUD, NZ$→NZD' },
    // ride pass
    { apiKey: 'ridePassName',    dbKey: 'pricing_plan_name' },
    { apiKey: 'ridePassId',      dbKey: 'discount_id'       },
    { apiKey: 'currentPrice',    dbKey: 'amt',               transform: div100,         note: '÷100' },
    { apiKey: 'minutePrice',     dbKey: 'discounted_amount', transform: div100,         note: '÷100' },
    { apiKey: 'currencyName',    dbKey: 'currency'          },
    { apiKey: 'validDay',        dbKey: 'descriptions',      transform: validDayToDesc, note: 'Valid for N day(s)' },
  ],

  // Placeholder — Ario does not support docked; update when a real adapter exists
  docked: [
    { apiKey: 'id',       dbKey: 'station_id'   },
    { apiKey: 'name',     dbKey: 'station_name' },
    { apiKey: 'capacity', dbKey: 'capacity'     },
    { apiKey: 'lat',      dbKey: 'location_lat' },
    { apiKey: 'lon',      dbKey: 'location_lng' },
  ],
}
