# Plan: Ario Scraper API Adapter

**Мета:** Реалізувати `ArioScraperApiAdapter` — конкретний адаптер для скрапера Ario
у системі перевірки якості даних. Після реалізації API→DB check запрацює для Ario
з реальними даними замість `MockScraperApiAdapter`.

**Джерела досліджень:**
- `externalSystemDocs/ecommerce-scraper-main/lime_scraper/spiders/ario/`
- `externalSystemDocs/ecommerce-scraper-main/lime_scraper/parsers/ario/`
- `externalSystemDocs/ecommerce-scraper-main/lime_scraper/middlewares/ario/`
- `externalSystemDocs/Stage - lime - public.graphml` (схема scrapers_db)

---

## Характеристики Ario API

| Параметр | Значення |
|----------|----------|
| Base URL | `https://app.3km.tech` |
| HTTP клієнт | окhttp/4.12.0 (Android) |
| Метод усіх ендпойнтів | POST |
| Формат тіла | JSON `{latitude, longitude}` |
| Auth headers | `token`, `deviceid`, `locale` |

### Ендпойнти

| EntityType | URL | Key ID field |
|------------|-----|-------------|
| `dockless` | `/app/api/carlist` | `data.car_list[].carId` → `String(carId)` |
| `pricings` | `/app/api/pay/pricelist` | UUID5(`ario_unlock_{city}`) + UUID5(`ario_per_minute_{city}`) |
| `pricings` | `/app/api/getridepassbycity` | UUID5(`ario_ride_pass_{ridePassId}`) |
| `zones` | `/app/api/getoutofoalist` | `{area_id}-{area_type}-{polygonIdx}` |
| `docked` | — | **Не підтримується** (немає spider/parser) |

> UUID5 namespace = NAMESPACE_OID = `6ba7b812-9dad-11d1-80b4-00c04fd430c8` (SHA-1 based)

### Координати полігону

Ario використовує **не** `bound_box`, а `polygon_type` — JSONB об'єкт `{"type": "point", "lat": ..., "lon": ...}` (PostgreSQL повертає вже розпарсеним, не рядком).
Поточний `getPolygonBounds` цього поля **не повертає**.

### Автентифікація (2-кроковий refresh)

**Тригери refresh:** HTTP 401 або `res_code: 1001` ("session expired")

```
Крок 1: POST https://android.googleapis.com/auth
  (accounts.refresh_token = master_token) → Google ID token (JWT, 1h TTL)

Крок 2: POST https://app.3km.tech/app/api/login
  (Google ID token) → Ario app token (довготривалий)
```

**Константи (з APK):**
```
ARIO_CLIENT_ID  = "1079026099096-rmvigj6c56fianlmvfe6oa0nlql62hl9.apps.googleusercontent.com"
ARIO_CLIENT_SIG = "3402f1ae41841f8192237a515d8b87f0f82198e5"
ARIO_APP_PKG    = "sg.ario.scooter"
ARIO_APP_VERSION = "65"
GMS_CALLER_PKG  = "com.google.android.gms"
GMS_CALLER_SIG  = "58e1c4133f7441ec3d2c270270a14802da47ba0e"
```

**Акаунти з scrapers_db:**

```sql
SELECT access_token, refresh_token, email,
       extra_context->>'device_id'   AS device_id,
       extra_context->>'android_id'  AS android_id,
       extra_context->>'name'        AS name,
       extra_context->>'gms_version' AS gms_version
FROM accounts
WHERE app_id = (SELECT id FROM apps WHERE name = 'ario' LIMIT 1)
  AND is_active = true
LIMIT 1
```

> `access_token` може бути `null` (expired) — middleware refreshне його при першому запиті.
> Після refresh новий `access_token` **треба записати назад** до `accounts` (UPDATE),
> інакше наступний запуск щоразу буде виконувати повний refresh.

---

## Зміни у файлах

### Крок 1: Розширити `PolygonBounds`, реалізувати резолвер полігонів

**Файл:** `src/lib/scrapers-db.ts`

#### 1a. Розширити інтерфейс

