# Human Forest Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `HumanForestScraperApiAdapter` so the quality tool can run API→DB checks for the Human Forest scraper (bikes in Greater London).

**Architecture:** A single adapter class in `src/lib/checks/adapters/human-forest-adapter.ts` implements `ScraperApiAdapter`. Auth (sign-in + token refresh) is managed in-memory — never written back to scrapers_db. The adapter is registered in `adapterRegistry` under the key `'human_forest'`.

**Tech Stack:** TypeScript, native `fetch`, Vitest 4, existing `uuidv5` utility, existing `scrapersQuery` helper.

## Global Constraints

- `scrapers_db` is **read-only** — never INSERT/UPDATE/DELETE; tokens updated in-memory only
- `appId` key = `apps.name` in scrapers_db = `'human_forest'` (string, not integer id)
- Vitest 4, config `vitest.config.mts`, env from `.env.local`
- Test file must use `vi.mock` — no real network or DB calls in tests
- `uuidv5(name)` — already implemented in `src/lib/uuid5.ts`, uses `NAMESPACE_OID` — matches Python scraper
- Run tests: `npm test`

---

## API Reference

**Base URL:** `https://api.forest.me`

**Common headers (all authenticated requests):**
```
accept: application/json
accept-encoding: gzip
user-agent: Forest/11.5.0 (785) (sdk_gphone64_x86_64; ranchu; 74:42:9A:47:93:C7:7A:FB:EA:2B:79:8E:03:BC:2C:24:EF:30:84:EE:C8:0F:A8:C0:A5:40:A4:60:54:25:CB:65)
authorization: Bearer {accessToken}
```

**Auth — sign-in:**
```
POST /v2/auth/login
content-type: application/json
body: {"email": "...", "password": "..."}
response: { "data": { "accessToken": "...", "refreshToken": "..." } }
```

**Auth — refresh:**
```
POST /v2/auth/refresh-token
content-type: application/x-www-form-urlencoded
body: refreshToken=...&grantType=refresh_token
response: { "data": { "accessToken": "...", "refreshToken": "..." } }
```
Both auth requests: **no** `authorization` header, no `accept-encoding`.

**Dockless (2 sequential requests per polygon):**
```
1. GET /v1/vehicles/types?lat1={south}&lon1={west}&lat2={north}&lon2={east}
   response: { "status": "OK", "data": [{ "vehicleTypeId": 1, "title": "Forest Bike", ... }] }

2. GET /v1/vehicles?lat1={south}&lon1={west}&lat2={north}&lon2={east}
   response: [{ "id": 10203, "fuelLevel": 57, "lat": 51.5, "lon": -0.14, "vehicleTypeId": 1, ... }]
```

**Pricings (2 requests, only run once — center_only):**
```
1. GET /v1/bundles
   response: { "success": true, "data": { "items": [{ "id": "uuid", "title": "...", "priceValue": 14.99, "creditsValue": 1440, "price": "£14.99", "description": "...", "metadata": { "expirationTimeSeconds": 86400 } }] } }

2. GET /v1/vehicles/types?lat1={south}&lon1={west}&lat2={north}&lon2={east}
   (same as dockless step 1 — builds vehicle type pricing rows)
```

**Zones (1 request, only run once — center_only):**
```
GET /v1/territories?location_id=1&types=0&types=1&types=2&types=5&types=6
response: [{ "type": 0, "territory": { "type": "FeatureCollection", "features": [{ "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [...] }, "properties": { "name": "BUSINESS_AREA - ba_default", "type": 0 } }] } }]
```

---

## Entity ID Derivation

| Entity type | Source | ID field |
|-------------|--------|----------|
| dockless | `vehicle.id` (int) | `String(vehicle.id)` |
| pricings (bundles) | `bundle.id` (UUID string from API) | use as-is |
| pricings (vehicle types) | deterministic | `uuidv5("human_forest_{vehicleTypeId}_{name}")` where name ∈ `unlock`/`per_minute`/`parking` |
| zones | deterministic from feature name | `uuidv5(feature.properties.name)` or `uuidv5("{type}_{idx}")` if name absent |

---

## ApiUnexpectedResponseError Triggers

| Endpoint | Condition |
|----------|-----------|
| `/v1/vehicles/types` | `data.status !== 'OK'` or `!Array.isArray(data.data)` |
| `/v1/vehicles` | response is not an array |
| `/v1/bundles` | `data.success !== true` |
| `/v1/territories` | response is not an array |

---

## File Map

| File | Action |
|------|--------|
| `src/lib/scrapers-db.ts` | Modify — add `HumanForestAccountRow` + `getHumanForestAccount()` |
| `src/lib/checks/adapters/human-forest-adapter.ts` | Create — full adapter implementation |
| `src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts` | Create — unit tests |
| `src/lib/checks/adapters/scraper-adapter.ts` | Modify — register adapter in `adapterRegistry` |

---

## Task 1: Add DB helper for Human Forest account

