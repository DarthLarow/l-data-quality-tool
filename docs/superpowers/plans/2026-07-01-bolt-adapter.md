# Bolt Scraper Adapter — Implementation Plan

Джерела: `externalSystemDocs/ecommerce-scraper-main/docs/bolt/` + Python-спайдери.
**Пріоритет коду над документацією** — там де є розбіжності, вказано "за кодом".

---

## 1. appId

Підтвердити через: `SELECT name FROM apps WHERE id = 3`

Очікуваний результат: `'bolt'` (відповідає іменуванню Python-файлів і `Website.BOLT` у базовому спайдері).

---

## 2. API скрапера

**Base URL:** `https://mfb-gw.bolt.eu`

**Автентифікація — два токени:**

| Токен | Колонка в `accounts` | TTL | Призначення |
|-------|----------------------|-----|-------------|
| `access_token` | `accounts.access_token` | ~55 хв | Bearer для всіх запитів |
| `auth_bearer_token` | `accounts.refresh_token` | ~365 днів | Refresh token (оновлює access_token) |

Refresh flow (тільки in-memory, не писати в `scrapers_db`!):
- При 401 → POST refresh endpoint з `auth_bearer_token`
- Якщо refresh теж 401 → помилка (облікові дані в БД застаріли, ручне оновлення)
- Новий `access_token` зберігається тільки в пам'яті адаптера

**Headers для кожного запиту:**
```
Content-Type: application/json
Authorization: Bearer <access_token>
User-Agent: <Android UA — взяти з Python bolt_base_spider.py>
```

**Параметри запиту (query params):**

Bolt's API вимагає набір device/session параметрів при кожному запиті (патерн `build_query_params()` з базового спайдера):

| Параметр | Джерело |
|----------|---------|
| `deviceId` | `accounts.extra_context->>'device_id'` |
| `userId` | `accounts.extra_context->>'user_id'` |
| `version` | hardcoded (взяти з bolt_base_spider.py) |
| `deviceType` | hardcoded `2` |
| `deviceName` | hardcoded `"SM-A546E"` |
| `deviceOsVersion` | hardcoded (взяти з bolt_base_spider.py) |
| `session_id` | `accounts.extra_context->>'session_id'` |
| `distinct_id` | `accounts.extra_context->>'distinct_id'` |
| `rh_session_id` | `accounts.extra_context->>'rh_session_id'` |
| `language` | `"en"` |

Cookie: `accounts.extra_context->>'cookie'` → заголовок `Cookie`.

---

## 3. Ендпоінти

| Тип сутностей | Метод | URL | Тіло / параметри |
|---------------|-------|-----|-----------------|
| `dockless` | POST | `/micromobility/search/getVehicles/v2` | `{ viewport: { ... }, country }` |
| `docked` | — | — | Не підтримується, повертати `[]` |
| `pricings` | POST × 3 | subscription/list → getVehicles/v2 → getCard | Дивись крок 3 нижче |
| `zones` | GET | `/micromobility/cityArea/listByTile` | `country`, `tile_id`, `gps_lat`, `gps_lng` |

### Dockless: тіло запиту

```json
{
  "viewport": {
    "left_bottom":  { "lat": <south>, "lng": <west> },
    "right_top":    { "lat": <north>, "lng": <east> }
  },
  "country": "<country_code>"
}
```

`country` береться з `cities.country` для полігону.

API ігнорує viewport і може повернути транспорт із сусідніх міст — це нормально для нашої перевірки.
`findEntitiesByIds` шукає глобально по `vehicle_id`, тому cross-city vehicles знайдуться в DB якщо їхнє місто збирається.

### Pricing: 3-кроковий ланцюжок

1. **subscription/list** `POST /micromobility/subscription/list`
   - Тіло: `{ country, gps_lat, gps_lng }`
   - Повертає: список підписок (ride_pass записи)

