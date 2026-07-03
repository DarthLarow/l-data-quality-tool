# Ryde Adapter Implementation Plan

**Goal:** Implement `RydeScraperApiAdapter` covering dockless vehicles, pricings, and zones for the Ryde scraper (docked не підтримується — повертати `[]`).

**Architecture:** Single adapter file. Auth: **статичний** `token` з `accounts.access_token`, переданий у тілі кожного POST-запиту (refresh-флоу відсутній — у скрапера немає auth middleware для Ryde). Кожен запит підписується `timestamp` + `timeSign` (AES-128-CBC + MD5, хардкод ключі). Відповідь list-ендпоінта може бути зашифрована тим самим AES-ключем (`key2`/`key` поле). Dockless — двокроковий: список IMEI → деталі по кожному IMEI. UUID v5 через існуючий `@/lib/uuid5` (NAMESPACE_OID).

**Tech Stack:** TypeScript, вбудований `node:crypto` (aes-128-cbc + md5 — без нових npm-пакетів), існуючі `scrapersQuery` / `ScraperApiAdapter` / `uuidv5`, Vitest.

## Global Constraints

- Ryde `appId = 'ryde'` у quality_db (= `apps.name` у scrapers_db) — **підтвердити ім'я в БД**
- scrapers_db — **тільки читання**, жодних INSERT/UPDATE/DELETE
- Не встановлювати нові npm-пакети
- Тести: `npx vitest run src/lib/__tests__/field-compare.test.ts`
- Тайпчек: `npx tsc --noEmit` — нуль помилок після кожного кроку

---

## Key API facts (sourced from `externalSystemDocs/`)

### Транспорт і підпис запитів

- Всі ендпоінти: `POST https://qw-test.ryde.vip/appRyde/*` (так, `qw-test` — це продакшн-хост, він хардкоджений у продакшн-спайдерах)
- Body: `application/x-www-form-urlencoded`; у кожен payload додаються:
  - `token` — `accounts.access_token` (статичний, без refresh)
  - `timestamp` — `Date.now()` (ms)
  - `timeSign` — `md5(base64(AES_128_CBC_encrypt("rydeGood:" + timestamp + ":ryde-app")))`
    - AES key: `a70678d869319dab` (16 ASCII bytes), IV: `0102330405070708`, padding PKCS7
    - Node: `crypto.createCipheriv('aes-128-cbc', key, iv)` (PKCS7 за замовчуванням), `crypto.createHash('md5')`

### Headers (з `ryde_base_spider.py`)

```
Accept: application/json, text/plain, */*
AppVersion: 5.15.2
Content-Type: application/x-www-form-urlencoded
MobileType: Android/Xiaomi/2207117BPG/POCO
User-Agent: okhttp/4.12.0
X-Frame-Options: DENY
```

### Розшифровка відповіді (тільки list-ендпоінт)

`getNearScootersNew` може повернути `{"key2": "<base64>"}` (або `key`) замість плоского JSON.
Розшифровка: `base64 decode → AES-128-CBC decrypt (той самий key/IV) → unpad → JSON.parse`.
Node: `crypto.createDecipheriv('aes-128-cbc', key, iv)`. Якщо у відповіді немає ні `scooters`/`ebikes`, ні `key2`/`key` — `ApiUnexpectedResponseError`.

### City context (з `city_configs.extra_context`, ключі — точно як у pydantic-схемах)

| Ключ | Використання |
|------|--------------|
| `cityId` (int) | dockless list + detail, pricings |
| `iotLa`, `iotLo` (float) | dockless list (центр пошуку) |
| `nearRadius` (default 1) | dockless list — радіус пошуку |
| `gps_lat`, `gps_lng` (float) | zones (`gpsLa`/`gpsLo` у payload) |
| `cityUnit` (string) | pricings — валюта (пріоритет над `rule.feeCur`) |
| `helmeted` (int) | dockless — `helmet_status` |