```typescript
export interface PolygonBounds {
  polygonId:   string
  boundBox:    unknown
  polygonType: string | null  // JSON рядок {"type":"point","lat":..,"lon":..}
  city:        string | null  // назва міста (для UUID5 pricing)
}
```

#### 1b. Оновити `getPolygonBounds` — приєднати cities

```sql
SELECT cp.id, cp.bound_box, cp.polygon_type, c.name AS city
FROM city_polygons cp
LEFT JOIN cities c ON c.id = cp.city_id
WHERE cp.id = $1
```

#### 1c. Нова функція: `resolvePolygons(appId, polygonIds)`

Зараз `api-db-check.ts` викликає `getPolygonBounds(polygonId)` напряму, але
`polygonIds` може містити **сентінели** що кодуються в `CheckForm`:

| Значення в `polygonIds` | Стратегія | Звідки |
|-------------------------|-----------|--------|
| `'__random__'` | random | `CheckForm` → `polygonStrategy === 'random'` |
| реальний ID | by_id | `CheckForm` → `polygonStrategy === 'by_id'` |
| `'__city_by_city_all__:Kyiv'` | by_city_all | `CheckForm` → `` `__city_${polygonStrategy}__:${city}` `` |
| `'__city_by_city_random__:Kyiv'` | by_city_random | аналогічно |

`resolvePolygons` перетворює сентінели на масив реальних `PolygonBounds`:

```typescript
export async function resolvePolygons(
  appId: string,
  polygonIds: string[],
): Promise<PolygonBounds[]> {
  const results: PolygonBounds[] = []

  for (const pid of polygonIds) {
    if (pid === '__random__') {
      // Один випадковий полігон з усіх, що належать застосунку
      const rows = await scrapersQuery<RawPolygonRow>(
        `SELECT cp.id, cp.bound_box, cp.polygon_type, c.name AS city
         FROM city_polygons cp
         JOIN cities c ON c.id = cp.city_id
         WHERE c.app_id = (SELECT id FROM apps WHERE name = $1 LIMIT 1)
         ORDER BY RANDOM() LIMIT 1`,
        [appId],
      )
      results.push(...rows.map(toPolygonBounds))

    } else if (pid.startsWith('__city_by_city_all__:')) {
      const cityName = pid.slice('__city_by_city_all__:'.length)
      // Всі полігони зазначеного міста
      const rows = await scrapersQuery<RawPolygonRow>(
        `SELECT cp.id, cp.bound_box, cp.polygon_type, c.name AS city
         FROM city_polygons cp
         JOIN cities c ON c.id = cp.city_id
         WHERE c.app_id = (SELECT id FROM apps WHERE name = $1 LIMIT 1)
           AND c.name ILIKE $2`,
        [appId, cityName],
      )
      results.push(...rows.map(toPolygonBounds))

    } else if (pid.startsWith('__city_by_city_random__:')) {
      const cityName = pid.slice('__city_by_city_random__:'.length)
      // Один випадковий полігон зазначеного міста
      const rows = await scrapersQuery<RawPolygonRow>(
        `SELECT cp.id, cp.bound_box, cp.polygon_type, c.name AS city
         FROM city_polygons cp
         JOIN cities c ON c.id = cp.city_id
         WHERE c.app_id = (SELECT id FROM apps WHERE name = $1 LIMIT 1)
           AND c.name ILIKE $2
         ORDER BY RANDOM() LIMIT 1`,
        [appId, cityName],
      )
      results.push(...rows.map(toPolygonBounds))

    } else {
      // Прямий ID полігону
      const bounds = await getPolygonBounds(pid)
      if (bounds) results.push(bounds)
    }
  }

  return results
}

// helper — перетворює рядок БД на PolygonBounds
function toPolygonBounds(row: RawPolygonRow): PolygonBounds {
  return {
    polygonId:   row.id,
    boundBox:    row.bound_box,
    polygonType: row.polygon_type ?? null,
    city:        row.city ?? null,
  }
}
```

> **Примітка:** `apps.name` (scrapers_db) має збігатися з `appId` що передається в
> `CheckSessionInput`. Потрібно перевірити точне значення: `SELECT name FROM apps WHERE title ILIKE '%ario%'`.

#### 1d. Оновити `api-db-check.ts` — використати `resolvePolygons`