2. **getVehicles** `POST /micromobility/search/getVehicles/v2`
   - Те саме тіло, що й dockless — потрібен `vehicle_id` для кожного типу транспорту

3. **getCard** `POST /micromobility/vehicle/getCard`
   - Тіло: `{ vehicle_id: <id_з_кроку_2>, ... }`
   - Викликається окремо для кожного uniq vehicle type
   - Повертає: PAYG-тарифи для цього типу

### Zones: tile-based, не bbox

API зон не приймає viewport/bbox — тільки `tile_id`:
```
GET /micromobility/cityArea/listByTile?country=<>&tile_id=<>&gps_lat=<>&gps_lng=<>
```
`tile_id` береться з `city_configs.extra_context->>'tile_id'` (не з `city_polygons`!).

---

## 4. Стратегія обходу полігонів

| Тип | Стратегія | Причина |
|-----|-----------|---------|
| `dockless` | `'all'` | Транспорт просторово прив'язаний до bbox |
| `docked` | — | Не підтримується |
| `pricings` | `'center_only'` | Підписки глобальні по місту; один запит |
| `zones` | `'center_only'` | Tile-based; один tile = ціле місто |

---

## 5. Структура відповіді та ID

### Dockless

Поля зі `getVehicles/v2` (за кодом `bolt_fleet_dockless_parser.py`):

| API | DB | Трансформація |
|-----|----|---------------|
| `v.id` | `vehicle_id` | `str(v.id)` |
| `v.charge` | `battery` | без змін |
| `v.location.lat` | `location_lat` | без змін |
| `v.location.lng` | `location_lng` | без змін |
| `v.vehicle_type` | `category` | `rsplit("_", 1)[0]` → base type (e.g. `"scooter_43"` → `"scooter"`) |
| `category.id` | `zone_id` | ⚠️ Це ID категорії Bolt, а не zone (за кодом — `category_id`) |

**Розбіжність з документацією:** docs кажуть `category = "scooter_43"` (raw), `name = "scooter"`.
**За кодом:** `category = "scooter"` (trimmed), `zone_id = category_id`. Пріоритет коду.

### Zones

З `bolt_zone_parser.py` та `bolt_zone_spider.py`:

| API | DB | Примітки |
|-----|----|----------|
| `zone.id` або `zone.group_id` | `zone_id` | Парсити group_id → якщо відсутній, генерувати UUID |
| `zone.vehicle_types[]` | `vehicle_type` | Comma-joined: `"scooter,ebike"` |
| `zone.locations` (encoded polyline) | `geometry_coordinates` | Потрібен `decodePolyline()` в JS |

⚠️ **Координати:** `decodePolyline()` повертає `[[lat, lng], ...]` (LAT першою!). GeoJSON і DB очікують `[[lng, lat], ...]`. Потрібно swap: `[lng, lat]` при формуванні entity або при нормалізації.

Перед реалізацією **перевірити порядок координат в DB** (`SELECT geometry_coordinates FROM zones WHERE provider = 'bolt' LIMIT 1`) — це визначить, де саме робити swap.

Глибина масиву координат: `[[lat, lng], ...]` → depth 2. Після swap та `normalizeGeoCoords`: wraps в один ring → `[[[lng, lat], ...]]` → depth 3. Це відповідає HF-формату; normalize в field mappings обробить обидва варіанти.

### Pricings

**Підтип 1: Subscription (ride_pass)**

Парсяться з `/micromobility/subscription/list` через HTML:

| Поле | DB | Примітки |
|------|----|----------|
| `sub.id` | `pricing_plan_id` | |
| `"ride_pass"` (constant) | `name` | Завжди! За кодом — не обчислюється |
| `sub.name` | `pricing_plan_name` | |
| Parsed amt з HTML | `amt` | HTML-парсинг price string |
| Country map | `currency` | Bolt не передає ISO-код; map `country → currency` |
| From subtitle keywords | `vehicle_type` | "scooter", "ebike" тощо |
| `= pricing_plan_id` | `discount_id` | За кодом завжди = sub_id (docs кажуть conditional, код — ні) |
| Discounted amt з HTML | `discounted_amount` | Якщо є |
| HTML description | `descriptions` | |