**Files:**
- Modify: `src/lib/scrapers-db.ts`

**Interfaces:**
- Produces: `HumanForestAccountRow` + `getHumanForestAccount(): Promise<HumanForestAccountRow | null>`
- Produces: `HumanForestZoneContextRow` + `getHumanForestZoneContext(polygonId: string): Promise<HumanForestZoneContextRow | null>`

- [ ] **Step 1: Add interface and function to scrapers-db.ts**

Open `src/lib/scrapers-db.ts` and append at the end (after `getArioAccount`):

```typescript
export interface HumanForestAccountRow {
  email:         string
  password:      string
  access_token:  string | null
  refresh_token: string
}

export async function getHumanForestAccount(): Promise<HumanForestAccountRow | null> {
  const rows = await scrapersQuery<HumanForestAccountRow>(
    `SELECT a.email,
            a.password,
            a.access_token,
            a.refresh_token
     FROM accounts a
     JOIN apps ap ON ap.id = a.app_id
     WHERE ap.name = 'human_forest'
       AND a.is_active = true
     LIMIT 1`,
  )
  return rows[0] ?? null
}

export interface HumanForestZoneContextRow {
  location_id: string   // pg returns as string; parse to int in adapter
  types:       number[] // parsed JSONB array
}

export async function getHumanForestZoneContext(
  polygonId: string,
): Promise<HumanForestZoneContextRow | null> {
  // Looks up location_id and types from the most recent collection_task
  // that belongs to the same city as the given polygon.
  // This allows the adapter to work for any future city Human Forest may expand to.
  const rows = await scrapersQuery<HumanForestZoneContextRow>(
    `SELECT ct.extra_context->>'location_id' AS location_id,
            ARRAY(
              SELECT jsonb_array_elements_text(ct.extra_context->'types')::int
            ) AS types
     FROM collection_tasks ct
     JOIN city_polygons cp ON cp.id = ct.city_polygon_id
     JOIN apps a ON a.id = ct.app_id
     WHERE a.name = 'human_forest'
       AND ct.extra_context->>'location_id' IS NOT NULL
       AND cp.city_id = (
             SELECT city_id FROM city_polygons WHERE id::text = $1 LIMIT 1
           )
     ORDER BY ct.id DESC
     LIMIT 1`,
    [polygonId],
  )
  return rows[0] ?? null
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scrapers-db.ts
git commit -m "feat: add getHumanForestAccount query to scrapers-db"
```

---

## Task 2: Adapter skeleton — auth + account loading

**Files:**
- Create: `src/lib/checks/adapters/human-forest-adapter.ts`
- Create: `src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts`

**Interfaces:**
- Consumes: `HumanForestAccountRow`, `getHumanForestAccount()` from `@/lib/scrapers-db`
- Consumes: `ScraperApiAdapter`, `PolygonBounds`, `ApiUnexpectedResponseError` from `./scraper-adapter`
- Consumes: `EntityType`, `ScraperEntity` from `@/types`
- Produces: `HumanForestScraperApiAdapter` class (implements `ScraperApiAdapter`)

- [ ] **Step 1: Write failing test for auth — account not found**

Create `src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HumanForestScraperApiAdapter } from '@/lib/checks/adapters/human-forest-adapter'

vi.mock('@/lib/scrapers-db', () => ({
  getHumanForestAccount: vi.fn(),
}))

import { getHumanForestAccount } from '@/lib/scrapers-db'
const mockGetAccount = vi.mocked(getHumanForestAccount)

const MOCK_POLYGON = {
  polygonId: '42',
  boundBox:  { south: 51.28, west: -0.51, north: 51.69, east: 0.33 },
  polygonType: null,
  city: 'London',
}

describe('HumanForestScraperApiAdapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when no active account found', async () => {
    mockGetAccount.mockResolvedValue(null)
    const adapter = new HumanForestScraperApiAdapter()
    await expect(adapter.fetchEntities(MOCK_POLYGON, 'dockless')).rejects.toThrow(
      'No active Human Forest account found in scrapers_db',
    )
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- human-forest-adapter
```

Expected: FAIL — `Cannot find module '@/lib/checks/adapters/human-forest-adapter'`.

- [ ] **Step 3: Create adapter skeleton**

Create `src/lib/checks/adapters/human-forest-adapter.ts`:

```typescript
import { getHumanForestAccount } from '@/lib/scrapers-db'
import { uuidv5 } from '@/lib/uuid5'
import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import { ApiUnexpectedResponseError } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL      = 'https://api.forest.me'
const LOGIN_URL     = `${BASE_URL}/v2/auth/login`
const REFRESH_URL   = `${BASE_URL}/v2/auth/refresh-token`
const VEHICLES_URL  = `${BASE_URL}/v1/vehicles`
const VEH_TYPES_URL = `${BASE_URL}/v1/vehicles/types`
const BUNDLES_URL   = `${BASE_URL}/v1/bundles`
const ZONES_URL     = `${BASE_URL}/v1/territories`

const USER_AGENT =
  'Forest/11.5.0 (785) (sdk_gphone64_x86_64; ranchu; 74:42:9A:47:93:C7:7A:FB:' +
  'EA:2B:79:8E:03:BC:2C:24:EF:30:84:EE:C8:0F:A8:C0:A5:40:A4:60:54:25:CB:65)'

const BASE_HEADERS = {
  'accept':          'application/json',
  'accept-encoding': 'gzip',
  'user-agent':      USER_AGENT,
}

// ─── Internal account state ───────────────────────────────────────────────────

interface HumanForestAccount {
  email:        string
  password:     string
  accessToken:  string | null
  refreshToken: string
}

interface BoundBox {
  south: number
  west:  number
  north: number
  east:  number
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class HumanForestScraperApiAdapter implements ScraperApiAdapter {
  appId = 'human_forest'
  readonly interPolygonDelayMs = 1000
  private account: HumanForestAccount | null = null

  polygonStrategy(entityType: EntityType): 'all' | 'center_only' {
    return entityType === 'dockless' ? 'all' : 'center_only'
  }

  async fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]> {
    if (entityType === 'docked') return []

    const account = await this.getAccount()
    if (!account.accessToken) await this.refreshToken(account)

    switch (entityType) {
      case 'dockless': return this.fetchDockless(polygon, account)
      case 'pricings': return this.fetchPricings(polygon, account)
      case 'zones':    return this.fetchZones(polygon, account)
    }
  }

  // ─── Account loading ────────────────────────────────────────────────────────

  private async getAccount(): Promise<HumanForestAccount> {
    if (this.account) return this.account
    const row = await getHumanForestAccount()
    if (!row) throw new Error('No active Human Forest account found in scrapers_db')
    this.account = {
      email:        row.email,
      password:     row.password,
      accessToken:  row.access_token,
      refreshToken: row.refresh_token,
    }
    return this.account
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  private async refreshToken(account: HumanForestAccount): Promise<void> {
    const body = new URLSearchParams({
      refreshToken: account.refreshToken,
      grantType:    'refresh_token',
    })
    const res = await fetch(REFRESH_URL, {
      method:  'POST',
      headers: { ...BASE_HEADERS, 'content-type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })
    if (res.status === 401) {
      await this.signIn(account)
      return
    }
    const data = (await res.json() as Record<string, unknown>)
    const tokens = data['data'] as Record<string, unknown>
    account.accessToken  = tokens['accessToken']  as string
    account.refreshToken = tokens['refreshToken'] as string
  }

  private async signIn(account: HumanForestAccount): Promise<void> {
    const res = await fetch(LOGIN_URL, {
      method:  'POST',
      headers: { ...BASE_HEADERS, 'content-type': 'application/json' },
      body:    JSON.stringify({ email: account.email, password: account.password }),
    })
    if (!res.ok) throw new Error(`Human Forest sign-in failed: HTTP ${res.status}`)
    const data = (await res.json() as Record<string, unknown>)
    const tokens = data['data'] as Record<string, unknown>
    account.accessToken  = tokens['accessToken']  as string
    account.refreshToken = tokens['refreshToken'] as string
  }

  // ─── Authenticated GET helper ────────────────────────────────────────────────

  private async get(
    url: string,
    account: HumanForestAccount,
    retry = true,
  ): Promise<unknown> {
    const res = await fetch(url, {
      method:  'GET',
      headers: { ...BASE_HEADERS, authorization: `Bearer ${account.accessToken ?? ''}` },
    })
    if (res.status === 401 && retry) {
      await this.refreshToken(account)
      return this.get(url, account, false)
    }
    return res.json()
  }

  // ─── Entity fetchers (stubs — filled in Tasks 3–5) ──────────────────────────

  private async fetchDockless(_polygon: PolygonBounds, _account: HumanForestAccount): Promise<ScraperEntity[]> {
    throw new Error('not implemented')
  }

  private async fetchPricings(_polygon: PolygonBounds, _account: HumanForestAccount): Promise<ScraperEntity[]> {
    throw new Error('not implemented')
  }

  private async fetchZones(_polygon: PolygonBounds, _account: HumanForestAccount): Promise<ScraperEntity[]> {
    throw new Error('not implemented')
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  protected parseBoundBox(polygon: PolygonBounds): BoundBox {
    const bb = polygon.boundBox as Record<string, unknown>
    if (typeof bb?.south !== 'number' || typeof bb?.west !== 'number' ||
        typeof bb?.north !== 'number' || typeof bb?.east !== 'number') {
      throw new Error(`Polygon ${polygon.polygonId} has no valid boundBox for Human Forest API`)
    }
    return { south: bb.south, west: bb.west, north: bb.north, east: bb.east }
  }

  protected bboxParams(bb: BoundBox): string {
    return `lat1=${bb.south}&lon1=${bb.west}&lat2=${bb.north}&lon2=${bb.east}`
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- human-forest-adapter
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/checks/adapters/human-forest-adapter.ts \
        src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts
git commit -m "feat: add HumanForestScraperApiAdapter skeleton with auth"
```

