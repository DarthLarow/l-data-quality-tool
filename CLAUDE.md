# L-Data Quality Tool

Внутрішній веб-інструмент для перевірки коректності даних, зібраних скраперами.
Дозволяє QA-інженерам і розробникам скраперів виявляти проблеми з повнотою та
якістю даних, а також відстежувати тренди між сесіями збору.

> **Синоніми:** скрапер, app, джерело даних — все це посилання на застосунок,
> з якого скрапер збирає дані.

Детальний design spec: `docs/superpowers/specs/2026-06-25-data-quality-tool-design.md`  
Implementation plan: `docs/superpowers/plans/2026-06-25-data-quality-tool.md`

---

## Принцип збору даних (зовнішня система)

Щодня створюється **session**, до якої додаються **collection tasks** —
по одному на кожен city polygon. У базі даних зберігається набір city polygons,
що покривають територію збору даних. Полігони можуть перетинатись; система
скраперів запобігає дублікатам.

Збираються до 4 типів сутностей:

| Тип | Опис |
|-----|------|
| **Dockless fleets** | Засоби пересування без станцій (самокати, байки тощо) |
| **Docked fleets** | Зарядні станції та докінг-станції |
| **Pricings** | Ціни за використання та підписки |
| **Zones** | Зони операційної діяльності |

> Зовнішня БД не містить метаданих про підтримувані типи сутностей для кожного
> скрапера. Всі 4 типи доступні для вибору; якщо скрапер не підтримує тип —
> результат буде нульовим.

---

## Стек

| Шар | Технологія |
|-----|------------|
| Fullstack framework | Next.js 16.2.9 (App Router) + TypeScript |
| Package manager | npm |
| ORM | Prisma 6.19.3 (`provider = "prisma-client"`, output `src/generated/prisma`) |
| БД інструменту (`quality_db`) | PostgreSQL (Docker, порт 5433) |
| БД скраперів (`scrapers_db`) | PostgreSQL (зовнішня, read-only, через kubectl port-forward) |
| UI | Tailwind CSS v4 + Shadcn/UI v5 (radix-nova preset) + Recharts 3 |
| AI | OpenAI SDK, `baseURL: https://ai.groupbwt.dev/v1`, модель `minimax/MiniMax-M3` |
| Тести | Vitest 4 (config: `vitest.config.mts`, env: `.env.local`) |

### appId vs apps.id

`Scraper.appId` в quality_db = `apps.name` зі scrapers_db (наприклад `'ario'`, `'bird'`), **не** `apps.id` (integer).
Це рішення прийнято явно: `apps.name` стабільний між середовищами, `apps.id` — ні.
Sync route завжди конвертує: `appId = app.name`.

### Підключення до scrapers_db

Підключення через kubectl port-forward. Скрипти: `npm run scrapers-db:stage` (порт 5435),
`npm run scrapers-db:prod` (порт 5434). Env-змінні — окремі (`SCRAPERS_DB_HOST`,
`SCRAPERS_DB_PORT`, `SCRAPERS_DB_NAME`, `SCRAPERS_DB_USER`, `SCRAPERS_DB_PASSWORD`),
не єдиний `DATABASE_URL`.

> **ЗАБОРОНЕНО:** будь-який запис до `scrapers_db` (INSERT / UPDATE / DELETE).
> Зовнішня БД — **тільки для читання**. Для запису використовувати `quality_db` (Prisma).

---

## Два типи перевірок