**Підтип 2: Vehicle card (PAYG)**

Парсяться з `/micromobility/vehicle/getCard` (HTML-based):

| Поле | DB | Примітки |
|------|----|----------|
| `f"{vehicle_type}_{slug(label)}"` | `pricing_plan_id` | Slug: label.lower().replace(" ", "_") |
| Token label (e.g. `"scooter_unlock"`) | `name` | |
| Label display text | `pricing_plan_name` | |
| Rate value | `amt` | |
| Country map | `currency` | |
| Vehicle type | `vehicle_type` | |
| Label display text | `descriptions` | |

**`onlyWhen` предикати:**
```ts
const isBoltSubscription = (api: Obj) => api.name === 'ride_pass'
const isBoltVehicleCard  = (api: Obj) => api.name !== 'ride_pass'
```

**Розбіжності з документацією:**
- `name` для subscriptions: завжди `"ride_pass"` (за кодом), не обчислюється динамічно
- `discount_id`: завжди = `pricing_plan_id` (за кодом), не умовний (як в docs)
- `currency`: визначається через map `country → ISO code` (за кодом), не з API-поля

---

## 6. scrapers_db — схема та helper-функції

Додати в `src/lib/scrapers-db.ts`:

### `BoltAccountRow` + `getBoltAccount()`

```sql
SELECT a.access_token,
       a.refresh_token,
       a.extra_context->>'device_id'    AS device_id,
       a.extra_context->>'user_id'      AS user_id,
       a.extra_context->>'session_id'   AS session_id,
       a.extra_context->>'distinct_id'  AS distinct_id,
       a.extra_context->>'rh_session_id' AS rh_session_id,
       a.extra_context->>'cookie'       AS cookie
FROM accounts a
JOIN apps ap ON ap.id = a.app_id
WHERE ap.name = 'bolt'
  AND a.is_active = true
LIMIT 1
```

### `BoltCityContextRow` + `getBoltCityContext(polygonId)`

Потрібен для zones та pricings (country) і для zones (tile_id):

```sql
SELECT c.country,
       cc.extra_context->>'tile_id' AS tile_id
FROM city_polygons cp
JOIN cities c   ON c.id  = cp.city_id
JOIN city_configs cc ON cc.city_id = c.id
JOIN apps a     ON a.id  = c.app_id
WHERE a.name = 'bolt'
  AND cp.id::text = $1
LIMIT 1
```

Якщо `city_configs` не існує для полігону → кидати помилку з підказкою.
Якщо потрібен лише country (для dockless): використовувати `cities.country` через `getPolygonBounds()` (вже є в `scrapers-db.ts`, але `country` не включено — розширити `PolygonBounds` або зробити окремий helper).

**Таблиці сутностей в scrapers_db:**

| EntityType | Таблиця | ID-колонка |
|------------|---------|-----------|
| `dockless` | `dockless_fleets` | `vehicle_id` |
| `zones` | `zones` | `zone_id` |
| `pricings` | `pricings` | `pricing_plan_id` |

Типи даних: `vehicle_id`, `zone_id`, `pricing_plan_id` — текстові. `amt` — числовий (decimal). `geometry_coordinates` — JSONB.

---

## 7. Затримка між запитами

`interPolygonDelayMs = 1000` — аналогічно HF; Bolt API схильний до rate limiting при частих запитах. Зовнішній jitter застосовується автоматично в логіці обходу полігонів.

---

## 8. Реалізація адаптера

Файл: `src/lib/checks/adapters/bolt-adapter.ts`

Структура:

```
BoltScraperApiAdapter implements ScraperApiAdapter
├── appId = 'bolt'
├── interPolygonDelayMs = 1000
├── private account: BoltAccount | null  (lazy load)
│
├── polygonStrategy(entityType)
│   ├── 'dockless' → 'all'
│   ├── 'pricings' → 'center_only'
│   └── 'zones'   → 'center_only'
│
├── fetchEntities(polygon, entityType)
│   ├── 'docked'   → []
│   ├── 'dockless' → fetchDockless(polygon)
│   ├── 'pricings' → fetchPricings(polygon)
│   └── 'zones'    → fetchZones(polygon)
│
├── private getAccount()     — lazy load + lazy refresh (in-memory only)
├── private refreshToken()   — POST refresh endpoint; 401 → throw
├── private buildQueryParams() — device/session params (з extra_context + hardcoded)
├── private post(url, body)  — POST з auto-refresh при 401
├── private get(url)         — GET з auto-refresh при 401
│
├── fetchDockless(polygon)
│   ├── getBoltCityContext(polygon.polygonId) → country
│   ├── POST getVehicles/v2 з viewport + country
│   └── ApiUnexpectedResponseError якщо відповідь null або не масив
│
├── fetchPricings(polygon)
│   ├── getBoltCityContext → country
│   ├── POST subscription/list → parse HTML → ride_pass entities
│   ├── POST getVehicles/v2  → get 1 vehicle per vehicle type
│   ├── POST getCard per vehicle type → parse HTML → PAYG entities
│   └── Повернути об'єднаний масив
│
└── fetchZones(polygon)
    ├── getBoltCityContext → country + tile_id
    ├── GET listByTile
    ├── ApiUnexpectedResponseError якщо null
    └── Decode polyline + swap [lat,lng] → [lng,lat] (якщо потрібно)
```

**Реєстрація:** додати в `adapterRegistry` в `scraper-adapter.ts`.

---

## 9. Field mappings

Додати `bolt` до `FIELD_MAPPINGS` в `src/lib/field-mappings.ts`.

### dockless

```ts
{ apiKey: 'vehicle_id', dbKey: 'vehicle_id' },
{ apiKey: 'battery',    dbKey: 'battery',    dynamic: true }, // no threshold — ignored
{ apiKey: 'lat',  dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 5000 }, latPair: 'location_lng' },
{ apiKey: 'lng',  dbKey: 'location_lng', dynamic: true },
{ apiKey: 'category', dbKey: 'category' },   // вже трансформовано в adapter
{ apiKey: 'zone_id',  dbKey: 'zone_id'  },   // Bolt's category_id — static field
```

### zones

```ts
{ apiKey: 'zone_id',   dbKey: 'zone_id' },
{ apiKey: 'vehicle_type', dbKey: 'vehicle_type' },   // comma-joined; static
{ apiKey: 'geometry_coordinates', dbKey: 'geometry_coordinates',
  normalize: normalizeGeoCoords },  // вирівнює глибину depth-2 / depth-3
```

Якщо порядок координат в DB відрізняється від API — додати `normalize` що swap-ає `[lat,lng]` ↔ `[lng,lat]` на потрібній стороні. Перевірити порядок в DB перед фіналізацією.

### pricings (subscription / ride_pass)

```ts
{ apiKey: 'id', dbKey: 'pricing_plan_id', onlyWhen: isBoltSubscription },
{ constant: 'ride_pass', dbKey: 'name', onlyWhen: isBoltSubscription },
{ apiKey: 'pricingPlanName', dbKey: 'pricing_plan_name', onlyWhen: isBoltSubscription },
{ apiKey: 'amt',      dbKey: 'amt',      onlyWhen: isBoltSubscription },
{ apiKey: 'currency', dbKey: 'currency', onlyWhen: isBoltSubscription },
{ apiKey: 'vehicleType', dbKey: 'vehicle_type', onlyWhen: isBoltSubscription },
{ apiKey: 'discountId',  dbKey: 'discount_id', onlyWhen: isBoltSubscription },
{ apiKey: 'discountedAmount', dbKey: 'discounted_amount', onlyWhen: isBoltSubscription },
{ apiKey: 'descriptions', dbKey: 'descriptions', onlyWhen: isBoltSubscription },
```