---

## Task 3: Implement fetchDockless

**Files:**
- Modify: `src/lib/checks/adapters/human-forest-adapter.ts` — replace `fetchDockless` stub
- Modify: `src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts` — add tests

**Interfaces:**
- Consumes: `bboxParams()`, `parseBoundBox()`, `get()` from adapter
- Produces: `ScraperEntity[]` where `id = String(vehicle.id)`; includes `battery`, `lat`, `lon`, `category`, and other API fields

**API chain:**
1. `GET /v1/vehicles/types?{bboxParams}` → build `vehicleTypeMap: Map<string, string>`
2. `GET /v1/vehicles?{bboxParams}` → array of vehicle objects, enrich `category` from map

- [ ] **Step 1: Write failing tests**

Add to `describe('HumanForestScraperApiAdapter')` in the test file:

```typescript
describe('fetchEntities dockless', () => {
  it('returns mapped entities with category from vehicle type map', async () => {
    mockGetAccount.mockResolvedValue({
      email: 'test@example.com', password: 'pw',
      access_token: 'tok', refresh_token: 'ref',
    })

    const vehicleTypesResponse = {
      status: 'OK',
      data: [
        { vehicleTypeId: 1, title: 'Forest Bike', pricingTime: '£0.33/min', pricingParking: '£0.33/min', unlockFee: '£1.0', pricing: { pricePerMinute: 0.33, pricePerParkingMinute: 0.33, unlockFee: 1.0, currencyCode: 'GBP' } },
      ],
    }
    const vehiclesResponse = [
      { id: 10203, fuelLevel: 57, lat: 51.507961, lon: -0.140269, vehicleTypeId: 1, vehicleStateId: 0, locationId: 1 },
      { id: 10204, fuelLevel: 30, lat: 51.508000, lon: -0.141000, vehicleTypeId: 99, vehicleStateId: 0, locationId: 1 },
    ]

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => vehicleTypesResponse })
      .mockResolvedValueOnce({ status: 200, json: async () => vehiclesResponse }),
    )

    const adapter = new HumanForestScraperApiAdapter()
    const result = await adapter.fetchEntities(MOCK_POLYGON, 'dockless')

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: '10203', battery: 57, lat: 51.507961, lon: -0.140269, category: 'Forest Bike' })
    expect(result[1]).toMatchObject({ id: '10204', category: null }) // unknown vehicleTypeId
  })

  it('throws ApiUnexpectedResponseError when vehicle types status is not OK', async () => {
    mockGetAccount.mockResolvedValue({
      email: 'test@example.com', password: 'pw',
      access_token: 'tok', refresh_token: 'ref',
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ status: 'ERROR', data: [] }) }),
    )

    const adapter = new HumanForestScraperApiAdapter()
    await expect(adapter.fetchEntities(MOCK_POLYGON, 'dockless')).rejects.toBeInstanceOf(
      (await import('@/lib/checks/adapters/scraper-adapter')).ApiUnexpectedResponseError,
    )
  })

  it('throws ApiUnexpectedResponseError when vehicles response is not an array', async () => {
    mockGetAccount.mockResolvedValue({
      email: 'test@example.com', password: 'pw',
      access_token: 'tok', refresh_token: 'ref',
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ status: 'OK', data: [{ vehicleTypeId: 1, title: 'Forest Bike' }] }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ error: 'rate limited' }) }),
    )

    const adapter = new HumanForestScraperApiAdapter()
    await expect(adapter.fetchEntities(MOCK_POLYGON, 'dockless')).rejects.toBeInstanceOf(
      (await import('@/lib/checks/adapters/scraper-adapter')).ApiUnexpectedResponseError,
    )
  })

  it('returns [] for docked entity type', async () => {
    mockGetAccount.mockResolvedValue({
      email: 'test@example.com', password: 'pw',
      access_token: 'tok', refresh_token: 'ref',
    })
    const adapter = new HumanForestScraperApiAdapter()
    const result = await adapter.fetchEntities(MOCK_POLYGON, 'docked')
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- human-forest-adapter
```

Expected: FAIL — `not implemented`.

- [ ] **Step 3: Implement fetchDockless**

Replace the `fetchDockless` stub in `human-forest-adapter.ts`:

```typescript
private async fetchDockless(polygon: PolygonBounds, account: HumanForestAccount): Promise<ScraperEntity[]> {
  const bb = this.parseBoundBox(polygon)
  const params = this.bboxParams(bb)

  // Step 1: vehicle types → build id→title map
  const vtData = await this.get(`${VEH_TYPES_URL}?${params}`, account) as Record<string, unknown>
  if (vtData['status'] !== 'OK' || !Array.isArray(vtData['data'])) {
    throw new ApiUnexpectedResponseError(
      'dockless', polygon.polygonId,
      `vehicle types returned unexpected structure: status=${vtData['status']}`,
    )
  }
  const vehicleTypeMap = new Map<string, string>(
    (vtData['data'] as Array<{ vehicleTypeId: number; title: string }>)
      .map((vt) => [String(vt.vehicleTypeId), vt.title]),
  )

  // Step 2: vehicles
  const vehicles = await this.get(`${VEHICLES_URL}?${params}`, account)
  if (!Array.isArray(vehicles)) {
    throw new ApiUnexpectedResponseError(
      'dockless', polygon.polygonId,
      'vehicles endpoint returned non-array response',
    )
  }

  return (vehicles as Array<Record<string, unknown>>).map((v) => ({
    id:       String(v['id']),
    battery:  v['fuelLevel'] ?? null,
    lat:      v['lat']       ?? null,
    lon:      v['lon']       ?? null,
    category: vehicleTypeMap.get(String(v['vehicleTypeId'] ?? '')) ?? null,
    ...v,
  }))
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- human-forest-adapter
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/checks/adapters/human-forest-adapter.ts \
        src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts
git commit -m "feat: implement fetchDockless for Human Forest adapter"
```

---

## Task 4: Implement fetchPricings

**Files:**
- Modify: `src/lib/checks/adapters/human-forest-adapter.ts` — replace `fetchPricings` stub
- Modify: `src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts` — add tests

**Interfaces:**
- Produces: `ScraperEntity[]` combining bundle entities and vehicle-type pricing entities
  - Bundle: `id = bundle.id` (UUID string from API), `name = 'per_minute'`, `amt = priceValue / creditsValue`, `currency`, `pricingPlanName`, `description`, `expirationTimeSeconds`
  - VehicleType: `id = uuidv5("human_forest_{vehicleTypeId}_{name}")`, `name ∈ unlock|per_minute|parking`, `amt`, `currency`, `vehicleType = title`

**Currency extraction:** strip all digits and `.` from price string; `£` → `GBP`, `$` → `USD`, `€` → `EUR`.

- [ ] **Step 1: Write failing tests**

Add inside `describe('HumanForestScraperApiAdapter')`:

```typescript
describe('fetchEntities pricings', () => {
  const mockAccount = {
    email: 'test@example.com', password: 'pw',
    access_token: 'tok', refresh_token: 'ref',
  }

  const bundlesResponse = {
    success: true,
    data: {
      items: [
        {
          id: 'e18ed7df-d1da-4fbe-807a-3128dab532cf',
          title: '24hrs unlimited rides',
          price: '£14.99',
          priceValue: 14.99,
          creditsValue: 1440,
          description: 'Ride as much as you like for 24 hours.',
          metadata: { expirationTimeSeconds: 86400 },
        },
      ],
    },
  }

  const vehicleTypesResponse = {
    status: 'OK',
    data: [
      {
        vehicleTypeId: 1,
        title: 'Forest Bike',
        pricingTime: '£0.33/min',
        pricingParking: '£0.33/min',
        unlockFee: '£1.0',
        pricing: { pricePerMinute: 0.33, pricePerParkingMinute: 0.33, unlockFee: 1.0, currencyCode: 'GBP' },
      },
    ],
  }

  it('returns bundle entities and vehicle-type pricing entities combined', async () => {
    mockGetAccount.mockResolvedValue(mockAccount)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => bundlesResponse })
      .mockResolvedValueOnce({ status: 200, json: async () => vehicleTypesResponse }),
    )

    const adapter = new HumanForestScraperApiAdapter()
    const result = await adapter.fetchEntities(MOCK_POLYGON, 'pricings')

    // 1 bundle + 3 vehicle-type rows (unlock, per_minute, parking)
    expect(result).toHaveLength(4)

    const bundle = result.find((r) => r['id'] === 'e18ed7df-d1da-4fbe-807a-3128dab532cf')
    expect(bundle).toBeDefined()
    expect(bundle).toMatchObject({ currency: 'GBP', pricingPlanName: '24hrs unlimited rides' })

    const unlock = result.find((r) => (r['name'] as string) === 'unlock')
    expect(unlock).toBeDefined()
    expect(unlock!['id']).toMatch(/^[0-9a-f-]{36}$/) // uuid format
    expect(unlock).toMatchObject({ amt: 1.0, currency: 'GBP', vehicleType: 'Forest Bike' })

    const parking = result.find((r) => (r['name'] as string) === 'parking')
    expect(parking).toBeDefined()
    expect(parking).toMatchObject({ amt: 0.33, currency: 'GBP' })
  })

  it('throws ApiUnexpectedResponseError when bundles returns success: false', async () => {
    mockGetAccount.mockResolvedValue(mockAccount)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ success: false }) }),
    )

    const adapter = new HumanForestScraperApiAdapter()
    await expect(adapter.fetchEntities(MOCK_POLYGON, 'pricings')).rejects.toBeInstanceOf(
      (await import('@/lib/checks/adapters/scraper-adapter')).ApiUnexpectedResponseError,
    )
  })

  it('skips vehicle-type pricing rows where price string has no currency symbol', async () => {
    mockGetAccount.mockResolvedValue(mockAccount)
    const vtNoPrice = {
      status: 'OK',
      data: [{
        vehicleTypeId: 2,
        title: 'Test Bike',
        pricingTime: 'Free',     // no currency symbol → skip
        pricingParking: 'Free',  // no currency symbol → skip
        unlockFee: '£1.0',       // has symbol → include
        pricing: { pricePerMinute: 0, pricePerParkingMinute: 0, unlockFee: 1.0, currencyCode: 'GBP' },
      }],
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ success: true, data: { items: [] } }) })
      .mockResolvedValueOnce({ status: 200, json: async () => vtNoPrice }),
    )

    const adapter = new HumanForestScraperApiAdapter()
    const result = await adapter.fetchEntities(MOCK_POLYGON, 'pricings')
    expect(result).toHaveLength(1) // only unlock
    expect(result[0]!['name']).toBe('unlock')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- human-forest-adapter
```