**API→DB check** — перевірка повноти: для обраних полігонів виконує запити до API
скрапера і перевіряє чи кожна отримана сутність присутня в `scrapers_db` (пошук по ID,
без прив'язки до полігону). Напрямок тільки API→БД.

Особливості реалізації:
- Адаптер визначає стратегію обходу полігонів через `polygonStrategy(entityType)`:
  `'all'` (кожен полігон) або `'center_only'` (тільки центральна точка).
- Між запитами — затримка `interPolygonDelayMs` (базова) + jitter.
- При помилці `ApiUnexpectedResponseError` (наприклад, `null` там де очікується масив) —
  повторна спроба. Після вичерпання спроб полігон записується в `failedPolygons`,
  `suspectedBlock = true` для цього типу сутностей. UI відображає попередження.

**Delta check** — перевірка тренду: порівнює кількість сутностей між двома сесіями
в `scrapers_db` без залучення API. Виявляє аномальні зміни (наприклад, 1000 самокатів
→ 100). Попередня сесія автоматично підбирається (остання перед поточною глобально).
⚠️ Конкретні SQL-запити — прототип, уточнюються з розробниками скраперів.

---

## Навігація

| Сторінка | Опис |
|----------|------|
| `/` | Dashboard: список скраперів + три графіки трендів (Total / Completeness / AI Quality) + delta колонка, фільтр по діапазону днів |
| `/sessions/new` | Форма запуску перевірки (environment, scraper, типи перевірок, полігони, AI sample size) |
| `/sessions/[id]` | Результати сесії: вкладки API→DB / Delta / AI / Manual Review (side-by-side JSON) + кнопка Rerun |
| `/config` | Sync Scrapers + per-scraper auto-check конфіг + alert thresholds |

---

## Структура якість БД (quality_db)

| Модель | Призначення |
|--------|------------|
| `Scraper` | Синхронізовані скрапери; `appId` = `apps.name` зі scrapers_db |
| `CheckSession` | Одна запущена перевірка; `triggeredBy`: `"manual"` \| `"auto"` |
| `PolygonCheck` | Результат перевірки одного полігона для одного типу сутностей |
| `EntityCheckSummary` | Агрегат по типу сутностей: `totalUniqueInApi`, `totalFoundInDb`, `totalNotFoundInDb`, `failedPolygons[]`, `suspectedBlock` |
| `SessionDeltaCheck` | Delta між двома scrapers-сесіями: `deltaPercent`, `deltaFlag` |
| `AiComparison` | Пара API/DB снепшотів з вердиктом та поясненням AI |
| `AlertThreshold` | Порогові значення (%) та ліміти кількості для warning/critical |
| `AutoCheckConfig` | Збережена конфігурація авто-запуску для скрапера |

---

## Адаптери скраперів

`src/lib/checks/adapters/` — точка розширення для нових скраперів.

| Файл | Призначення |
|------|------------|
| `scraper-adapter.ts` | Інтерфейс `ScraperApiAdapter`, `ApiUnexpectedResponseError`, `adapterRegistry` |
| `ario-adapter.ts` | Повна реалізація для Ario (GMS OAuth → Ario token → 4 типи сутностей) |
| `mock-adapter.ts` | Мок для тестів |

Зареєстровані скрапери: `adapterRegistry` в `scraper-adapter.ts`.
Покроковий план додавання нового скрапера: `docs/adding-new-scraper.md`

---

## Сценарій використання

1. Перейти на `/config`, натиснути **Sync from scrapers_db** (потребує активного port-forward)
2. Обрати скрапер і налаштувати auto-check або перейти до ручного запуску
3. На `/sessions/new` обрати **environment**, **scraper**, **session ID**
4. Конфігурувати перевірку:
   - типи перевірок: API→DB та/або Delta
   - полігони: випадковий / за ID / за містом (всі або випадковий)
   - типи сутностей (всі 4 доступні; нульовий результат якщо скрапер не підтримує)
   - кількість пар для AI-аналізу (default: 5, max: 20)
   - попередня сесія для Delta (підбирається автоматично, можна змінити)
5. Переглядати результати на `/sessions/[id]`; при потребі — **Rerun**

---

## Відомі відхилення від плану

| Що | Як реалізовано |
|----|---------------|
| Shadcn стиль `new-york/zinc` | Використовується `radix-nova` preset (Shadcn v5) |
| `@prisma/client` | Генерується в `src/generated/prisma/client` |
| `params` в route handlers | `Promise<{ id: string }>` (Next.js 15+ вимога) |
| `SCRAPERS_DATABASE_URL` | Розбито на окремі `SCRAPERS_DB_*` змінні |
| `vitest.config.ts` | Перейменовано в `vitest.config.mts` (ESM сумісність) |
| Sync Scrapers в Sidebar | Переміщено до `/config` |
| supportedEntityTypes фільтрація | Вимкнено — зовнішня БД не має цих метаданих |

---

## externalSystemDocs

Папка `/externalSystemDocs/` містить документацію про зовнішні системи (схеми БД, API-специфікації тощо).

**ЗАБОРОНЕНО:** будь-які зміни, редагування або видалення файлів у цій папці.  
**ДОЗВОЛЕНО:** тільки читання для розуміння контексту.

Папка виключена з git (`.gitignore`) і ніколи не комітиться.

---

## Майбутні розширення

- **Real scraper adapters** — реалізувати `ScraperApiAdapter` для кожного скрапера
  (по одному файлу в `src/lib/checks/adapters/`), зареєструвати в `adapterRegistry`
- **Уточнення Delta SQL** — погодити конкретні таблиці/запити з командою розробників скраперів
- **Slack-алерти** — при критичних дельтах або великій кількості відсутніх сутностей
- **Автозапуск через webhook** — `POST /api/webhooks/session-complete` запускає перевірку
  за збереженим `AutoCheckConfig`; поле `triggeredBy = "auto"` вже є в схемі
