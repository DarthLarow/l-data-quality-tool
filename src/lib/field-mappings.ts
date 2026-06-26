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

// Sources: externalSystemDocs/ecommerce-scraper-main/docs/ario/API_to_DB_mapping.md
export const ENTITY_FIELD_MAPPINGS: Record<string, FieldMapping> = {
  // POST /app/api/carlist → dockless_fleets
  dockless: [
    { apiKey: 'carId',        dbKey: 'vehicle_id'  },
    { apiKey: 'stickerid',    dbKey: 'name'         },
    { apiKey: 'battery',      dbKey: 'battery'      },
    { apiKey: 'latitude',     dbKey: 'location_lat' },
    { apiKey: 'longitude',    dbKey: 'location_lng' },
    { apiKey: 'helmetStatus', dbKey: 'helmet_status', transform: helmetStatus, note: '0→absent, 1→attached' },
  ],

  // POST /app/api/getoutofoalist → zones
  zones: [
    { apiKey: 'id',       dbKey: 'zone_id'     },
    { apiKey: 'area_name', dbKey: 'zone_name'   },
    { apiKey: 'area_id',   dbKey: 'area_zone_id' },
  ],

  // POST /app/api/pay/pricelist + /app/api/getridepassbycity → pricings
  // Both sub-types share this table; fields absent for one type show "—"
  pricings: [
    { apiKey: 'id',              dbKey: 'pricing_plan_id'   },
    // base pricing
    { apiKey: 'unlockFeeAmount', dbKey: 'amt',               transform: div100,         note: '÷100' },
    { apiKey: 'timeFeeAmount',   dbKey: 'amt',               transform: div100,         note: '÷100' },
    { apiKey: 'currency',        dbKey: 'currency',          transform: currencySymbol, note: '$→AUD, NZ$→NZD' },
    // ride pass
    { apiKey: 'ridePassName',    dbKey: 'pricing_plan_name' },
    { apiKey: 'ridePassId',      dbKey: 'discount_id'       },
    { apiKey: 'currentPrice',    dbKey: 'amt',               transform: div100,         note: '÷100' },
    { apiKey: 'minutePrice',     dbKey: 'discounted_amount', transform: div100,         note: '÷100' },
    { apiKey: 'currencyName',    dbKey: 'currency'          },
  ],

  // Placeholder until docked adapter is built
  docked: [
    { apiKey: 'id',       dbKey: 'station_id'   },
    { apiKey: 'name',     dbKey: 'station_name' },
    { apiKey: 'capacity', dbKey: 'capacity'     },
    { apiKey: 'lat',      dbKey: 'location_lat' },
    { apiKey: 'lon',      dbKey: 'location_lng' },
  ],
}