Expected: FAIL — `not implemented`.

- [ ] **Step 3: Implement fetchPricings**

Replace the `fetchPricings` stub in `human-forest-adapter.ts`:

```typescript
private readonly CURRENCY_MAP: Record<string, string> = { '£': 'GBP', '$': 'USD', '€': 'EUR' }

private parseCurrency(priceStr: string): string | null {
  const sym = priceStr.replace(/[\d.]/g, '')
  return this.CURRENCY_MAP[sym] ?? null
}

private async fetchPricings(polygon: PolygonBounds, account: HumanForestAccount): Promise<ScraperEntity[]> {
  const results: ScraperEntity[] = []

  // Step 1: bundles
  const bundleData = await this.get(BUNDLES_URL, account) as Record<string, unknown>
  if (bundleData['success'] !== true) {
    throw new ApiUnexpectedResponseError(
      'pricings', polygon.polygonId,
      'bundles endpoint returned success: false',
    )
  }
  const items = ((bundleData['data'] as Record<string, unknown>)['items'] as Array<Record<string, unknown>>) ?? []
  for (const item of items) {
    results.push({
      id:             item['id'] as string,
      pricingPlanName: item['title'] as string,
      name:           'per_minute',
      amt:            (item['priceValue'] as number) / (item['creditsValue'] as number),
      currency:       this.parseCurrency(item['price'] as string),
      description:    item['description'] ?? null,
      expirationTimeSeconds: (item['metadata'] as Record<string, unknown> | null)?.['expirationTimeSeconds'] ?? null,
      ...item,
    })
  }

  // Step 2: vehicle type pricing (same endpoint as dockless step 1)
  const bb = this.parseBoundBox(polygon)
  const vtData = await this.get(`${VEH_TYPES_URL}?${this.bboxParams(bb)}`, account) as Record<string, unknown>
  if (vtData['status'] !== 'OK' || !Array.isArray(vtData['data'])) {
    throw new ApiUnexpectedResponseError(
      'pricings', polygon.polygonId,
      `vehicle types returned unexpected structure during pricing: status=${vtData['status']}`,
    )
  }

  type VehicleType = { vehicleTypeId: number; title: string; unlockFee: string; pricingTime: string; pricingParking: string; pricing: { pricePerMinute: number; pricePerParkingMinute: number; unlockFee: number; currencyCode: string } }
  const rows: Array<[string, string, number]> = [] // [name, rawStr, amt]
  for (const vt of vtData['data'] as VehicleType[]) {
    rows.push(['unlock',     vt.unlockFee,       vt.pricing.unlockFee])
    rows.push(['per_minute', vt.pricingTime,     vt.pricing.pricePerMinute])
    rows.push(['parking',    vt.pricingParking,  vt.pricing.pricePerParkingMinute])

    for (const [name, rawStr, amt] of rows) {
      const currency = this.parseCurrency(rawStr)
      if (currency === null) continue // no currency symbol → skip (Free / N/A)
      results.push({
        id:          uuidv5(`human_forest_${vt.vehicleTypeId}_${name}`),
        name,
        amt,
        currency,
        vehicleType: vt.title,
      })
    }
    rows.length = 0
  }

  return results
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- human-forest-adapter
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/checks/adapters/human-forest-adapter.ts \
        src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts
git commit -m "feat: implement fetchPricings for Human Forest adapter"
```

---

## Task 5: Implement fetchZones

**Files:**
- Modify: `src/lib/checks/adapters/human-forest-adapter.ts` — replace `fetchZones` stub
- Modify: `src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts` — add tests

**Interfaces:**
- Consumes: `getHumanForestZoneContext(polygonId)` from `@/lib/scrapers-db` (Task 1)
- Produces: `ScraperEntity[]` where each entity is one GeoJSON feature
  - `id = uuidv5(feature.properties.name)` or `uuidv5("{entryType}_{idx}")` if name absent
  - `zoneId` (same as id), `zoneName`, `type`, `geometryType`, `geometryCoordinates`, `areaType` (part before ` - `), `areaDescription`, `areaPriority`, `areaZoneId`, `areaRules` (JSON string of properties)