```typescript
// Було:
for (const polygonId of input.polygonIds) {
  const bounds = await getPolygonBounds(polygonId) ?? { polygonId, boundBox: null }
  ...
}

// Стало:
const polygons = await resolvePolygons(input.appId, input.polygonIds)
for (const bounds of polygons) {
  const entities = await adapter.fetchEntities(bounds, entityType)
  ...
}
```

Також додати:

```typescript
export async function getArioAccount(): Promise<ArioAccountRow | null>
// SELECT з accounts JOIN apps WHERE apps.name = 'ario' AND is_active = true LIMIT 1
```

> `scrapers_db` — read-only. Немає `updateArioToken`. Оновлений токен зберігається тільки
> в пам'яті процесу (`this.account.token`) на час одного запуску.

---

### Крок 2: Реалізувати UUID5 (native, без зовнішніх пакетів)

**Файл:** `src/lib/uuid5.ts` (новий)

Node.js має `crypto.createHash('sha1')` — UUID5 реалізується без залежностей:

```typescript
import { createHash } from 'crypto'

// NAMESPACE_OID = uuid.NAMESPACE_OID (Python)
const NAMESPACE_OID = '6ba7b812-9dad-11d1-80b4-00c04fd430c8'

export function uuidv5(name: string, namespace = NAMESPACE_OID): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const nameBytes = Buffer.from(name, 'utf8')
  const hash = createHash('sha1').update(Buffer.concat([nsBytes, nameBytes])).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  return [
    hash.slice(0, 4).toString('hex'),
    hash.slice(4, 6).toString('hex'),
    hash.slice(6, 8).toString('hex'),
    hash.slice(8, 10).toString('hex'),
    hash.slice(10, 16).toString('hex'),
  ].join('-')
}
```

> ⚠️ Критично: Python `uuid.NAMESPACE_OID` = `6ba7b812-9dad-11d1-80b4-00c04fd430c8`.
> Pricing IDs генеруються цим же алгоритмом у scraper — потрібна **точна** відповідність.

**Тест:** `uuidv5('ario_unlock_Auckland')` має дати той самий UUID що і Python `uuid.uuid5(uuid.NAMESPACE_OID, 'ario_unlock_Auckland')`.

---

### Крок 3: Реалізувати `ArioScraperApiAdapter`

**Файл:** `src/lib/checks/adapters/ario-adapter.ts` (новий)

```typescript
import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'
import { scrapersQuery, getArioAccount, updateArioToken } from '@/lib/scrapers-db'
import { uuidv5 } from '@/lib/uuid5'

// Auth constants (from APK)
const GMS_AUTH_URL    = 'https://android.googleapis.com/auth'
const ARIO_LOGIN_URL  = 'https://app.3km.tech/app/api/login'
const ARIO_CLIENT_ID  = '1079026099096-rmvigj6c56fianlmvfe6oa0nlql62hl9.apps.googleusercontent.com'
const ARIO_CLIENT_SIG = '3402f1ae41841f8192237a515d8b87f0f82198e5'
const ARIO_APP_PKG    = 'sg.ario.scooter'
const ARIO_APP_VERSION = '65'
const GMS_CALLER_PKG  = 'com.google.android.gms'
const GMS_CALLER_SIG  = '58e1c4133f7441ec3d2c270270a14802da47ba0e'

const BASE_HEADERS = {
  'Accept-Encoding': 'gzip',
  'Connection': 'Keep-Alive',
  'Content-Type': 'application/json; charset=UTF-8',
  'Host': 'app.3km.tech',
  'User-Agent': 'okhttp/4.12.0',
  'os': '2',
  'version': ARIO_APP_VERSION,
}

interface ArioAccount {
  id:          string
  token:       string | null
  masterToken: string
  email:       string
  deviceId:    string
  androidId:   string
  name:        string
  gmsVersion:  string
  locale:      string
}

export class ArioScraperApiAdapter implements ScraperApiAdapter {
  appId = 'ario'
  private account: ArioAccount | null = null

  async fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]> {
    if (entityType === 'docked') return []  // Ario не підтримує docked
    
    const account = await this.getAccount()
    if (!account.token) await this.refreshToken(account)
    
    const { lat, lon } = this.parsePolygonPoint(polygon)
    
    switch (entityType) {
      case 'dockless':  return this.fetchDockless(lat, lon, account, polygon)
      case 'pricings':  return this.fetchPricings(lat, lon, account, polygon)
      case 'zones':     return this.fetchZones(lat, lon, account, polygon)
    }
  }
  
  // ... private методи нижче
}
```

