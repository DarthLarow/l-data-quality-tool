# Lyft Adapter Implementation Plan

**Goal:** Implement `LyftScraperApiAdapter` covering dockless vehicles, docked stations, and pricings for the Lyft scraper.

**Architecture:** Single adapter file. Auth: Bearer token via OAuth2 `refresh_token` grant. Docked + pricings both use city center (lat/lon from `city_config.extra_context`); dockless uses tile center + radius from `polygon_type`. Pricings are two-step: first inventory fetch to discover station_ids, then per-station pricing requests. UUID v5 via existing `@/lib/uuid5` utility (NAMESPACE_OID, same namespace as Python scraper).

**Tech Stack:** TypeScript, existing `scrapersQuery` / `ScraperApiAdapter` / `uuidv5` interfaces, Vitest.

## Global Constraints

- Lyft `appId = 'lyft'` in quality_db (= `apps.name` in scrapers_db)
- scrapers_db is **read-only** — no INSERT/UPDATE/DELETE ever
- Do NOT install new npm packages
- Run tests with: `npx vitest run src/lib/__tests__/field-compare.test.ts`
- Type-check with: `npx tsc --noEmit` — zero errors required after every step

---

## Key API facts (sourced from `externalSystemDocs/`)

### Auth
- **Tokens**: stored in `accounts.access_token` + `accounts.refresh_token` for `app_id` where `name = 'lyft'`
- **Refresh**: `POST <LYFT_REFRESH_URL>` with `application/x-www-form-urlencoded` body:
  ```
  grant_type=refresh_token&refresh_token=<refresh_token>
  ```
  Basic auth header: `Authorization: Basic ZVNhdDctaXU5ZG9NOlp0dkxEejBuMS1rSlZ3a0l2eEM0aVNKMHlNdkp5ZFBx`
  Response: `{ "access_token": "...", "refresh_token": "..." }` (both may rotate)
- **Used as**: `Authorization: Bearer <access_token>` on every request
- On 401: refresh + retry exactly once
- `LYFT_REFRESH_URL = 'https://api.lyft.com/oauth/token'`

### Base headers (from `lyft_base_spider.py`)
```
accept: application/json
content-type: application/json
user-agent: lyft:android:16:2026.10.31.1774041931
x-distance-unit: miles
x-locale-language: en
x-locale-region: US
x-lyft-geo-region: unknown
```
Per-request additional headers (see per-entity section below).

### City context (from `city_configs.extra_context`)

**Dockless** needs only `city_code` from extra_context (lat/lon come from `polygon_type`):
```sql
SELECT cc.extra_context->>'city_code' AS city_code
FROM city_polygons cp
JOIN cities c        ON c.id  = cp.city_id
JOIN city_configs cc ON cc.city_id = c.id
JOIN apps a          ON a.id  = c.app_id
WHERE a.name = 'lyft' AND cp.id::text = $1
LIMIT 1
```

**Docked + pricings** need `city_code`, `city_lat`, `city_lon`:
```sql
SELECT cc.extra_context->>'city_code' AS city_code,
       (cc.extra_context->>'city_lat')::float AS city_lat,
       (cc.extra_context->>'city_lon')::float AS city_lon
FROM city_polygons cp
JOIN cities c        ON c.id  = cp.city_id
JOIN city_configs cc ON cc.city_id = c.id
JOIN apps a          ON a.id  = c.app_id
WHERE a.name = 'lyft' AND cp.id::text = $1
LIMIT 1
```

### Polygon strategy
| Entity type | Strategy    | Reason |
|-------------|-------------|--------|
| `dockless`  | `'all'`     | Tile-based bbox — different tiles cover different areas |
| `docked`    | `'center_only'` | City center point, not bbox |
| `pricings`  | `'center_only'` | City center (station_ids discovered via inventory) |
| `zones`     | n/a         | Lyft has no zone spider → return `[]` |

---

## Entity details

### Dockless — `POST https://api.lyft.com/v1/last-mile/map-items`

**Extra headers:**
```
content-type: application/json;messageType=pb.api.endpoints.v1.last_mile.ReadMapItemsRequest; charset=utf-8
x-location: {center_lat},{center_lng}
x-lyft-region: {city_code}
x-timestamp-ms: {Date.now()}
x-timestamp-source: ntp
x-client-session-id: {uuid4}
```

**Body:**
```json
{
  "magic_map_context": {
    "origin_lat": <center_lat>,
    "origin_long": <center_lng>,
    "radius_km": <radius_m / 1000>,
    "result_filters": ["bff_fidget_enabled"]
  }
}
```
Lat/lon come from `polygon_type.center_lat`, `polygon_type.center_lng`, `polygon_type.radius_m`.

