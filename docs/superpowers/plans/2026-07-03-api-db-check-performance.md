# API→DB Check Performance Plan

**Goal:** повна перевірка міста для тайлових скраперів (Ryde/Bærum = 4217 полігонів)
за **≤15 хв** замість ~5 год — без збільшення тиску на API скрапера понад те,
що робить сама система скраперів (Scrapy з concurrency 16+).

**Architecture:** п'ять незалежних фіксів: (1) SQL-фікс кастів, що блокують індекс;
(2) early-return для порожніх ID-списків; (3) кеш city context на місто замість
запиту на кожен полігон; (4) крос-тайловий кеш деталей Ryde (тайли перетинаються
~30%); (5) обмежена конкурентність обходу полігонів (opt-in per adapter).
Прогрес-бар/черга/checkpoint — окремі покращення (`docs/potential-improvements.md`),
цей план їх не чіпає.

**Tech Stack:** без нових npm-пакетів (крок 6 з undici — опційний, лише якщо
пакет уже є транзитивно). Vitest, існуючі інтерфейси.

## Global Constraints

- scrapers_db — **тільки читання**
- Поведінка існуючих адаптерів **за замовчуванням не змінюється**:
  конкурентність — opt-in полем адаптера (default 1 = поточна послідовність)
- `npx tsc --noEmit` + `npx vitest run` — зелені після кожного кроку
- Семантика результатів (PolygonCheck / EntityCheckSummary / повнота) — без змін

---

## Виміряний baseline (сесія Bærum, 2026-07-03, ~5 год)

| Стаття витрат на тайл | Виміряно | На 4217 тайлів | Фікс |
|---|---|---|---|
| `getRydeCityContext` на кожен полігон | ~750мс (199мс на сервері: `cp.id::text = $1` → фільтр-скан ~4.6к рядків/місто, EXPLAIN підтверджено) | ~53 хв | кроки 1+3 |
| Пауза між полігонами 500мс + джитер | ~625мс | ~44 хв | крок 5 (паралелізм, пауза лишається per-worker) |
| List-запит + TLS-хендшейк щоразу (нема reuse через паузи) | ~0.5–1с | ~35–70 хв | кроки 5+6 |
| `findEntitiesByIds` на полігон навіть з порожнім списком ID | ~50–100мс RTT | ~5 хв | крок 2 |
| Повторні detail-запити через перетин тайлів (дедуп лише в межах тайла) | 150мс+RTT × дублікати | ~10–30 хв | крок 4 |
| Ретраї `ApiUnexpectedResponseError` | 5с/спроба | залежить | — (не чіпаємо) |

Чому скрапер швидший: Scrapy concurrency 16–32 + кілька воркерів, контекст
у повідомленні брокера (0 запитів до БД на тайл), постійні HTTP-сесії.

---

## Кроки

