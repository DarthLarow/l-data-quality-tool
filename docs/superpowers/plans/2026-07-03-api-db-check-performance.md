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

- [ ] **Крок 1 — SQL: прибрати касти, що блокують індекс**
  У `src/lib/scrapers-db.ts` всі предикати виду `cp.id::text = $1` замінити на
  `cp.id = $1::int` (каст на параметрі, а не на колонці):
  `getPolygonBounds`, `getVoiZoneId`, `getBoltCityContext`, `getLyftCityContext`,
  `getRydeCityContext`, `getHumanForestZoneContext` (+ перевірити grep'ом
  `::text = \$` по файлу). `polygonId` завжди походить з `city_polygons.id`
  (int), тож каст безпечний.
  Верифікація: EXPLAIN ANALYZE context-запиту — було 199мс, має стати <5мс
  (Index Scan по `city_polygons_pkey`).
  `npx tsc --noEmit`, `npx vitest run`.

- [ ] **Крок 2 — early return у `findEntitiesByIds`**
  Перший рядок функції: `if (ids.length === 0) return new Map()`.
  Прибирає марний round-trip для кожного порожнього тайла (~98% тайлів Bærum).
  `npx tsc --noEmit`, `npx vitest run`.

- [ ] **Крок 3 — кеш city context (одне місто = один запит)**
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
  `npx tsc --noEmit`, `npx vitest run`.

- [ ] **Крок 4 — крос-тайловий кеш деталей Ryde**
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

- [ ] **Крок 5 — обмежена конкурентність обходу полігонів (головний виграш)**
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

- [ ] **Крок 6 (опційний) — keep-alive для вихідних HTTPS**
  Перевірити наявність `undici` в node_modules (транзитивно від Next):
  якщо є — в одному місці (напр. `instrumentation.ts`)
  `setGlobalDispatcher(new Agent({ keepAliveTimeout: 30_000, connections: 16 }))`,
  щоб TLS-хендшейк не платився на кожен запит. Якщо пакета немає — крок
  пропускається (виграш частково перекривається кроком 5: при конкурентності
  паузи між запитами одного воркера коротші за keep-alive сервера).

- [ ] **Крок 7 — смоук і замір**
  Прогнати dockless-сесію по невеликому місту (або Bærum) на stage,
  зафіксувати wall-clock у плані. Ціль: Bærum ≤ 15 хв, результати повноти
  еквівалентні попередній сесії (totalUniqueInApi у межах природного дрейфу).

---

## Очікуваний ефект (Bærum, 4217 тайлів)

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