**Territories URL:** `https://api.forest.me/v1/territories?location_id={locationId}&types={t0}&types={t1}...`
- `location_id` and `types` are fetched from `collection_tasks.extra_context` via `getHumanForestZoneContext(polygonId)` — supports future multi-city expansion
- Throws if context not found (no collection tasks for this city yet)

- [ ] **Step 1: Write failing tests**

First, update the mock at the top of the test file to also mock `getHumanForestZoneContext`:

```typescript
vi.mock('@/lib/scrapers-db', () => ({
  getHumanForestAccount: vi.fn(),
  getHumanForestZoneContext: vi.fn(),
}))

import { getHumanForestAccount, getHumanForestZoneContext } from '@/lib/scrapers-db'
const mockGetAccount = vi.mocked(getHumanForestAccount)
const mockGetZoneContext = vi.mocked(getHumanForestZoneContext)
```

Then add inside `describe('HumanForestScraperApiAdapter')`:

```typescript
describe('fetchEntities zones', () => {
  const mockAccount = {
    email: 'test@example.com', password: 'pw',
    access_token: 'tok', refresh_token: 'ref',
  }
  const mockZoneContext = { location_id: '1', types: [0, 1, 2, 5, 6] }

  const territoriesResponse = [
    {
      type: 0,
      territory: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[[-0.136679, 51.390344], [-0.141879, 51.389349], [-0.136679, 51.390344]]] },
            properties: { name: 'BUSINESS_AREA - ba_default', type: 0, 'line-color': '#000000', 'fill-opacity': 0 },
          },
        ],
      },
    },
    {
      type: 1,
      territory: {
        type: 'FeatureCollection',
        features: [], // empty → no rows
      },
    },
  ]

  it('returns one entity per GeoJSON feature across all territory entries', async () => {
    mockGetAccount.mockResolvedValue(mockAccount)
    mockGetZoneContext.mockResolvedValue(mockZoneContext)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => territoriesResponse }),
    )

    const adapter = new HumanForestScraperApiAdapter()
    const result = await adapter.fetchEntities(MOCK_POLYGON, 'zones')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      zoneName:        'BUSINESS_AREA - ba_default',
      areaType:        'BUSINESS_AREA',
      areaDescription: 'BUSINESS_AREA - ba_default',
      areaPriority:    0,
      areaZoneId:      '0',
      geometryType:    'Polygon',
    })
    expect(typeof result[0]!['id']).toBe('string')
    expect((result[0]!['id'] as string)).toMatch(/^[0-9a-f-]{36}$/)
    expect(result[0]!['areaRules']).toBe(JSON.stringify({ name: 'BUSINESS_AREA - ba_default', type: 0, 'line-color': '#000000', 'fill-opacity': 0 }))

    // Verify the URL used the location_id and types from DB
    const fetchCalls = vi.mocked(fetch).mock.calls
    expect(fetchCalls[0]![0]).toContain('location_id=1')
    expect(fetchCalls[0]![0]).toContain('types=0')
    expect(fetchCalls[0]![0]).toContain('types=5')
  })

  it('uses fallback id when feature has no name', async () => {
    mockGetAccount.mockResolvedValue(mockAccount)
    mockGetZoneContext.mockResolvedValue(mockZoneContext)
    const noName = [{
      type: 2,
      territory: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [] },
          properties: { type: 2 }, // no name field
        }],
      },
    }]
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => noName }),
    )

    const adapter = new HumanForestScraperApiAdapter()
    const result = await adapter.fetchEntities(MOCK_POLYGON, 'zones')
    expect(result).toHaveLength(1)
    expect((result[0]!['id'] as string)).toMatch(/^[0-9a-f-]{36}$/) // fallback uuid
    expect(result[0]!['zoneName']).toBeNull()
  })

  it('throws when zone context not found in scrapers_db', async () => {
    mockGetAccount.mockResolvedValue(mockAccount)
    mockGetZoneContext.mockResolvedValue(null)

    const adapter = new HumanForestScraperApiAdapter()
    await expect(adapter.fetchEntities(MOCK_POLYGON, 'zones')).rejects.toThrow(
      'No Human Forest zone context found for polygon 42',
    )
  })

  it('throws ApiUnexpectedResponseError when territories response is not an array', async () => {
    mockGetAccount.mockResolvedValue(mockAccount)
    mockGetZoneContext.mockResolvedValue(mockZoneContext)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ status: 200, json: async () => ({ error: 'blocked' }) }),
    )

    const adapter = new HumanForestScraperApiAdapter()
    await expect(adapter.fetchEntities(MOCK_POLYGON, 'zones')).rejects.toBeInstanceOf(
      (await import('@/lib/checks/adapters/scraper-adapter')).ApiUnexpectedResponseError,
    )
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- human-forest-adapter
```

Expected: FAIL — `not implemented`.