#### 3a. parsePolygonPoint

```typescript
private parsePolygonPoint(polygon: PolygonBounds): { lat: number; lon: number } {
  if (!polygon.polygonType) {
    throw new Error(`Polygon ${polygon.polygonId} has no polygonType — cannot call Ario API`)
  }
  const tile = JSON.parse(polygon.polygonType) as { lat: number; lon: number }
  return { lat: tile.lat, lon: tile.lon }
}
```

#### 3b. fetchDockless

```typescript
private async fetchDockless(lat, lon, account, polygon): Promise<ScraperEntity[]> {
  const data = await this.post('/app/api/carlist', { latitude: lat, longitude: lon }, account, polygon)
  const cars = (data?.data?.car_list ?? []) as Array<{ carId: number | string; [k: string]: unknown }>
  return cars
    .filter(car => car.carId != null)
    .map(car => ({ id: String(car.carId), ...car }))
}
```

#### 3c. fetchPricings

```typescript
private async fetchPricings(lat, lon, account, polygon): Promise<ScraperEntity[]> {
  const city = polygon.city ?? 'unknown'
  const results: ScraperEntity[] = []

  // base pricing
  const priceData = await this.post('/app/api/pay/pricelist', { latitude: lat, longitude: lon }, account, polygon)
  const inner = priceData?.data ?? priceData
  if (typeof inner === 'object' && inner !== null) {
    if (inner.unlockFeeAmount != null)
      results.push({ id: uuidv5(`ario_unlock_${city}`), ...inner })
    if (inner.timeFeeAmount != null)
      results.push({ id: uuidv5(`ario_per_minute_${city}`), ...inner })
  }

  // ride passes
  const passData = await this.post('/app/api/getridepassbycity', { latitude: lat, longitude: lon }, account, polygon)
  const passes = Array.isArray(passData?.data) ? passData.data : []
  for (const pass of passes) {
    if (pass.ridePassId != null)
      results.push({ id: uuidv5(`ario_ride_pass_${pass.ridePassId}`), ...pass })
  }

  return results
}
```

#### 3d. fetchZones

```typescript
private async fetchZones(lat, lon, account, polygon): Promise<ScraperEntity[]> {
  const data = await this.post('/app/api/getoutofoalist', { latitude: lat, longitude: lon }, account, polygon)
  const inner = data?.data ?? data
  const oaList = inner?.oa_list ?? []
  const results: ScraperEntity[] = []

  for (const oa of oaList) {
    const areaId = String(oa.area_id ?? '')
    for (const [key, raw] of Object.entries(oa)) {
      if (!key.endsWith('_coordinate_list')) continue
      const areaType = key.replace(/_coordinate_list$/, '')
      const polygons = this.extractPolygons(raw)
      polygons.forEach((poly, idx) => {
        results.push({ id: `${areaId}-${areaType}-${idx}`, geometry: poly, ...oa })
      })
    }
  }
  return results
}
```

#### 3e. HTTP helper з retry на 401 / res_code=1001

```typescript
private async post(
  path: string,
  body: object,
  account: ArioAccount,
  polygon: PolygonBounds,
  retry = true,
): Promise<Record<string, unknown>> {
  const url = `https://app.3km.tech${path}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      token:    account.token ?? '',
      deviceid: account.deviceId,
      locale:   account.locale,
    },
    body: JSON.stringify(body),
  })

  if (response.status === 401 && retry) {
    await this.refreshToken(account)
    return this.post(path, body, account, polygon, false)
  }

  const json = await response.json() as Record<string, unknown>

  if (json.res_code === 1001 && retry) {
    await this.refreshToken(account)
    return this.post(path, body, account, polygon, false)
  }

  return json
}
```

#### 3f. Auth: getAccount + refreshToken

```typescript
private async getAccount(): Promise<ArioAccount> {
  if (this.account) return this.account
  const row = await getArioAccount()
  if (!row) throw new Error('No active Ario account in scrapers_db')
  this.account = {
    id:          row.id,
    token:       row.access_token,
    masterToken: row.refresh_token,
    email:       row.email,
    deviceId:    row.device_id,
    androidId:   row.android_id,
    name:        row.name ?? '',
    gmsVersion:  row.gms_version ?? '231818044',
    locale:      row.locale ?? 'en_US',
  }
  return this.account
}

