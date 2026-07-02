# Voi Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `VoiScraperApiAdapter` covering dockless vehicles, zones, and pricings (ride + pass) for the Voi scraper.

**Architecture:** Single adapter file mirrors the Bolt/HumanForest pattern — auth refresh, city-context lookup, three entity fetchers. Pricings are a two-step chain: vehicles endpoint (JWT `price_token` decode → ride pricings) + product-page endpoint (pass plans). UUID v5 is computed inline with Node.js `crypto` (no npm dependency needed).

**Tech Stack:** TypeScript, Node.js `crypto` (built-in), existing `scrapersQuery` / `ScraperApiAdapter` interfaces, Vitest.

## Global Constraints

- Voi `appId = 'voi'` in quality_db (= `apps.name` in scrapers_db; `apps.id = 4`)
- scrapers_db is **read-only** — no INSERT/UPDATE/DELETE ever
- Do NOT install new npm packages — use Node.js built-ins only
- Run tests with: `npx vitest run src/lib/__tests__/field-compare.test.ts`
- Type-check with: `npx tsc --noEmit` — zero errors required after every task
- `interPolygonDelayMs` for Voi: `500` (all types use `center_only`, so minimal inter-polygon calls)

---

## Key API facts (sourced from `externalSystemDocs/`)

### Auth
- **Long-lived token** (`authenticationToken`): stored in `accounts.refresh_token` for `app_id = 4`
- **Short-lived token** (`accessToken`): stored in `accounts.access_token`; may be `null` when expired
- **Refresh**: `POST https://api.voiapp.io/v1/auth/session` body `{"authenticationToken":"<refresh_token>"}` → `{accessToken: "..."}`
- Token used as header `X-Access-Token: <accessToken>` (NOT Bearer)
- On 401: refresh + retry exactly once (same pattern as Bolt/HumanForest)

### City context
- `zone_id` comes from `city_configs.extra_context->>'zone_id'` for the polygon's city
- Examples: `"49"` (Helsinki), `"423"` (London), `"230"` (Corby)

```sql
SELECT cc.extra_context->>'zone_id' AS zone_id
FROM city_polygons cp
JOIN cities c        ON c.id  = cp.city_id
JOIN city_configs cc ON cc.city_id = c.id
JOIN apps a          ON a.id  = c.app_id
WHERE a.name = 'voi'
  AND cp.id::text = $1
LIMIT 1
```

### Polygon strategy — ALL types → `'center_only'`
All Voi API calls use `zone_id` (city-scoped), not a bounding box. One request per city suffices for all entity types.

### Base headers (from `voi_base_spider.py`)
```
Accept-Encoding: gzip
brand: google
Connection: Keep-Alive
manufacturer: Google
model: sdk_gphone64_x86_64
User-Agent: okhttp/5.1.0
X-Access-Token: <accessToken>
X-App-Name: Rider
X-App-Version: 3.320.2
X-Device-Id: 7784e054303d6420
X-Locale: en
X-Locale-Country: en_US
X-OS: Android
X-OS-Version: 36
X-Request-Id: <fresh uuid4 per request>
X-Timezone: GMT
```

### Dockless — `GET /v2/rides/vehicles?zone_id={zone_id}&include_suggestion=false`
Response `data.vehicle_groups[].vehicles[]`:
```json
{ "id": "uuid", "battery": 48,
  "location": { "lat": 51.4, "lng": -0.29 },
  "zone_id": "327", "category": "scooter" }
```
Field mapping:
- `vehicle_id` ← `String(item.id)`
- `battery` ← `item.battery`
- `location_lat` ← `item.location.lat`
- `location_lng` ← `item.location.lng`
- `zone_id` ← `String(item.zone_id)`
- `category` ← `item.category ?? group.group_type`

### Zones — `GET /v1/rides/zones/{zone_id}/areas?include_suggestion=false`
Response is GeoJSON FeatureCollection: `features[]`
```json
{ "id": "uuid", "type": "Feature",
  "geometry": { "type": "MultiPolygon", "coordinates": [[[[...]]]]} ,
  "properties": { "area_type": "no-riding", "name": "Portobello Road",
    "priority": 0, "description": "Police Request",
    "rules": { "vehicle_types": ["EBIKE"] }, "zone_id": "327" }}
```
Field mapping:
- `zone_id` ← `String(feature.id)`
- `zone_name` ← `props.name`
- `type` ← `feature.type`
- `geometry_type` ← `geom.type`
- `geometry_coordinates` ← `geom.coordinates`
- `area_type` ← `props.area_type`
- `area_description` ← `props.description`
- `area_priority` ← `Number(props.priority)`
- `area_zone_id` ← `String(props.zone_id)`
- `vehicle_type` ← `rules.vehicle_types.map(v => v.toLowerCase()).join(', ')` or `null`