- [ ] **Step 3: Implement fetchZones**

First, add `getHumanForestZoneContext` to the import in `human-forest-adapter.ts`:

```typescript
import { getHumanForestAccount, getHumanForestZoneContext } from '@/lib/scrapers-db'
```

Replace the `fetchZones` stub in `human-forest-adapter.ts`:

```typescript
private async fetchZones(polygon: PolygonBounds, account: HumanForestAccount): Promise<ScraperEntity[]> {
  const ctx = await getHumanForestZoneContext(polygon.polygonId)
  if (!ctx) {
    throw new Error(`No Human Forest zone context found for polygon ${polygon.polygonId}`)
  }
  const typesParams = ctx.types.map((t) => `types=${t}`).join('&')
  const url = `${ZONES_URL}?location_id=${ctx.location_id}&${typesParams}`
  const data = await this.get(url, account)

  if (!Array.isArray(data)) {
    throw new ApiUnexpectedResponseError(
      'zones', polygon.polygonId,
      'territories endpoint returned non-array response',
    )
  }

  const results: ScraperEntity[] = []

  for (const entry of data as Array<{ type: number; territory: { features: unknown[] } }>) {
    const features = entry.territory?.features ?? []
    features.forEach((feature, idx) => {
      const f = feature as Record<string, unknown>
      const props = (f['properties'] as Record<string, unknown>) ?? {}
      const geom  = (f['geometry']  as Record<string, unknown>) ?? {}
      const name  = (props['name'] as string) ?? null
      const idSrc = name ?? `${entry.type}_${idx}`

      const nameParts = name ? name.split(' - ', 2) : []

      results.push({
        id:                  uuidv5(idSrc),
        zoneName:            name,
        zoneId:              uuidv5(idSrc),
        type:                f['type'] ?? null,
        geometryType:        geom['type']        ?? null,
        geometryCoordinates: geom['coordinates'] ?? null,
        areaType:            nameParts[0] ?? null,
        areaDescription:     name,
        areaPriority:        props['type'] != null ? (props['type'] as number) : null,
        areaZoneId:          props['type'] != null ? String(props['type']) : null,
        areaRules:           Object.keys(props).length > 0 ? JSON.stringify(props) : null,
      })
    })
  }

  return results
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- human-forest-adapter
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/checks/adapters/human-forest-adapter.ts \
        src/lib/checks/adapters/__tests__/human-forest-adapter.test.ts
git commit -m "feat: implement fetchZones for Human Forest adapter"
```

---

## Task 6: Register adapter + smoke test in UI

**Files:**
- Modify: `src/lib/checks/adapters/scraper-adapter.ts` — register in `adapterRegistry`

- [ ] **Step 1: Register adapter**

Open `src/lib/checks/adapters/scraper-adapter.ts`. Add import:

```typescript
import { HumanForestScraperApiAdapter } from './human-forest-adapter'
```

Add to `adapterRegistry`:

```typescript
export const adapterRegistry: AdapterRegistry = new Map([
  ['ario',         new ArioScraperApiAdapter()],
  ['human_forest', new HumanForestScraperApiAdapter()],
])
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Smoke test in UI**

1. Ensure `scrapers_db` port-forward is running (`npm run scrapers-db:stage` or `:prod`)
2. Start dev server: `npm run dev`
3. Open `http://localhost:3000/config`
4. Click **Sync from scrapers_db** — verify `human_forest` appears in the scraper list
5. Open `http://localhost:3000/sessions/new`
6. Select environment, select **human_forest** scraper, pick a scrapers session ID
7. Select 1–2 polygons, enable **API→DB check**, select entity type **dockless**
8. Submit — open the resulting session URL
9. Verify: entities appear, no `ApiUnexpectedResponseError` warnings on first run
10. Repeat for **pricings** (expect ~4+ pricing rows) and **zones** (expect zone features)

- [ ] **Step 5: Commit**

```bash
git add src/lib/checks/adapters/scraper-adapter.ts
git commit -m "feat: register HumanForestScraperApiAdapter in adapterRegistry"
```

---

## Self-Review Checklist

- [x] **appId** matches `apps.name` in scrapers_db: `'human_forest'`
- [x] `scrapers_db` never written to — tokens updated in-memory only
- [x] 401 handling: refresh first, sign-in fallback if refresh fails
- [x] `docked` returns `[]` — not supported by Human Forest
- [x] `polygonStrategy` returns `'all'` for dockless, `'center_only'` for pricings/zones
- [x] `uuidv5` namespace matches Python scraper's `uuid.NAMESPACE_OID`
- [x] `ApiUnexpectedResponseError` thrown for all structural anomaly cases
- [x] Zones: `location_id` and `types` fetched from `collection_tasks.extra_context` via `getHumanForestZoneContext(polygonId)` — future-proof for multi-city expansion
- [x] No placeholders — all code in every step is complete
- [x] Tests mock both `fetch` and `getHumanForestAccount` — no real network/DB calls