private async refreshToken(account: ArioAccount): Promise<void> {
  // Крок 1: Google master_token → ID token
  const gmsBody = new URLSearchParams({
    androidId: account.androidId,
    lang: 'en-US',
    google_play_services_version: account.gmsVersion,
    sdk_version: '36',
    device_country: 'us',
    is_dev_key_gmscore: '1',
    app: ARIO_APP_PKG,
    Email: account.email,
    pkgVersionCode: account.gmsVersion,
    client_sig: ARIO_CLIENT_SIG,
    Token: account.masterToken,
    consumerVersionCode: ARIO_APP_VERSION,
    check_email: '1',
    callerPkg: GMS_CALLER_PKG,
    callerSig: GMS_CALLER_SIG,
    token_request_options: 'CAA4AVAGYAA=',
    has_permission: '1',
    oauth2_include_profile: '1',
    oauth2_include_email: '1',
    service: `audience:server:client_id:${ARIO_CLIENT_ID}`,
    include_granted_scopes: '0',
  })
  const gmsRes = await fetch(GMS_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'app': ARIO_APP_PKG,
      'User-Agent': `com.google.android.gms/${account.gmsVersion} (Linux; U; Android 16; en_US; sdk_gphone64_x86_64; Build/BE2A.250530.026.F3; Cronet/139.0.7205.3)`,
      'device': account.androidId,
    },
    body: gmsBody.toString(),
  })
  const gmsText = await gmsRes.text()
  const parsed = Object.fromEntries(
    gmsText.trim().split('\n').filter(l => l.includes('=')).map(l => l.split('=', 2) as [string, string])
  )
  const idToken = parsed['Auth']
  if (!idToken) throw new Error(`Ario GMS auth failed: ${gmsText}`)

  // Крок 2: ID token → Ario app token
  const loginRes = await fetch(ARIO_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'os': '2',
      'version': ARIO_APP_VERSION,
      'token': '',
      'User-Agent': 'okhttp/4.12.0',
      'deviceid': account.deviceId,
      'locale': account.locale,
    },
    body: JSON.stringify({
      email: account.email,
      identity_token: idToken,
      latitude: 0.0,
      longitude: 0.0,
      name: account.name,
      pic_url: '',
      type: 2,
    }),
  })
  const loginData = await loginRes.json() as Record<string, unknown>
  if (loginData.res_code !== 0) throw new Error(`Ario login failed: ${JSON.stringify(loginData)}`)
  const newToken = (loginData.data as Record<string, unknown>)?.token as string
  if (!newToken) throw new Error(`Ario login returned no token`)

  account.token = newToken
  // Token stored in-memory only — scrapers_db is read-only
}
```

#### 3g. extractPolygons (port з Python)

```typescript
private extractPolygons(raw: unknown): number[][][] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const first = raw[0]
  if (typeof first === 'object' && first !== null && 'latitude' in first) {
    return [(raw as Array<{ latitude: number; longitude: number }>).map(p => [p.latitude, p.longitude])]
  }
  if (Array.isArray(first)) {
    return (raw as unknown[][])
      .filter(poly => Array.isArray(poly) && poly.length > 0 && typeof (poly[0] as Record<string,unknown>).latitude === 'number')
      .map(poly => (poly as Array<{ latitude: number; longitude: number }>).map(p => [p.latitude, p.longitude]))
  }
  if (typeof first === 'object' && first !== null && Array.isArray((first as Record<string,unknown>).coordinate_list)) {
    return (raw as Array<{ coordinate_list: Array<{ latitude: number; longitude: number }> }>)
      .map(sub => (sub.coordinate_list ?? []).map(p => [p.latitude, p.longitude]))
      .filter(poly => poly.length > 0)
  }
  return []
}
```

---

### Крок 4: Зареєструвати адаптер

**Файл:** `src/lib/checks/adapters/scraper-adapter.ts`

```typescript
import { ArioScraperApiAdapter } from './ario-adapter'