**Response** `{map_items: [{device: {rideable: {...}, id}, location: {lat, lng}}]}`:
```json
{
  "map_items": [{
    "device": {
      "rideable": {
        "rideable_id": "abc123",
        "rideable_name": "XYZ",
        "rideable_type": "scooter",
        "battery_status": { "percent": 72 }
      },
      "id": "fallback-id"
    },
    "location": { "lat": 41.88, "lng": -87.63 }
  }]
}
```

**DB fields** (`dockless_fleets`):
| DB column      | Source |
|----------------|--------|
| `vehicle_id`   | `String(rideable.rideable_id ?? device.id)` |
| `name`         | `rideable.rideable_name` |
| `battery`      | `rideable.battery_status.percent` |
| `location_lat` | `item.location.lat` |
| `location_lng` | `item.location.lng` |
| `category`     | `rideable.rideable_type` |

Skip items without `device.rideable`.

---

### Docked — `POST https://api.lyft.com/v1/lbsbff/map/inventory`

**Extra headers:**
```
content-type: application/json;messageType=pb.api.endpoints.v1.lbs_bff.ReadMapInventoryRequest; charset=utf-8
x-location: {city_lat},{city_lon}
x-lyft-region: {city_code}
x-timestamp-ms: {Date.now()}
x-timestamp-source: system
x-client-session-id: {uuid4}
x-client-default-polling-rate: 2000
```

**Body:** `{"style_sheet_name": "lbsbff-2026.9-0f9fcf91"}`

**Response** `{map_inventory_json: "<GeoJSON string>"}`:
GeoJSON is **double-encoded** (JSON string inside JSON). Features with `map_item_type = 1` are stations.
```json
{
  "features": [{
    "geometry": { "coordinates": [-87.63, 41.88] },
    "properties": {
      "map_item_type": 1,
      "map_item_id": "motivate_CHI_12345",
      "bikes_available": 3,
      "ebikes_available": 1,
      "nextgen_ebikes_available": 0,
      "docks_available": 5,
      "is_offline": false,
      "is_valet": false
    }
  }]
}
```

**DB fields** (`docked_fleets`):
| DB column            | Source |
|----------------------|--------|
| `station_id`         | trailing part after last `_` from `map_item_id` (e.g. `"12345"`) |
| `station_name`       | same as `station_id` |
| `location_lng`       | `geometry.coordinates[0]` |
| `location_lat`       | `geometry.coordinates[1]` |
| `num_bikes_available`| `bikes_available + ebikes_available + nextgen_ebikes_available` |
| `num_docks_available`| `docks_available` |
| `is_installed`       | `is_offline ? 0 : 1` |
| `is_renting`         | `(is_offline || is_valet) ? 0 : 1` |
| `is_returning`       | `is_offline ? 0 : 1` |

Skip features with `map_item_type !== 1`.

---

### Pricings — Two-step

**Step 1:** Same inventory endpoint as docked. Parse stations, collect full compound IDs in the form `motivate_{city_code}_{short_id}` (or keep original if it already has `_`).

**Step 2:** `POST https://api.lyft.com/v1/lbsbff/panel/pre-ride-station` per station_id.

**Body:**
```json
{
  "station_id": "motivate_CHI_12345",
  "panel_request": {},
  "lastmile_rewards_user_education_messages_enabled": true
}
```

**Extra headers** (same as docked except content-type):
```
content-type: application/json;messageType=pb.api.endpoints.v1.lbs_bff.ReadPreRideStationPanelRequest; charset=utf-8
x-location: {city_lat},{city_lon}
x-lyft-region: {city_code}
x-timestamp-ms: {Date.now()}
x-timestamp-source: system
x-client-session-id: {uuid4}
```

**Response** path: `panel.component_map.StationPricingDetailsComponent_0.pricing_details.pricing_details_text.text.strings[]`:
```json
[
  { "content": "Classic Pedal Bike" },
  { "content": "• $1.00 to unlock" },
  { "content": "• $0.17/min" }
]
```
Non-bullet lines (no `•`) set the current `vehicle_type`. Bullet lines are pricing rows.

**Parsing logic:**
- Strip `•` prefix and trim
- `amt`: regex `[$£€](\d+\.?\d*)` → float; or `0.0` if contains "free"
- `currency`: `$`→`USD`, `£`→`GBP`, `€`→`EUR`
- `name` inferred from text:
  - "to unlock" → `"unlock"`
  - "per minute to reserve" → `"per_minute_reservation"`
  - "per minute" → `"per_minute"`
  - "park" → `"parking_fee"`
  - default → `"flat"`
- `pricing_plan_name`: `"Unlock Fee"` / `"Per Minute"` / `"Per Minute Reservation"` / `"Parking Fee"` / `"Flat Fee"`
- `pricing_plan_id`: `uuidv5("{full_station_id}-{vehicle_type}-{name}-{text}")` — NAMESPACE_OID