- [x] **Крок 0 — порядок обробки типів: спершу швидкі, потім найдовший** ✅ (2026-07-06)
  Зараз `runCheckSession` (`orchestrator.ts`) обходить `input.entityTypes`
  у порядку, в якому їх передав користувач. Zones і pricings у більшості
  адаптерів збираються **одним запитом на місто** (або `center_only`), тож
  завершуються за секунди; docked — теж помітно швидше за dockless
  (dockless = тайли 'all' + двоетапне збагачення). Оброблюючи їх першими,
  ми зберігаємо `EntityCheckSummary`/`PolygonCheck` для zones/pricings/docked
  майже одразу — користувач працює з цими даними, поки найдовший dockless
  ще виконується (результати з'являються інкрементально, сесія `running`).

  a. У `orchestrator.ts` перед циклом відсортувати типи за фіксованим
     пріоритетом (не мутуючи `input.entityTypes`):
     ```typescript
     // Fast, city-level entity types first; dockless (per-tile, two-step) last,
     // so partial results land early while the long crawl is still running.
     const ENTITY_ORDER: Record<EntityType, number> = {
       zones: 0, pricings: 1, docked: 2, dockless: 3,
     }
     const orderedEntityTypes = [...input.entityTypes as EntityType[]]
       .sort((a, b) => ENTITY_ORDER[a] - ENTITY_ORDER[b])
     ```
     Замінити `for (const entityType of input.entityTypes ...)` на
     `for (const entityType of orderedEntityTypes)`.
  b. Семантика не змінюється — кожен тип обробляється рівно раз, ті самі
     запити, ті самі записи; змінюється лише **черговість** появи результатів.
  c. Порядок стосується і `api_db`/`ai`, і `delta` (все в тому ж циклі) —
     нешкідливо, delta швидка в будь-якому разі.
  Перевірити: UI сторінки сесії не покладається на порядок `entityTypes`
  (рендерить наявні summary/polygon-check незалежно). `npx tsc --noEmit`,
  `npx vitest run`.

- [x] **Крок 1 — SQL: прибрати касти, що блокують індекс**
  У `src/lib/scrapers-db.ts` всі предикати виду `cp.id::text = $1` замінити на
  `cp.id = $1::int` (каст на параметрі, а не на колонці):
  `getPolygonBounds`, `getVoiZoneId`, `getBoltCityContext`, `getLyftCityContext`,
  `getRydeCityContext`, `getHumanForestZoneContext` (+ перевірити grep'ом
  `::text = \$` по файлу). `polygonId` завжди походить з `city_polygons.id`
  (int), тож каст безпечний.
  Верифікація: EXPLAIN ANALYZE context-запиту — було 199мс, має стати <5мс
  (Index Scan по `city_polygons_pkey`).
  ✅ **Зроблено (2026-07-06).** Виправлено 5 предикатів у `scrapers-db.ts`
  (`getBoltCityContext`, `getVoiZoneId`, `getLyftCityContext`,
  `getRydeCityContext`, `getHumanForestZoneContext` subquery). `getPolygonBounds`
  вже мав `cp.id = $1` (безпечно). `getCitiesForApps` (`app_id::text`) не чіпали —
  config-time запит по малій таблиці `cities`, не гарячий шлях.
  EXPLAIN ANALYZE (stage, polygon 1904690): OLD `cp.id::text = $1` →
  Filter-скан, Rows Removed by Filter: 4581, **105мс**; NEW `cp.id = $1::int` →
  Index Scan `city_polygons_pkey`, **4.8мс** (~22× швидше). tsc + 133/133 тестів зелені.
  `npx tsc --noEmit`, `npx vitest run`.

- [x] **Крок 2 — early return у `findEntitiesByIds`** ✅ (2026-07-06)
  Перший рядок функції: `if (ids.length === 0) return new Map()`.
  Прибирає марний round-trip для кожного порожнього тайла (~98% тайлів Bærum).
  **Вже було реалізовано** — `scrapers-db.ts:81` містить
  `if (entityIds.length === 0) return new Map()`; гард спрацьовує на per-polygon
  виклик з `api-db-check.ts:80` (порожній тайл → `apiEntityIds = []` → без round-trip).
  Верифіковано читанням коду; tsc + 133/133 тестів зелені.

- [x] **Крок 3 — кеш city context (одне місто = один запит)** ✅ (2026-07-06)
  Всі 4217 тайлів Bærum мають ідентичний контекст. Додати мінімальний
  TTL-кеш і застосувати в адаптерах, що читають контекст per-polygon:

  ```typescript
  // src/lib/checks/adapters/ttl-cache.ts
  export class TtlCache<V> {
    private store = new Map<string, { v: V; exp: number }>()
    constructor(private ttlMs = 15 * 60_000) {}
    async getOrLoad(key: string, load: () => Promise<V>): Promise<V> { /* ... */ }
  }
  ```

  Ключ — `polygon.city ?? polygon.polygonId` (PolygonBounds.city вже є).
  Застосувати: ryde (`getRydeCityContext`), bolt, lyft, voi (`getVoiZoneId`),
  human_forest. TTL 15 хв — процес довгоживучий (dev-сервер), конфіги міст
  майже статичні; TTL страхує від протухання.
  **Кешується тільки per-city контекст** (cityId, gps_lat/gps_lng, cityUnit) —
  per-tile параметри (iotLa/iotLo/nearRadius/phoneLa/phoneLo у Ryde) в БД не
  ходять: `tileParams(polygon)` обчислює їх з `PolygonBounds` (polygon_type /
  boundBox), які вже резолвляться один раз на сесію. У кеш вони не потрапляють.
  `npx tsc --noEmit`, `npx vitest run`.

  **Зроблено:** створено `ttl-cache.ts` (`TtlCache<V>`, default TTL 15 хв,
  дедуплікація in-flight промісів для сумісності з worker-pool кроку 5, фейли
  не кешуються). Застосовано в адаптерах: `ryde` (`cityContextCache`),
  `voi` (`zoneIdCache`), `lyft` (`cityContextCache` + `getCityContext` helper,
  3 виклики), `bolt` (`cityContextCache` + `getCityContext` helper, 3 виклики),
  `human_forest` (`zoneContextCache`). Ключ — `polygon.city ?? polygon.polygonId`.
  Найбільший виграш — Ryde/Bolt/Lyft dockless ('all'): контекст читається раз
  на місто замість кожного тайла. 6 юніт-тестів у `__tests__/ttl-cache.test.ts`
  (loads once, distinct keys, in-flight dedup, no-cache-on-failure, TTL expiry,
  clear). tsc + 139/139 тестів зелені.

- [x] **Крок 4 — крос-тайловий кеш деталей Ryde** ✅ (2026-07-06)
  Тайли перетинаються → той самий IMEI детально збагачується в кількох тайлах.
  a. Розширити `ScraperApiAdapter` опційними хуками життєвого циклу прогону:
     ```typescript
     /** Called by runApiDbCheck before/after the polygon loop of one entity type. */
     beginRun?(entityType: EntityType): void
     endRun?(entityType: EntityType): void
     ```
     `runApiDbCheck` викликає їх навколо циклу полігонів.
  b. У `RydeScraperApiAdapter`: `private detailCache = new Map<string, ScraperEntity>()`,
     очищення в `beginRun`. У `fetchDockless`: IMEI вже в кеші → взяти сутність
     звідти (без HTTP і без witout 150мс паузи); свіжі деталі — покласти в кеш.
     Per-tile cap `MAX_VEHICLE_DETAILS` рахує **тільки свіжі** detail-запити.
     Сутність все одно потрапляє в результат полігона (повнота per-polygon
     не змінюється).
  c. Тести: юніт на кеш-хіт (другий виклик fetchDockless з тим самим IMEI
     не робить detail-запит — мок fetch).
  `npx tsc --noEmit`, `npx vitest run`.

  **Зроблено:** додано опційні `beginRun?`/`endRun?` в `ScraperApiAdapter`;
  `api-db-check.ts` викликає `adapter.beginRun?.(entityType)` перед циклом і
  `adapter.endRun?.(entityType)` у `finally` після нього. У `RydeScraperApiAdapter`:
  `detailCache = new Map<string, ScraperEntity>()`, `beginRun` чистить його для
  `dockless`. `fetchDockless` переписано: кеш-хіт по IMEI → сутність із кешу без
  HTTP/паузи; лічильник `freshDetailCount` рахує **тільки свіжі** detail-запити
  (кеш-хіти капу не підлягають), свіжа сутність кладеться в кеш. Повнота
  per-polygon не змінюється — обидва тайли рапортують засіб. 2 юніт-тести у
  `__tests__/ryde-adapter.test.ts` (overlapping tiles → 1 detail замість 2;
  beginRun скидає кеш → повторний прогон знову тягне деталі). tsc + 141/141 зелені.

- [x] **Крок 5 — обмежена конкурентність обходу полігонів (головний виграш)** ✅ (2026-07-06)
  a. `ScraperApiAdapter`: нове опційне поле
     ```typescript
     /** Max polygons processed concurrently. Default 1 (sequential). */
     maxConcurrentPolygons?: number
     ```
  b. `runApiDbCheck`: замість `for..of` — worker-pool без нових залежностей:
     ```typescript
     const workers = Math.max(1, adapter.maxConcurrentPolygons ?? 1)
     let next = 0
     await Promise.all(Array.from({ length: workers }, async () => {
       while (next < polygons.length) {
         const i = next++
         if (i >= workers) await sleep(baseDelay + Math.random() * baseDelay * 0.5)
         await processPolygon(polygons[i]) // існуюче тіло циклу, винесене у функцію
       }
     }))
     ```
     - пауза `interPolygonDelayMs` зберігається **per-worker** (глобальний RPS
       = workers / delay ≈ 8 запитів/с при 8 воркерах — нижче за Scrapy-профіль
       самого скрапера);
     - retry-логіка (5с + suspectedBlock) — без змін, всередині `processPolygon`;
     - спільні структури (`allApiIds`, `apiEntityMap`, `polygonResults`) —
       безпечні: один event loop, без await всередині секцій запису;
     - порядок `polygonResults` стає недетермінованим — на записи PolygonCheck
       і агрегати це не впливає (перевірити, що UI не покладається на порядок).
  c. Увімкнути: `RydeScraperApiAdapter.maxConcurrentPolygons = 8`.
     Ario/Bolt/Lyft (dockless 'all') — окреме рішення після смоуку Ryde
     (консервативно: лишити 1, вмикати поступово).
  d. Тест: юніт на пул (мок-адаптер з лічильником паралельних викликів —
     не перевищує ліміт; всі полігони оброблені рівно раз).
  `npx tsc --noEmit`, `npx vitest run`.

  **Зроблено:** додано опційне `maxConcurrentPolygons?` в `ScraperApiAdapter`.
  `api-db-check.ts`: тіло циклу винесено у `processPolygon(bounds)`; замість
  `for..of` — пул із `workers = max(1, maxConcurrentPolygons ?? 1)` через
  `Promise.all` + спільний курсор `next++`. Пауза `interPolygonDelayMs` +
  jitter збережена per-worker (перші `workers` полігонів стартують одразу).
  Retry-логіка не змінена (всередині `processPolygon`). Увімкнено для Ryde:
  `maxConcurrentPolygons = 8` (8 × 625мс ≈ 13 req/s, нижче за Scrapy-профіль).
  Перевірено UI на незалежність від порядку `polygonResults`:
  `ApiDbResultsTab` (flatMap+Set), `ManualReviewPanel` (find за вмістом),
  `page.tsx` (Set по polygonId) — порядок не важливий. 2 юніт-тести у
  `__tests__/api-db-check.test.ts` (конкурентність ≤ліміту й реально >1, кожен
  полігон рівно раз; default = послідовно). tsc + 143/143 зелені.

- [x] **Крок 6 (опційний) — keep-alive для вихідних HTTPS** ✅ (2026-07-06)
  Перевірити наявність `undici` в node_modules (транзитивно від Next):
  якщо є — в одному місці (напр. `instrumentation.ts`)
  `setGlobalDispatcher(new Agent({ keepAliveTimeout: 30_000, connections: 16 }))`,
  щоб TLS-хендшейк не платився на кожен запит. Якщо пакета немає — крок
  пропускається (виграш частково перекривається кроком 5: при конкурентності
  паузи між запитами одного воркера коротші за keep-alive сервера).

  **Зроблено:** `undici@7.28.0` присутній (транзитивно через `shadcn`).
  Перевірено, що `setGlobalDispatcher` з npm-пакета впливає на вбудований у
  Node 22 global `fetch` — вони ділять well-known symbol
  `Symbol.for('undici.globalDispatcher.1')` (наші адаптери викликають global
  `fetch`, тож keep-alive застосується). Створено `src/instrumentation.ts`:
  `register()` тільки для `NEXT_RUNTIME === 'nodejs'`, **захищений** динамічний
  `import('undici')` у try/catch — якщо транзитивна залежність зникне/зміниться,
  логуємо warning і працюємо далі (крок 5 не залежить від keep-alive). Agent:
  `keepAliveTimeout: 30_000`, `connections: 16`. Верифіковано на dev-сервері:
  після першого запиту лог `[instrumentation] undici keep-alive dispatcher enabled`,
  HTTP 200. tsc чистий.

- [ ] **Крок 7 — смоук і замір**
  Прогнати dockless-сесію по невеликому місту (або Bærum) на stage,
  зафіксувати wall-clock у плані. Ціль: Bærum ≤ 15 хв, результати повноти
  еквівалентні попередній сесії (totalUniqueInApi у межах природного дрейфу).

---

## Очікуваний ефект (Bærum, 4217 тайлів)

> Крок 0 не зменшує **загальний** час сесії — він скорочує час до *перших
> корисних даних*: zones/pricings/docked стають доступні за секунди-хвилини,
> dockless добігає останнім. Нижче — тривалість саме dockless-частини.

| Після кроку | Оцінка тривалості dockless |
|---|---|
| Baseline | ~5 год |
| 1+2+3 (SQL + кеші) | ~1.5–2 год |
| +4 (дедуп деталей) | ~1.2–1.5 год |
| +5 (конкурентність 8) | **~10–15 хв** |
| +6 (keep-alive) | −10–20% до попереднього |

## Ризики

- **Rate limiting / блок від Ryde**: конкурентність 8 з паузою 625мс/воркер —
  консервативніше за профіль самого скрапера; якщо з'являться
  `suspectedBlock` — знизити `maxConcurrentPolygons` (це одне число).
- **Кеш контексту протух** (зміна city_configs під час прогону) — TTL 15 хв,
  прийнятно для конфігів, що змінюються раз на місяці.
- **Недетермінований порядок полігонів** — перевірити UI на залежність від
  порядку PolygonCheck (не має бути).