export const adapterRegistry: AdapterRegistry = new Map([
  ['ario', new ArioScraperApiAdapter()],
])
```

> `'ario'` має відповідати значенню `apps.name` в scrapers_db.
> Треба перевірити точний рядок: `SELECT name FROM apps WHERE title ILIKE '%ario%'`

---

### Крок 5: Написати unit-тести

**Файл:** `src/lib/checks/adapters/__tests__/ario-adapter.test.ts`

1. **UUID5 test** — порівняти з очікуваним значенням (обчислити заздалегідь у Python)
2. **parsePolygonPoint** — коректний розбір JSON, помилка якщо null
3. **extractPolygons** — всі 3 формати (flat, nested array, coordinate_list objects)
4. **fetchDockless mock** — mock fetch → перевірити що `carId` → `id`
5. **fetchPricings mock** — перевірити обидва запити, UUID відповідність
6. **fetchZones mock** — перевірити zone_id формат
7. **auth retry** — на 401 виклик refreshToken, повторний запит

---

---

## Крок 1 (деталі): Синхронізація активних міст

**Проблема:** Для стратегій `by_city_all` / `by_city_random` користувач зараз вводить
назву міста вручну. Після sync треба показувати dropdown з реальними містами скрапера.

### 1.1 — Prisma схема: додати `cities` до `Scraper`

**Файл:** `prisma/schema.prisma`

```prisma
model Scraper {
  // ... існуючі поля ...
  cities  String[]   // нове: активні міста з scrapers_db.cities
}
```

Після зміни — нова міграція: `npx prisma migrate dev --name add-scraper-cities`

### 1.2 — scrapers-db.ts: функція `getCitiesForApps`

```typescript
export interface CityRow {
  name:    string
  code:    string
  country: string
}

export async function getCitiesForApps(
  appIds: string[],
): Promise<Map<string, CityRow[]>> {
  if (appIds.length === 0) return new Map()

  const rows = await scrapersQuery<{ app_id: string; name: string; code: string; country: string }>(
    `SELECT app_id, name, code, country
     FROM cities
     WHERE app_id = ANY($1::text[])
       AND is_active = true
     ORDER BY name`,
    [appIds],
  )

  const map = new Map<string, CityRow[]>()
  for (const row of rows) {
    const list = map.get(row.app_id) ?? []
    list.push({ name: row.name, code: row.code, country: row.country })
    map.set(row.app_id, list)
  }
  return map
}
```

> Один запит на всі scraper-и — масив `app_id` передається як `ANY($1::text[])`.

### 1.3 — sync route: зберегти міста при sync

**Файл:** `src/app/api/scrapers/sync/route.ts`

```typescript
import { getScrapersApps, getCitiesForApps } from '@/lib/scrapers-db'