### pricings (vehicle card / PAYG)

```ts
{ apiKey: 'id', dbKey: 'pricing_plan_id', onlyWhen: isBoltVehicleCard },
{ apiKey: 'name', dbKey: 'name', onlyWhen: isBoltVehicleCard },
{ apiKey: 'pricingPlanName', dbKey: 'pricing_plan_name', onlyWhen: isBoltVehicleCard },
{ apiKey: 'amt',          dbKey: 'amt',          onlyWhen: isBoltVehicleCard },
{ apiKey: 'currency',     dbKey: 'currency',     onlyWhen: isBoltVehicleCard },
{ apiKey: 'vehicleType',  dbKey: 'vehicle_type', onlyWhen: isBoltVehicleCard },
{ apiKey: 'descriptions', dbKey: 'descriptions', onlyWhen: isBoltVehicleCard },
```

Якщо HTML-парсинг у адаптері видає `amt` у дробових одиницях (наприклад, пенси замість фунтів) — додати `transform: v => v / 100`. Перевірити при першому запуску.

---

## 10. Unit-тести

Додати `describe('bolt / ...')` блоки в `src/lib/__tests__/field-compare.test.ts`.

Мінімальний набір:

**dockless:**
- Same — всі поля збігаються (включно з category після trim)
- Different — vehicle_id мismatch
- Same — battery ігнорується (dynamic, no threshold)
- GPS within threshold / GPS exceeds threshold

**zones:**
- Same — zone_id + vehicle_type + geometry_coordinates збігаються
- Different — vehicle_type mismatch ("scooter" vs "scooter,ebike")
- Same — geometry normalize обробляє depth-2 vs depth-3 як рівні (якщо вміст однаковий)

**pricings:**
- Same — subscription (isBoltSubscription = true, всі поля)
- Same — vehicle card (isBoltVehicleCard = true)
- Different — amt mismatch у vehicle card
- onlyWhen ізоляція: subscription-поле не перевіряється для vehicle card entity і навпаки

---

## 11. UI-перевірка

1. `npm run scrapers-db:stage` або `scrapers-db:prod`
2. `/config` → Sync from scrapers_db → `bolt` має з'явитися
3. `/sessions/new` → обрати bolt → 2–3 полігони → запустити API→DB check по одному entity type
4. Перевірити:
   - **Dockless:** чи `category` = "scooter" (а не "scooter_43")? Чи `zone_id` = числовий рядок (не UUID)?
   - **Zones:** чи `geometry_coordinates` порівнюються коректно? Чи `arrPointCount` показує правильну кількість точок?
   - **Pricings:** чи `name = "ride_pass"` для subscription та відображається як `constant`? Чи PAYG-записи мають коректний `pricing_plan_id` формату `{type}_{slug}`?
   - **Cross-city vehicles:** очікується що деякі dockless-ентитей будуть поза межами полігону — це норма.

---

## Відомі ризики та нюанси

| Ризик | Деталь |
|-------|--------|
| HTML-парсинг pricings | Bolt повертає ціни як HTML-рядки; потрібна JS-реалізація парсера (аналог Python). Ціна може містити локалізовані символи |
| Coordinate order | `decode_polyline` → `[lat, lng]`; DB може зберігати `[lng, lat]`. Перевірити перед реалізацією |
| country → currency map | Немає стандартного API-поля ISO валюти; треба хардкодити map (взяти з Python bolt_pricing_parser.py) |
| city_configs coverage | Якщо `city_configs` відсутній для якогось міста, zones/pricings впадуть. Обробити gracefully |
| getCard per vehicle type | Кількість POST-запитів = кількість типів транспорту × 1. При великих сесіях може бути повільно |
| 401 на refresh | Якщо `auth_bearer_token` прострочений — немає автоматичного виходу; треба повідомити про необхідність ручного оновлення в БД |