### Pricings (step 1 — ride) — same `/v2/rides/vehicles` response
Each `vehicle_group` has a `price_token` (JWT). Decode payload (base64url, no signature verification):
```json
{ "pid": "some-uuid", "plan_name": "dynamic_price", "exp": 1234567890,
  "price_components": [
    { "name": "unlock_fee", "base_amount": 100, "units": "GBP",
      "discount_id": "", "discounted_amount": 100, "discount_reason": "" }
  ]}
```
Field mapping per component:
- `pricing_plan_id` ← `uuid5(NAMESPACE_OID, "{pid}_{group_type}_{component.name}")`
  - Python namespace: `uuid.NAMESPACE_OID = '6ba7b812-9dad-11d1-80b4-00c04fd430c8'`
  - Result is globally unique UUID (different per city because `pid` varies per city)
- `pricing_plan_name` ← `payload.plan_name`
- `name` ← `component.name`
- `amt` ← `component.base_amount / 100`
- `currency` ← `String(component.units).toUpperCase()`
- `vehicle_type` ← `group.group_type` (non-null for ride pricings)
- `discount_id` ← `component.discount_id || null`
- `discounted_amount` ← `component.discounted_amount / 100`
- `discounted_reason` ← `component.discount_reason || null`
- `expiration_date` ← `new Date(payload.exp * 1000).toISOString()` — **dynamic: true** (changes on every JWT refresh)

**Discriminator:** ride pricings have `vehicle_type != null`

### Pricings (step 2 — pass) — `GET /v2/payments/layout/{zone_id}/product-page`
Response `data.available.categories[].products[]`:
```json
{ "id": "uuid", "title": "30 minutes", "price": "£2.99",
  "bullets": [{ "text": [{ "content": "Valid for 1 day" }] }],
  "banner": { "text": [{ "content": "Save " }, { "content": "61%" }, { "content": " on a 10-min ride" }] } }
```
**`product.price` format:** currency symbol + amount (e.g. `"£2.99"`, `"€6.49"`), NOT "ISO AMOUNT".
Parse with `parseCurrency(price)` + `parseRate(price)` — same symbol-map approach as Bolt adapter.

Field mapping:
- `pricing_plan_id` ← `String(product.id)` (UUID, globally unique)
- `pricing_plan_name` ← `category.name`
- `name` ← `product.title`
- `amt` + `currency` ← parse `product.price` (symbol-based: `"£2.99"` → `{amt: 2.99, currency: "GBP"}`)
- `descriptions` ← `bullets[].text[].content` joined by space
- `discounted_reason` ← `banner.text[].content` joined by space (all text segments concatenated)
- `vehicle_type` ← `null` (no vehicle type for pass pricings)
- `expiration_date` ← `null` (only ride pricings have expiration)

**Discriminator:** pass pricings have `vehicle_type == null`

### `area_rules` in zones
Stored in DB as `text` (not JSONB). Python does `JSON.stringify(props.rules)`. Values like `"{}"` or `'{"vehicle_types":["EBIKE"]}'`.
→ Adapter must do `JSON.stringify(props.rules) ?? null`. Field comparison is plain string equality.

**City filter:** Voi pricing IDs are all UUIDs (globally unique) — no `cityPolygonId` filter needed for Voi, unlike Bolt's `scooter_ride` pattern.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `src/lib/scrapers-db.ts` | Modify | Add `VoiAccountRow`, `getVoiAccount()`, `getVoiZoneId()` |
| `src/lib/checks/adapters/voi-adapter.ts` | Create | Full `VoiScraperApiAdapter` |
| `src/lib/field-mappings.ts` | Modify | Add `voi` entry to `FIELD_MAPPINGS` |
| `src/lib/checks/adapters/scraper-adapter.ts` | Modify | Import + register `VoiScraperApiAdapter` |
| `src/lib/__tests__/field-compare.test.ts` | Modify | Add Voi field mapping tests (~16 cases) |

---

## Task 1: scrapers-db helpers

**Files:**
- Modify: `src/lib/scrapers-db.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface VoiAccountRow {
    access_token:  string | null
    refresh_token: string           // authenticationToken (long-lived)
  }
  export async function getVoiAccount(): Promise<VoiAccountRow | null>
  export async function getVoiZoneId(polygonId: string): Promise<string | null>
  ```

- [ ] **Step 1: Append helpers to end of `src/lib/scrapers-db.ts`**

  Add the following after the existing HumanForest helpers (or at end of file):

  ```typescript
  export interface VoiAccountRow {
    access_token:  string | null
    refresh_token: string
  }

  export async function getVoiAccount(): Promise<VoiAccountRow | null> {
    const rows = await scrapersQuery<VoiAccountRow>(
      `SELECT a.access_token,
              a.refresh_token
       FROM accounts a
       JOIN apps ap ON ap.id = a.app_id
       WHERE ap.name = 'voi'
         AND a.is_active = true
       LIMIT 1`,
    )
    return rows[0] ?? null
  }

  export async function getVoiZoneId(polygonId: string): Promise<string | null> {
    const rows = await scrapersQuery<{ zone_id: string }>(
      `SELECT cc.extra_context->>'zone_id' AS zone_id
       FROM city_polygons cp
       JOIN cities c        ON c.id  = cp.city_id
       JOIN city_configs cc ON cc.city_id = c.id
       JOIN apps a          ON a.id  = c.app_id
       WHERE a.name = 'voi'
         AND cp.id::text = $1
       LIMIT 1`,
      [polygonId],
    )
    return rows[0]?.zone_id ?? null
  }
  ```