### Polygon strategy

| Entity type | Strategy | Причина |
|-------------|----------|---------|
| `dockless`  | `'center_only'`* | Запит будується з city context (`iotLa`/`iotLo`), не з полігона |
| `pricings`  | `'center_only'` | Один запит `getFeeRuleByCityId` на місто |
| `zones`     | `'center_only'` | Один запит `getCityFences` на місто |
| `docked`    | n/a | Немає спайдера → `[]` |

\* Відкрите питання №3: чи fан-аутить зовнішня система dockless по тайлах через
`collection_tasks.extra_context` (override `iotLa`/`iotLo`) — тоді стратегія `'all'`
з координатами з `polygon_type`.

---

## Entity details

### Dockless — двокроковий

**Крок 1 — список:** `POST /appRyde/getNearScootersNew`
Payload: `{cityId, iotLa, iotLo, nearRadius}` (+ token/timestamp/timeSign).
Відповідь (можливо зашифрована): `{scooters: [...], ebikes: [...]}`, кожен елемент:
```json
{
  "coordinate": {"latitude": 63.387, "longitude": 10.409},
  "distance": 4.496,
  "memberByString": "861685072705987"
}
```
`memberByString` = IMEI = майбутній `vehicle_id`. Тип: зі `scooters` → `"scooter"`, з `ebikes` → `"ebike"`.

**Крок 2 — деталі по IMEI:** `POST /appRyde/getScooterInfoByCode`
Payload: `{cityId, deviceIMEI, isSacn: "2", phoneLa: iotLa, phoneLo: iotLo, qrCode: ""}`.
Відповідь:
```json
{
  "scooter": {
    "deviceType": "2",
    "code": "319930",
    "lastGps": "10.446317,63.409638;0;2026-03-31 19:12:47",
    "sb": "25",
    "deviceIMEI": "861685072705870"
  },
  "status": 200
}
```
`lastGps`: перший сегмент до `;`, формат **`lng,lat`** (порядок інвертований!).

**DB fields** (`dockless_fleets`):
| DB column | Source |
|-----------|--------|
| `vehicle_id` | `scooter.deviceIMEI ?? scooter.code` (string) |
| `name` | `scooter.code` |
| `battery` | `parseInt(scooter.sb)` |
| `location_lat` | другий компонент першої пари `lastGps` |
| `location_lng` | перший компонент першої пари `lastGps` |
| `zone_id` | `String(cityId)` |
| `zone_name` | назва міста (з `PolygonBounds.city`) |
| `category` | vehicle_type зі списку (`scooter`/`ebike`); fallback: `deviceType === "2"` → `"scooter"` |
| `helmet_status` | `String(helmeted)` з context |

Скрапер пропускає рядки без `vehicle_id`/lat/lng/battery і дедуплікує по `vehicle_id`.

**Fan-out cap:** деталі — окремий HTTP-запит на кожен IMEI. Рішення (залежить від
відкритого питання №4 — скільки транспорту на місто): будувати сутності зі
**списку** (`vehicle_id = memberByString`, lat/lng з `coordinate`, category), а
деталі (`name`, `battery`, точний `lastGps`) дотягувати лише для перших
`MAX_VEHICLE_DETAILS` (пропозиція: 20 — покриває максимальний AI sample size).
Якщо кількість помірна (<100/місто) — повний fan-out з паузою ~150ms між запитами.

### Pricings — `POST /appRyde/getFeeRuleByCityId`

Payload: `{cityId}`. Відповідь:
```json
{
  "rule": {
    "ruleFee": 250, "totalFee": 50000, "feeCur": "",
    "reFee": 500, "transferFee": 0, "openFee": 1000, "cityId": 5
  },
  "status": 200
}
```
Якщо `rule.cityId` не збігається з очікуваним — пропустити (порожній результат).
Якщо `rule` відсутній/не об'єкт — `ApiUnexpectedResponseError`.