export async function POST() {
  const apps = await getScrapersApps()
  const appIds = apps.map((a) => a.app_id)
  const citiesMap = await getCitiesForApps(appIds)   // новий виклик

  await Promise.all(
    apps.map((app) => {
      const cities = (citiesMap.get(app.app_id) ?? []).map((c) => c.name)
      return prisma.scraper.upsert({
        where:  { appId: app.app_id },
        update: { name: app.title ?? app.name, cities, lastSyncedAt: new Date() },
        create: {
          appId: app.app_id,
          name: app.title ?? app.name,
          supportedEntityTypes: ALL_ENTITY_TYPES,
          cities,
          lastSyncedAt: new Date(),
        },
      })
    }),
  )

  return NextResponse.json({ synced: apps.length })
}
```

### 1.4 — CheckForm: dropdown замість текстового поля для міста

**Файл:** `src/components/sessions/CheckForm.tsx`

Зараз `ScraperOption` містить лише `appId`, `name`, `supportedEntityTypes`.
Додати `cities: string[]` до інтерфейсу:

```typescript
interface ScraperOption {
  appId:                string
  name:                 string
  supportedEntityTypes: string[]
  cities:               string[]   // нове
}
```

Замінити `<Input placeholder="City name">` на `<Select>`:

```tsx
{(polygonStrategy === 'by_city_all' || polygonStrategy === 'by_city_random') && (
  <Select value={polygonCity} onValueChange={setPolygonCity}>
    <SelectTrigger>
      <SelectValue placeholder="Select city" />
    </SelectTrigger>
    <SelectContent>
      {selectedScraper?.cities.map((city) => (
        <SelectItem key={city} value={city}>{city}</SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

> `selectedScraper` — computed з `scrapers.find(s => s.appId === appId)`.
> Якщо `cities` порожній (sync ще не виконаний) — показати Input як fallback.

### 1.5 — AutoCheckConfig: зберегти вибране місто

**Проблема:** `AutoCheckConfig` наразі не зберігає `polygonCity`. Коли auto-check
запускається автоматично, системі нема звідки взяти місто для city-стратегій.

**Зміни:**

`prisma/schema.prisma`:
```prisma
model AutoCheckConfig {
  // ... існуючі поля ...
  polygonCity  String?   // нове: місто для by_city_* стратегій
}
```

`AutoCheckConfigForm.tsx` — додати Select міста (аналогічно CheckForm) коли
`polygonStrategy` = `by_city_all` або `by_city_random`.

`/api/config/auto-check` route — включити `polygonCity` в upsert.

---

## Відкриті питання — ЗАКРИТО

| Питання | Відповідь |
|---------|-----------|
| ~~Точне значення `apps.name` для Ario~~ | `'ario'` (id=7 в stage scrapers_db) — підтверджено |
| ~~`accounts.extra_context` — чи є `locale`?~~ | Ключа `locale` **немає**. Є: `name`, `device_id`, `android_id`, `gms_version`. Adapter використовує fallback `'en_US'` |
| ~~Чи можемо писати в `scrapers_db`?~~ | Read-only — правило підтверджено, запис заборонено |
| ~~`city` у `polygon_type` відповідає `cities.name`?~~ | Так. `polygon_type` = JSONB-об'єкт `{lat, lon, type: "point"}` (не рядок!). `cities.name` = `"Cairns"` тощо — збігається |

> **Важливо:** `polygon_type` в scrapers_db — тип **JSONB**, PostgreSQL повертає його вже як об'єкт (не рядок). `JSON.parse()` не використовувати — типи виправлено на `Record<string, unknown> | null`.

---

## Порядок виконання

- [x] 1. Синхронізація міст: Prisma схема + scrapers-db + sync route + CheckForm (докладно нижче)
- [x] 2. Розширити `PolygonBounds` + `getPolygonBounds` + `resolvePolygons` + `getArioAccount` в `scrapers-db.ts`
- [x] 3. Оновити `api-db-check.ts`: замінити `getPolygonBounds` на `resolvePolygons`
- [x] 4. Створити `src/lib/uuid5.ts` з `uuidv5` і перевірити відповідність Python
- [x] 5. Створити `src/lib/checks/adapters/ario-adapter.ts` з повною реалізацією
- [x] 6. Зареєструвати в `adapterRegistry` (підтвердити `apps.name` значення)
- [x] 7. Написати тести (мінімум: resolvePolygons сентінели + UUID5 correctness + extractPolygons shapes)
- [x] 8. Запустити `npm run build` + `npm test`
- [x] 9. Ручне тестування: запустити новий Check Session для Ario при активному port-forward

---

## Примітки

- `docked` тип завжди повертає `[]` — Ario не має дочних станцій
- Ario `polygon_type` = точка, не bounding box — один API-запит на полігон (не обхід тайлів)
- Токен може бути `null` у БД (перший запуск або відкликаний) — це нормально, адаптер refreshне його в пам'яті (в БД не пишемо)
- AI comparison у оркестраторі зараз зберігає лише `{ id: entityId }` як apiSnapshot — для Ario можна покращити, передаючи повні дані з відповіді API (це окреме завдання, не блокує MVP)