- [ ] **Step 2: Type-check**
  ```bash
  npx tsc --noEmit
  ```
  Expected: zero errors

- [ ] **Step 3: Commit**
  ```bash
  git add src/lib/scrapers-db.ts
  git commit -m "feat: add Voi scrapers-db helpers (getVoiAccount, getVoiZoneId)"
  ```

---

## Task 2: VoiScraperApiAdapter

**Files:**
- Create: `src/lib/checks/adapters/voi-adapter.ts`

**Interfaces:**
- Consumes:
  - `getVoiAccount(): Promise<VoiAccountRow | null>` from Task 1
  - `getVoiZoneId(polygonId: string): Promise<string | null>` from Task 1
  - `ScraperApiAdapter`, `ApiUnexpectedResponseError` from `./scraper-adapter`
  - `PolygonBounds` from `./scraper-adapter`
  - `EntityType`, `ScraperEntity` from `@/types`
- Produces: `export class VoiScraperApiAdapter implements ScraperApiAdapter`

- [ ] **Step 1: Create `src/lib/checks/adapters/voi-adapter.ts`**

  ```typescript
  import { randomUUID } from 'crypto'
  import { createHash } from 'crypto'
  import { getVoiAccount, getVoiZoneId } from '@/lib/scrapers-db'
  import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
  import { ApiUnexpectedResponseError } from './scraper-adapter'
  import type { EntityType, ScraperEntity } from '@/types'

  // ─── UUID v5 (port of Python uuid.uuid5(uuid.NAMESPACE_OID, name)) ───────────
  // NAMESPACE_OID = '6ba7b812-9dad-11d1-80b4-00c04fd430c8' in bytes

  const VOI_NS = Buffer.from('6ba7b8129dad11d180b400c04fd430c8', 'hex')

  function uuidv5(name: string): string {
    const h = createHash('sha1').update(VOI_NS).update(name, 'utf8').digest()
    h[6] = ((h[6] ?? 0) & 0x0f) | 0x50
    h[8] = ((h[8] ?? 0) & 0x3f) | 0x80
    return [
      h.subarray(0, 4).toString('hex'),
      h.subarray(4, 6).toString('hex'),
      h.subarray(6, 8).toString('hex'),
      h.subarray(8, 10).toString('hex'),
      h.subarray(10, 16).toString('hex'),
    ].join('-')
  }

  // ─── JWT payload decode (no signature verification) ───────────────────────────

  function decodeJwtPayload(token: string): Record<string, unknown> {
    const part = token.split('.')[1]
    if (!part) throw new Error('Invalid JWT: missing payload')
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as Record<string, unknown>
  }

  // ─── Pass price parser — "GBP 24.99" → { amt, currency } ─────────────────────

  function parsePassPrice(priceStr: string): { amt: number | null; currency: string | null } {
    const parts = priceStr.trim().split(/\s+/)
    if (parts.length < 2) return { amt: null, currency: null }
    const currency = parts[0]?.toUpperCase() ?? null
    const amt      = parseFloat((parts[1] ?? '').replace(',', '.'))
    return { amt: isNaN(amt) ? null : amt, currency }
  }

  // ─── Base headers (from voi_base_spider.py) ───────────────────────────────────

  const BASE_HEADERS: Record<string, string> = {
    'Accept-Encoding':  'gzip',
    'brand':            'google',
    'Connection':       'Keep-Alive',
    'manufacturer':     'Google',
    'model':            'sdk_gphone64_x86_64',
    'User-Agent':       'okhttp/5.1.0',
    'X-App-Name':       'Rider',
    'X-App-Version':    '3.320.2',
    'X-Device-Id':      '7784e054303d6420',
    'X-Locale':         'en',
    'X-Locale-Country': 'en_US',
    'X-OS':             'Android',
    'X-OS-Version':     '36',
    'X-Timezone':       'GMT',
  }

  // ─── URLs ─────────────────────────────────────────────────────────────────────

  const VEHICLES_URL = 'https://api.voiapp.io/v2/rides/vehicles'
  const ZONES_URL    = (id: string) => `https://api.voiapp.io/v1/rides/zones/${id}/areas`
  const PASSES_URL   = (id: string) => `https://api.voiapp.io/v2/payments/layout/${id}/product-page`
  const AUTH_URL     = 'https://api.voiapp.io/v1/auth/session'

  // ─── Adapter ──────────────────────────────────────────────────────────────────

  interface VoiState {
    authToken:   string         // authenticationToken (long-lived)
    accessToken: string | null  // short-lived; null = needs refresh
  }

  export class VoiScraperApiAdapter implements ScraperApiAdapter {
    appId = 'voi'
    readonly interPolygonDelayMs = 500
    private state: VoiState | null = null

    polygonStrategy(_entityType: EntityType): 'center_only' {
      return 'center_only'
    }

    async fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]> {
      if (entityType === 'docked') return []
      const state = await this.loadState()
      if (!state.accessToken) await this.refreshToken(state)
      switch (entityType) {
        case 'dockless': return this.fetchDockless(polygon, state)
        case 'pricings': return this.fetchPricings(polygon, state)
        case 'zones':    return this.fetchZones(polygon, state)
      }
    }

    // ─── State / Auth ──────────────────────────────────────────────────────────

    private async loadState(): Promise<VoiState> {
      if (this.state) return this.state
      const row = await getVoiAccount()
      if (!row) throw new Error('No active Voi account found in scrapers_db')
      this.state = { authToken: row.refresh_token, accessToken: row.access_token }
      return this.state
    }

    private async refreshToken(state: VoiState): Promise<void> {
      const res = await fetch(AUTH_URL, {
        method:  'POST',
        headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=UTF-8', 'X-Access-Token': '', 'X-Request-Id': randomUUID() },
        body:    JSON.stringify({ authenticationToken: state.authToken }),
      })
      if (!res.ok) throw new Error(`Voi token refresh failed: HTTP ${res.status}`)
      const data = (await res.json()) as Record<string, unknown>
      if (typeof data['accessToken'] !== 'string') throw new Error('Voi token refresh: no accessToken in response')
      state.accessToken = data['accessToken']
    }

    // ─── HTTP ──────────────────────────────────────────────────────────────────

    private buildHeaders(state: VoiState): Record<string, string> {
      return { ...BASE_HEADERS, 'X-Access-Token': state.accessToken ?? '', 'X-Request-Id': randomUUID() }
    }

    private async get(url: string, state: VoiState, retry = true): Promise<Record<string, unknown>> {
      const res = await fetch(url, { method: 'GET', headers: this.buildHeaders(state) })
      if (res.status === 401 && retry) {
        await this.refreshToken(state)
        return this.get(url, state, false)
      }
      return res.json() as Promise<Record<string, unknown>>
    }

    // ─── Dockless ──────────────────────────────────────────────────────────────

    private async fetchDockless(polygon: PolygonBounds, state: VoiState): Promise<ScraperEntity[]> {
      const zoneId = await getVoiZoneId(polygon.polygonId)
      if (!zoneId) throw new Error(`No Voi zone_id for polygon ${polygon.polygonId}`)

      const url  = `${VEHICLES_URL}?zone_id=${encodeURIComponent(zoneId)}&include_suggestion=false`
      const data = await this.get(url, state)
      const inner = data['data'] as Record<string, unknown> | undefined
      if (!Array.isArray(inner?.['vehicle_groups'])) {
        throw new ApiUnexpectedResponseError('dockless', polygon.polygonId, 'vehicle_groups is not an array')
      }

      const entities: ScraperEntity[] = []
      for (const group of inner['vehicle_groups'] as Record<string, unknown>[]) {
        const groupType = String(group['group_type'] ?? '')
        for (const item of (group['vehicles'] as Record<string, unknown>[]) ?? []) {
          if (!item['id']) continue
          const loc = (item['location'] as Record<string, unknown>) ?? {}
          entities.push({
            id:           String(item['id']),
            vehicle_id:   String(item['id']),
            battery:      item['battery']          ?? null,
            location_lat: loc['lat']               ?? null,
            location_lng: loc['lng']               ?? null,
            zone_id:      item['zone_id'] != null ? String(item['zone_id']) : null,
            category:     (item['category'] as string | undefined) || groupType || null,
          })
        }
      }
      return entities
    }

    // ─── Zones ─────────────────────────────────────────────────────────────────

    private async fetchZones(polygon: PolygonBounds, state: VoiState): Promise<ScraperEntity[]> {
      const zoneId = await getVoiZoneId(polygon.polygonId)
      if (!zoneId) throw new Error(`No Voi zone_id for polygon ${polygon.polygonId}`)

      const url      = `${ZONES_URL(zoneId)}?include_suggestion=false`
      const data     = await this.get(url, state)
      const features = data['features'] as Record<string, unknown>[] | undefined
      if (!Array.isArray(features)) {
        throw new ApiUnexpectedResponseError('zones', polygon.polygonId, 'zones features is not an array')
      }

      return features.map((feature) => {
        const props = (feature['properties'] as Record<string, unknown>) ?? {}
        const geom  = (feature['geometry']  as Record<string, unknown>) ?? {}
        const rules = props['rules'] as Record<string, unknown> | null | undefined
        const vtRaw = rules?.['vehicle_types'] as string[] | undefined
        const vehicleType = Array.isArray(vtRaw) && vtRaw.length > 0
          ? vtRaw.map((v) => v.toLowerCase()).join(', ')
          : null

        return {
          id:                   String(feature['id']),
          zone_id:              String(feature['id']),
          zone_name:            (props['name'] as string | undefined) ?? null,
          type:                 (feature['type'] as string | undefined) ?? null,
          geometry_type:        (geom['type'] as string | undefined) ?? null,
          geometry_coordinates: (geom['coordinates'] as unknown) ?? null,
          area_type:            (props['area_type'] as string | undefined) ?? null,
          area_description:     (props['description'] as string | undefined) ?? null,
          area_priority:        props['priority'] != null ? Number(props['priority']) : null,
          area_zone_id:         props['zone_id']  != null ? String(props['zone_id'])  : null,
          vehicle_type:         vehicleType,
        }
      })
    }

    // ─── Pricings ──────────────────────────────────────────────────────────────

    private async fetchPricings(polygon: PolygonBounds, state: VoiState): Promise<ScraperEntity[]> {
      const zoneId = await getVoiZoneId(polygon.polygonId)
      if (!zoneId) throw new Error(`No Voi zone_id for polygon ${polygon.polygonId}`)

      // Step 1: ride pricings from JWT price_tokens in vehicles response
      const vData  = await this.get(`${VEHICLES_URL}?zone_id=${encodeURIComponent(zoneId)}&include_suggestion=false`, state)
      const inner  = vData['data'] as Record<string, unknown> | undefined
      const groups = (inner?.['vehicle_groups'] as Record<string, unknown>[]) ?? []
      const pricings: ScraperEntity[] = []

      for (const group of groups) {
        const token = group['price_token'] as string | undefined
        if (!token) continue
        const payload     = decodeJwtPayload(token)
        const pid         = String(payload['pid'] ?? '')
        const planName    = (payload['plan_name'] as string | undefined) ?? null
        const vehicleType = String(group['group_type'] ?? '')

        for (const comp of (payload['price_components'] as Record<string, unknown>[]) ?? []) {
          const compName = String(comp['name'] ?? '')
          const planId   = uuidv5(`${pid}_${vehicleType}_${compName}`)
          pricings.push({
            id:                planId,
            pricing_plan_id:   planId,
            pricing_plan_name: planName,
            name:              compName,
            amt:               comp['base_amount']      != null ? Number(comp['base_amount']) / 100      : null,
            currency:          comp['units']             != null ? String(comp['units']).toUpperCase()    : null,
            vehicle_type:      vehicleType || null,
            discount_id:       (comp['discount_id']     as string | undefined) || null,
            discounted_amount: comp['discounted_amount'] != null ? Number(comp['discounted_amount']) / 100 : null,
            discounted_reason: (comp['discount_reason'] as string | undefined) || null,
          })
        }
      }

      // Step 2: pass pricings from product-page
      const pData = await this.get(PASSES_URL(zoneId), state)
      const avail = (pData['data'] as Record<string, unknown>)?.['available'] as Record<string, unknown> | undefined
      const cats  = avail?.['categories'] as Record<string, unknown>[] | undefined

      if (Array.isArray(cats)) {
        for (const category of cats) {
          const planName = (category['name'] as string | undefined) ?? null
          for (const product of (category['products'] as Record<string, unknown>[]) ?? []) {
            const priceStr = String(product['price'] ?? '')
            const { amt, currency } = parsePassPrice(priceStr)

            const bullets = (product['bullets'] as Record<string, unknown>[]) ?? []
            const descriptions = bullets
              .flatMap((b) => (b['text'] as Record<string, unknown>[]) ?? [])
              .map((t) => String(t['content'] ?? '').trim())
              .filter(Boolean)
              .join(' ') || null

            const bannerTexts = ((product['banner'] as Record<string, unknown>)?.['text'] as Record<string, unknown>[]) ?? []
            const discountedReason = bannerTexts
              .map((t) => String(t['content'] ?? '').trim())
              .filter(Boolean)
              .join(' ') || null

            pricings.push({
              id:                String(product['id']),
              pricing_plan_id:   String(product['id']),
              pricing_plan_name: planName,
              name:              (product['title'] as string | undefined) ?? null,
              amt,
              currency,
              vehicle_type:      null,
              descriptions,
              discounted_reason: discountedReason,
            })
          }
        }
      }

      return pricings
    }
  }
  ```

- [ ] **Step 2: Type-check**
  ```bash
  npx tsc --noEmit
  ```
  Expected: zero errors

- [ ] **Step 3: Commit**
  ```bash
  git add src/lib/checks/adapters/voi-adapter.ts
  git commit -m "feat: implement VoiScraperApiAdapter (dockless, zones, pricings ride+pass)"
  ```

---

## Task 3: Field mappings

**Files:**
- Modify: `src/lib/field-mappings.ts`

**Interfaces:**
- Consumes: `normalizeGeoCoords` (already exported from `field-mappings.ts`), `ApiSnapshot`, `FieldMapping`
- Produces: `FIELD_MAPPINGS['voi']` with `dockless`, `zones`, `pricings`, `docked` entries

**Discriminators:**
- Ride pricings: `api['vehicle_type'] != null`
- Pass pricings: `api['vehicle_type'] == null`

- [ ] **Step 1: Add discriminator predicates in `src/lib/field-mappings.ts`**

  Add near the top of the file (after existing `isBolt*` predicates):
  ```typescript
  const isVoiRidePricing = (api: ApiSnapshot) => api['vehicle_type'] != null
  const isVoiPassPricing = (api: ApiSnapshot) => api['vehicle_type'] == null
  ```

- [ ] **Step 2: Add `voi` entry to `FIELD_MAPPINGS` object**

  Add after the `bolt` entry (or wherever the mapping object is defined):
  ```typescript
  voi: {
    dockless: [
      { apiKey: 'vehicle_id',   dbKey: 'vehicle_id' },
      { apiKey: 'zone_id',      dbKey: 'zone_id' },
      { apiKey: 'category',     dbKey: 'category' },
      { apiKey: 'battery',      dbKey: 'battery',      dynamic: true },
      { apiKey: 'location_lat', dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 10000 }, latPair: 'location_lng' },
      { apiKey: 'location_lng', dbKey: 'location_lng', dynamic: true },
    ],
    zones: [
      { apiKey: 'zone_id',              dbKey: 'zone_id'              },
      { apiKey: 'zone_name',            dbKey: 'zone_name'            },
      { apiKey: 'type',                 dbKey: 'type'                 },
      { apiKey: 'geometry_type',        dbKey: 'geometry_type'        },
      { apiKey: 'geometry_coordinates', dbKey: 'geometry_coordinates', normalize: normalizeGeoCoords },
      { apiKey: 'area_type',            dbKey: 'area_type'            },
      { apiKey: 'area_description',     dbKey: 'area_description'     },
      { apiKey: 'area_priority',        dbKey: 'area_priority'        },
      { apiKey: 'area_zone_id',         dbKey: 'area_zone_id'         },
      { apiKey: 'vehicle_type',         dbKey: 'vehicle_type'         },
    ],
    pricings: [
      // Ride pricing (JWT decode — vehicle_type is present)
      { apiKey: 'pricing_plan_id',   dbKey: 'pricing_plan_id',   onlyWhen: isVoiRidePricing },
      { apiKey: 'pricing_plan_name', dbKey: 'pricing_plan_name', onlyWhen: isVoiRidePricing },
      { apiKey: 'name',              dbKey: 'name',              onlyWhen: isVoiRidePricing },
      { apiKey: 'amt',               dbKey: 'amt',               onlyWhen: isVoiRidePricing },
      { apiKey: 'currency',          dbKey: 'currency',          onlyWhen: isVoiRidePricing },
      { apiKey: 'vehicle_type',      dbKey: 'vehicle_type',      onlyWhen: isVoiRidePricing },
      { apiKey: 'discount_id',       dbKey: 'discount_id',       onlyWhen: isVoiRidePricing },
      { apiKey: 'discounted_amount', dbKey: 'discounted_amount', onlyWhen: isVoiRidePricing },
      { apiKey: 'discounted_reason', dbKey: 'discounted_reason', onlyWhen: isVoiRidePricing },
      // Pass pricing (product-page — no vehicle_type)
      { apiKey: 'pricing_plan_id',   dbKey: 'pricing_plan_id',   onlyWhen: isVoiPassPricing },
      { apiKey: 'pricing_plan_name', dbKey: 'pricing_plan_name', onlyWhen: isVoiPassPricing },
      { apiKey: 'name',              dbKey: 'name',              onlyWhen: isVoiPassPricing },
      { apiKey: 'amt',               dbKey: 'amt',               onlyWhen: isVoiPassPricing },
      { apiKey: 'currency',          dbKey: 'currency',          onlyWhen: isVoiPassPricing },
      { apiKey: 'descriptions',      dbKey: 'descriptions',      onlyWhen: isVoiPassPricing },
      { apiKey: 'discounted_reason', dbKey: 'discounted_reason', onlyWhen: isVoiPassPricing },
    ],
    docked: [],
  },
  ```

- [ ] **Step 3: Type-check**
  ```bash
  npx tsc --noEmit
  ```
  Expected: zero errors

- [ ] **Step 4: Commit**
  ```bash
  git add src/lib/field-mappings.ts
  git commit -m "feat: add Voi field mappings (dockless, zones, pricings ride+pass)"
  ```

---

## Task 4: Register adapter

**Files:**
- Modify: `src/lib/checks/adapters/scraper-adapter.ts`

- [ ] **Step 1: Import `VoiScraperApiAdapter` at top of `scraper-adapter.ts`**

  Add alongside existing imports:
  ```typescript
  import { VoiScraperApiAdapter } from './voi-adapter'
  ```

- [ ] **Step 2: Add to `adapterRegistry` Map initializer**

  The registry after change (order alphabetical):
  ```typescript
  _registry = new Map<string, ScraperApiAdapter>([
    ['ario',         new ArioScraperApiAdapter()],
    ['bolt',         new BoltScraperApiAdapter()],
    ['human_forest', new HumanForestScraperApiAdapter()],
    ['voi',          new VoiScraperApiAdapter()],
  ])
  ```

- [ ] **Step 3: Type-check**
  ```bash
  npx tsc --noEmit
  ```
  Expected: zero errors

- [ ] **Step 4: Commit**
  ```bash
  git add src/lib/checks/adapters/scraper-adapter.ts
  git commit -m "feat: register VoiScraperApiAdapter in adapterRegistry"
  ```

---

## Task 5: Unit tests

**Files:**
- Modify: `src/lib/__tests__/field-compare.test.ts`

**What to test:** `compareEntityFields` verdicts and field selection for `voi` / each entity type. Snapshots reflect the real scrapers_db data structure.

- [ ] **Step 1: Add Voi test cases at end of `src/lib/__tests__/field-compare.test.ts`**

  Append the following `describe` blocks:

  ```typescript
  // ── voi / dockless ─────────────────────────────────────────────────────────

  describe('voi / dockless', () => {
    const base = {
      vehicle_id: '5acc1474-fc9f-4947-a1b5-1d0cfc3203d0',
      zone_id:    '327',
      category:   'scooter',
      battery:    48,
      location_lat: 51.485012,
      location_lng: -0.290250,
    }

    it('returns Same when stable fields match (battery and GPS differ acceptably)', () => {
      const api = { ...base }
      const db  = { ...base, battery: 52, location_lat: 51.485100, location_lng: -0.290260 }
      expect(compareEntityFields(api, db, 'dockless', 'voi').verdict).toBe('Same')
    })

    it('returns Different when vehicle_id mismatches', () => {
      const result = compareEntityFields({ ...base, vehicle_id: 'wrong' }, base, 'dockless', 'voi')
      expect(result.verdict).toBe('Different')
      expect(result.explanation).toContain('vehicle_id')
    })

    it('returns Different when category mismatches', () => {
      const result = compareEntityFields({ ...base, category: 'ebike' }, base, 'dockless', 'voi')
      expect(result.verdict).toBe('Different')
      expect(result.explanation).toContain('category')
    })

    it('ignores battery difference (dynamic field)', () => {
      const result = compareEntityFields({ ...base, battery: 10 }, { ...base, battery: 90 }, 'dockless', 'voi')
      expect(result.verdict).toBe('Same')
    })

    it('returns Different when GPS distance exceeds threshold', () => {
      const result = compareEntityFields(
        { ...base, location_lat: 52.0, location_lng: 0.0 },
        base,
        'dockless', 'voi',
      )
      expect(result.verdict).toBe('Different')
      expect(result.explanation).toContain('location_lat')
    })
  })

  // ── voi / zones ─────────────────────────────────────────────────────────────

  describe('voi / zones', () => {
    const base = {
      zone_id:              'b512210a-e65b-40a7-a628-7c75b78f6521',
      zone_name:            'Portobello Road',
      type:                 'Feature',
      geometry_type:        'MultiPolygon',
      geometry_coordinates: [[[[-0.203127, 51.513362]]]],
      area_type:            'no-riding',
      area_description:     'Police Request',
      area_priority:        0,
      area_zone_id:         '327',
      vehicle_type:         'ebike',
    }

    it('returns Same when all fields match', () => {
      expect(compareEntityFields(base, base, 'zones', 'voi').verdict).toBe('Same')
    })

    it('returns Different when area_type mismatches', () => {
      const result = compareEntityFields({ ...base, area_type: 'speed-limit' }, base, 'zones', 'voi')
      expect(result.verdict).toBe('Different')
      expect(result.explanation).toContain('area_type')
    })

    it('returns Different when geometry_coordinates differ', () => {
      const result = compareEntityFields(
        { ...base, geometry_coordinates: [[[[-0.99, 51.0]]]] },
        base,
        'zones', 'voi',
      )
      expect(result.verdict).toBe('Different')
    })

    it('returns Different when vehicle_type mismatches', () => {
      const result = compareEntityFields({ ...base, vehicle_type: 'scooter' }, base, 'zones', 'voi')
      expect(result.verdict).toBe('Different')
      expect(result.explanation).toContain('vehicle_type')
    })
  })

  // ── voi / pricings (ride) ───────────────────────────────────────────────────

  describe('voi / pricings (ride)', () => {
    const base = {
      pricing_plan_id:   '15654f9b-0d3d-56fd-876a-421a1f27b38b',
      pricing_plan_name: 'dynamic_price',
      name:              'per_minute_cost',
      amt:               0.25,
      currency:          'EUR',
      vehicle_type:      'scooter',       // non-null → ride pricing
      discount_id:       null,
      discounted_amount: 0.25,
      discounted_reason: null,
    }

    it('returns Same when all ride fields match', () => {
      expect(compareEntityFields(base, base, 'pricings', 'voi').verdict).toBe('Same')
    })

    it('returns Different when amt mismatches', () => {
      const result = compareEntityFields({ ...base, amt: 0.30 }, base, 'pricings', 'voi')
      expect(result.verdict).toBe('Different')
      expect(result.explanation).toContain('amt')
    })

    it('returns Different when vehicle_type mismatches', () => {
      const result = compareEntityFields({ ...base, vehicle_type: 'ebike' }, base, 'pricings', 'voi')
      expect(result.verdict).toBe('Different')
      expect(result.explanation).toContain('vehicle_type')
    })

    it('pass-only fields (descriptions) are not compared for ride pricing', () => {
      // If pass-only fields leaked into ride comparison they would flag a mismatch on undefined vs null
      const result = compareEntityFields(
        { ...base, descriptions: 'API text' },
        { ...base },
        'pricings', 'voi',
      )
      expect(result.verdict).toBe('Same')
    })
  })

  // ── voi / pricings (pass) ───────────────────────────────────────────────────

  describe('voi / pricings (pass)', () => {
    const base = {
      pricing_plan_id:   '195d7bee-e755-4b4c-bad7-76ed5d88cad1',
      pricing_plan_name: 'Prepay and save',
      name:              '300 minutes',
      amt:               24.99,
      currency:          'GBP',
      vehicle_type:      null,            // null → pass pricing
      descriptions:      'Valid for 30 days',
      discounted_reason: null,
    }

    it('returns Same when all pass fields match', () => {
      expect(compareEntityFields(base, base, 'pricings', 'voi').verdict).toBe('Same')
    })

    it('returns Different when amt mismatches', () => {
      const result = compareEntityFields({ ...base, amt: 19.99 }, base, 'pricings', 'voi')
      expect(result.verdict).toBe('Different')
      expect(result.explanation).toContain('amt')
    })

    it('returns Different when descriptions mismatch', () => {
      const result = compareEntityFields({ ...base, descriptions: 'Valid for 7 days' }, base, 'pricings', 'voi')
      expect(result.verdict).toBe('Different')
      expect(result.explanation).toContain('descriptions')
    })

    it('ride-only fields (vehicle_type non-null check) do not apply to pass pricing', () => {
      // Confirm pass pricing rows don't accidentally compare ride-only discounted_amount
      const result = compareEntityFields(
        { ...base, discounted_amount: 99.0 },
        { ...base },
        'pricings', 'voi',
      )
      expect(result.verdict).toBe('Same')
    })
  })
  ```

- [ ] **Step 2: Run tests — expect all 16 new cases to pass**
  ```bash
  npx vitest run src/lib/__tests__/field-compare.test.ts
  ```
  Expected: all tests pass (Tasks 3 adds the mappings required by Task 5)

- [ ] **Step 3: Run full test suite to check for regressions**
  ```bash
  npx vitest run
  ```
  Expected: all tests pass

- [ ] **Step 4: Commit**
  ```bash
  git add src/lib/__tests__/field-compare.test.ts
  git commit -m "test: add Voi field mapping unit tests (dockless, zones, pricings ride+pass)"
  ```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| Auth: token refresh on 401 | Task 2 (`refreshToken`) |
| City context: `zone_id` from `city_configs` | Task 1 (`getVoiZoneId`) |
| Dockless: `/v2/rides/vehicles` | Task 2 (`fetchDockless`) |
| Zones: `/v1/rides/zones/{id}/areas` | Task 2 (`fetchZones`) |
| Ride pricing: JWT decode + uuid5 | Task 2 (`fetchPricings` step 1) |
| Pass pricing: `/v2/payments/layout/{id}/product-page` | Task 2 (`fetchPricings` step 2) |
| All types use `center_only` polygon strategy | Task 2 (`polygonStrategy`) |
| `docked` returns empty | Task 2 (`fetchEntities`) |
| Field mappings: dockless (6 fields) | Task 3 |
| Field mappings: zones (10 fields) | Task 3 |
| Field mappings: ride pricing with discriminator | Task 3 |
| Field mappings: pass pricing with discriminator | Task 3 |
| Registration in `adapterRegistry` | Task 4 |
| Unit tests (16 cases across 4 suites) | Task 5 |

### Notes on edge cases

- **uuid5 correctness:** The `uuidv5` function must produce identical output to Python's `uuid.uuid5(uuid.NAMESPACE_OID, name)`. After implementing, run a spot-check: pick any Voi ride pricing from scrapers_db, find its JWT `price_token` in the vehicles API response, manually compute `uuidv5(f"{pid}_{vehicle_type}_{component_name}")` in a Node.js REPL, and compare to the `pricing_plan_id` in the DB.

- **geometry_coordinates with `normalizeGeoCoords`:** Voi zones are `MultiPolygon` (depth-4 array: `[[[[lng, lat]]]]`). The existing `normalizeGeoCoords` was designed for Bolt. Verify no spurious mismatches appear in a real session — if they do, skip geometry_coordinates normalization for Voi zones.

- **`price_token` per vehicle_group:** Multiple groups may share the same `price_token` (same `pid` + `vehicle_type`). The uuid5 formula produces the same `pricing_plan_id` for identical `{pid}_{vehicleType}_{compName}` — deduplication via the `EntityCheckSummary.totalUniqueInApi` set will handle this correctly.

- **Empty `price_token`:** If a vehicle_group has no `price_token`, ride pricing is skipped for that group. This is correct — some groups may not have pricing data.

- **Pass price format variants:** The `parsePassPrice` function handles `"GBP 24.99"` (space-separated code + amount). If Voi uses symbol prefixes (€6.49) in some markets, the parse returns `{ amt: null, currency: null }` — the field comparison will flag a mismatch, alerting the implementer to extend the parser.