З одного `rule` — до 5 рядків (пропускати `null`-значення):
| `name` | Source | 
|--------|--------|
| `unlock_fee` | `rule.openFee` |
| `per_minute_cost` | `rule.ruleFee` |
| `per_minute_pause_fee` | `rule.reFee` |
| `transfer_fee` | `rule.transferFee` |
| `max_trip_fee` | `rule.totalFee` |

**DB fields** (`pricings`):
| DB column | Source |
|-----------|--------|
| `pricing_plan_id` | `uuidv5("{cityId}_{vehicle_type}_{name}")` — **верифіковано проти фікстури**: `uuid5(OID, "5_scooter_unlock_fee") = 1c76571e-20aa-5dde-a2cf-75d77f469e75` ✓ |
| `pricing_plan_name` | `"pricing"` (константа) |
| `name` | з таблиці вище |
| `amt` | `value / 100` |
| `currency` | `cityUnit` з context \|\| `rule.feeCur` \|\| null (порожній рядок = falsy) |
| `vehicle_type` | `"scooter"` (default скрапера) |
| `zone_id` | `String(cityId)` |
| `zone_name` | назва міста |

### Zones — `POST /appRyde/getCityFences`

Payload: `{gpsLa: gps_lat, gpsLo: gps_lng, userCityId: ""}`. Відповідь: `{fences: [...]}`:
```json
{
  "fenId": 33308,
  "fenceName": "IPZ- Bussholdeplass Bratsbergveien-15",
  "fenceType": 0,
  "fenceRemake": "fid:...",
  "cityId": 5,
  "fenceArea": "63.405436,10.397674;63.405437,10.39765;...",
  "outNoRide": 0, "isLimitSpeed": 0, "prohibitLock": 0,
  "openAreaType": 1, "zoneDesign": 0
}
```
Якщо `fences` не масив — `ApiUnexpectedResponseError`.
`fenceArea`: пари `lat,lng` через `;` (порядок протилежний до `lastGps`!). Фенси без валідних координат пропускаються.

**DB fields** (`zones`):
| DB column | Source |
|-----------|--------|
| `zone_id` | `String(fenId)` |
| `zone_name` | `fenceName` |
| `geometry_type` | `"MultiPolygon"` (константа) |
| `area_type` | `String(fenceType)` |
| `area_description` | `fenceRemake` |
| `area_priority` | null |
| `area_rules` | `JSON.stringify({outNoRide, isLimitSpeed, prohibitLock, openAreaType, zoneDesign})` — python-подібний формат зі спейсами: у скрапера `json.dumps` дає `{"outNoRide": 0, ...}` (пробіл після `:`) — **у mapping використати `normalize: parseJsonStr`** (як у Voi), щоб порівнювати як об'єкти |
| `area_zone_id` | `String(cityId)` |
| `vehicle_type` | null |

---

## Відкриті питання (розв'язати через scrapers_db до імплементації)

| # | Питання | Як перевірити |
|---|---------|---------------|
| 1 | `apps.name` для Ryde = `'ryde'`? id? Остання сесія з даними? | `SELECT id, name FROM apps WHERE name ILIKE '%ryde%'`; останні collection_tasks |
| 2 | Фактичні ключі/значення `city_configs.extra_context` (cityId, iotLa/iotLo, nearRadius, gps_lat/gps_lng, cityUnit, helmeted) | `SELECT extra_context FROM city_configs cc JOIN cities c ... WHERE a.name='ryde'` |
| 3 | Чи є per-polygon override `iotLa`/`iotLo` у `collection_tasks.extra_context` (тайли → стратегія `'all'`) чи один центр на місто (`'center_only'`) | Подивитись extra_context кількох collection_tasks однієї сесії/міста |
| 4 | Кількість dockless на місто (розмір fan-out деталей) → рішення про `MAX_VEHICLE_DETAILS` vs повний обхід | `SELECT city_polygon_id, count(*) FROM dockless_fleets WHERE session..., GROUP BY` |
| 5 | `accounts.access_token` для ryde присутній і живий? (refresh-флоу немає — якщо токен протух, адаптер може тільки повідомити помилку) | `SELECT access_token IS NOT NULL FROM accounts ... WHERE a.name='ryde' AND is_active` |
| 6 | Семпли рядків dockless/pricings/zones у БД — підтвердити формат `vehicle_id` (IMEI), `zone_id` (cityId), `area_rules` (формат JSON-рядка) | `SELECT * FROM ... LIMIT 3` для кожного типу |

