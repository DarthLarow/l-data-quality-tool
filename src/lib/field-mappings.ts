export type FieldMapping = { apiKey: string; dbKey: string }[]

// Defined per entity type based on actual scrapers_db schema.
// Add per-scraper overrides when needed.
export const ENTITY_FIELD_MAPPINGS: Record<string, FieldMapping> = {
  dockless: [
    { apiKey: 'id',           dbKey: 'vehicle_id' },
    { apiKey: 'battery',      dbKey: 'battery' },
    { apiKey: 'latitude',     dbKey: 'location_lat' },
    { apiKey: 'longitude',    dbKey: 'location_lng' },
    { apiKey: 'helmetStatus', dbKey: 'helmet_status' },
    { apiKey: 'name',         dbKey: 'name' },
  ],
  docked: [
    { apiKey: 'id',           dbKey: 'station_id' },
    { apiKey: 'name',         dbKey: 'station_name' },
    { apiKey: 'capacity',     dbKey: 'capacity' },
    { apiKey: 'lat',          dbKey: 'location_lat' },
    { apiKey: 'lon',          dbKey: 'location_lng' },
  ],
  pricings: [
    { apiKey: 'id',           dbKey: 'pricing_plan_id' },
    { apiKey: 'name',         dbKey: 'name' },
    { apiKey: 'city',         dbKey: 'city' },
    { apiKey: 'country',      dbKey: 'country' },
    { apiKey: 'currency',     dbKey: 'currency' },
    { apiKey: 'amt',          dbKey: 'amt' },
  ],
  zones: [
    { apiKey: 'id',           dbKey: 'zone_id' },
    { apiKey: 'name',         dbKey: 'zone_name' },
    { apiKey: 'type',         dbKey: 'type' },
    { apiKey: 'country',      dbKey: 'country' },
    { apiKey: 'city',         dbKey: 'city' },
  ],
}