**DB fields** (`pricings`):
| DB column          | Source |
|--------------------|--------|
| `pricing_plan_id`  | `uuidv5(...)` as above |
| `pricing_plan_name`| human label per name |
| `vehicle_type`     | current non-bullet line content |
| `name`             | inferred from text |
| `amt`              | parsed float |
| `currency`         | parsed from symbol |
| `descriptions`     | full text of bullet (raw) |
| `station_id`       | short id = `full_station_id.rsplit("_", 1)[-1]` |

**Scale concern:** A city may have many stations. To keep checks fast, limit pricing requests to the first N stations (e.g. 5) per polygon. Open question: confirm a sensible cap with the team.

---

## Open questions (need DB access to verify)

| # | Question | Where to check |
|---|----------|---------------|
| 1 | What does `polygon_type` look like for Lyft polygons? Should have `{center_lat, center_lng, radius_m}`. | `SELECT polygon_type FROM city_polygons cp JOIN cities c ON c.id=cp.city_id WHERE c.app_id=(SELECT id FROM apps WHERE name='lyft') LIMIT 3` |
| 2 | Does `city_configs.extra_context` contain `city_lat`, `city_lon`, `city_code`? | `SELECT cc.extra_context FROM city_configs cc JOIN cities c ON c.id=cc.city_id WHERE c.app_id=... LIMIT 3` |
| 3 | How many stations per city (inventory response)? Determines if a cap is needed. | Check docked_fleets count per session |
| 4 | Is there real Lyft data in scrapers_db? | `SELECT COUNT(*) FROM docked_fleets df JOIN collection_tasks ct ON ct.id=df.collection_task_id JOIN city_polygons cp ON cp.id=ct.city_polygon_id JOIN cities c ON c.id=cp.city_id WHERE c.app_id=...` |
| 5 | Are `is_installed`, `is_renting`, `is_returning` stored as int (0/1) or boolean in DB? | `SELECT is_installed, pg_typeof(is_installed) FROM docked_fleets LIMIT 1` |

---

## Implementation steps

- [ ] **Step 1 — scrapers-db helpers**
  Add to `src/lib/scrapers-db.ts`:
  ```typescript
  export interface LyftAccountRow {
    access_token:  string | null
    refresh_token: string
  }
  export async function getLyftAccount(): Promise<LyftAccountRow | null>

  export interface LyftCityContextRow {
    city_code: string
    city_lat:  number | null  // null for dockless-only polygons
    city_lon:  number | null
  }
  export async function getLyftCityContext(polygonId: string): Promise<LyftCityContextRow | null>
  ```
  Run `npx tsc --noEmit`.

- [ ] **Step 2 — adapter**
  Create `src/lib/checks/adapters/lyft-adapter.ts`:
  - Auth: Bearer + `refresh_token` grant with Basic auth header
  - `polygonStrategy`: `'all'` for dockless, `'center_only'` for docked/pricings
  - `fetchDockless`: POST map-items with tile center + radius from `polygon_type`
  - `fetchDocked`: POST map/inventory with city center; parse double-encoded GeoJSON
  - `fetchPricings`: inventory → station_ids → POST pre-ride-station per station (max 5)
  - `fetchZones`: return `[]`
  - `uuidv5` imported from `@/lib/uuid5`
  Run `npx tsc --noEmit`.

- [ ] **Step 3 — field mappings**
  Add `lyft` block to `src/lib/field-mappings.ts`:
  - `dockless`: vehicle_id, name, battery (dynamic), location_lat/lng (dynamic, distance_m)
  - `docked`: station_id, station_name, location_lat/lng (dynamic, distance_m), num_bikes_available (dynamic), num_docks_available (dynamic), is_installed, is_renting, is_returning
  - `pricings`: pricing_plan_id, pricing_plan_name, vehicle_type, name, amt, currency, descriptions, station_id
  - `zones`: `[]`
  Run `npx tsc --noEmit`.

- [ ] **Step 4 — tests**
  Add Lyft test suite to `src/lib/__tests__/field-compare.test.ts`:
  - dockless: Same, vehicle_id mismatch, battery ignored, GPS within/exceeds threshold
  - docked: Same, station_id mismatch, num_bikes_available ignored (dynamic), GPS within/exceeds threshold
  - pricings: Same, amt mismatch, currency mismatch, pricing_plan_id mismatch
  - zones: empty mapping → "No field mapping" verdict
  Run `npx vitest run src/lib/__tests__/field-compare.test.ts`.

- [ ] **Step 5 — register**
  In `src/lib/checks/adapters/scraper-adapter.ts`:
  ```typescript
  import { LyftScraperApiAdapter } from './lyft-adapter'
  // ...
  ['lyft', new LyftScraperApiAdapter()],
  ```
  Run `npx tsc --noEmit`.