---

## Implementation steps

- [ ] **Step 1 — scrapers-db helpers**
  Додати в `src/lib/scrapers-db.ts`:
  ```typescript
  export interface RydeAccountRow {
    access_token: string | null
  }
  export async function getRydeAccount(): Promise<RydeAccountRow | null>

  export interface RydeCityContextRow {
    city_id:     number | null
    iot_la:      number | null
    iot_lo:      number | null
    near_radius: number | null
    gps_lat:     number | null
    gps_lng:     number | null
    city_unit:   string | null
    helmeted:    number | null
  }
  export async function getRydeCityContext(polygonId: string): Promise<RydeCityContextRow | null>
  ```
  (точні JSON-ключі extra_context — після відповіді на питання №2). `npx tsc --noEmit`.

- [ ] **Step 2 — adapter**
  Створити `src/lib/checks/adapters/ryde-adapter.ts`:
  - `generateTimeSign(timestampMs)` + `decryptResponsePayload(obj)` через `node:crypto` (aes-128-cbc, key `a70678d869319dab`, IV `0102330405070708`)
  - `post(url, payload)`: form-urlencoded body з `token`/`timestamp`/`timeSign`, базові headers; не-ok відповідь → `ApiUnexpectedResponseError`
  - `fetchDockless`: list → (розшифрувати за потреби) → IMEI + coordinates → деталі (з capом за рішенням питання №4)
  - `fetchPricings`: getFeeRuleByCityId → до 5 рядків з uuid5-ідентифікаторами
  - `fetchZones`: getCityFences → маппінг fences
  - `fetchDocked` (docked) → `[]`
  - `polygonStrategy`: `'center_only'` для всіх (або `'all'` для dockless — питання №3)
  `npx tsc --noEmit`.

- [ ] **Step 3 — field mappings**
  Додати `ryde` блок у `src/lib/field-mappings.ts`:
  - `dockless`: vehicle_id, name, category, zone_id, helmet_status, battery (dynamic, без threshold), location_lat/lng (dynamic, `distance_m` 10000)
  - `pricings`: pricing_plan_id, pricing_plan_name, name, amt, currency, vehicle_type, zone_id — static
  - `zones`: zone_id, zone_name, geometry_type, area_type, area_description, area_zone_id, area_rules (`normalize: parseJsonStr`)
  - `docked`: `[]`
  `npx tsc --noEmit`.

- [ ] **Step 4 — tests**
  Ryde-сюїта в `src/lib/__tests__/field-compare.test.ts` (дані з реальних фікстур скрапера):
  - dockless: Same, vehicle_id mismatch, battery ignored, GPS у межах/поза threshold
  - pricings: Same, amt mismatch, currency mismatch, pricing_plan_id mismatch
  - zones: Same, area_rules як об'єкт (parseJsonStr), zone_name mismatch
  - docked: порожній mapping → "No field mapping"
  `npx vitest run src/lib/__tests__/field-compare.test.ts`.

- [ ] **Step 5 — register**
  У `src/lib/checks/adapters/scraper-adapter.ts`:
  ```typescript
  import { RydeScraperApiAdapter } from './ryde-adapter'
  // ...
  ['ryde', new RydeScraperApiAdapter()],
  ```
  `npx tsc --noEmit`.
