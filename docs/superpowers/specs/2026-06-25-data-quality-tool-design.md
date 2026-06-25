# Data Quality Tool — Design Spec

**Date:** 2026-06-25  
**Status:** Draft  

---

## 1. Мета

Внутрішній веб-інструмент для перевірки коректності даних, зібраних скраперами.
Дозволяє QA-інженерам і розробникам скраперів виявляти проблеми з повнотою та
якістю даних, а також відстежувати тренди між сесіями збору.

**Користувачі:** розробники скраперів (швидка перевірка після змін) та QA-інженери
(регулярний моніторинг якості даних).

---

## 2. Стек

| Шар | Технологія |
|-----|------------|
| Fullstack framework | Next.js (App Router) + TypeScript |
| ORM | Prisma |
| БД інструменту | PostgreSQL (власна) |
| БД скраперів | PostgreSQL (зовнішня, read-only) |
| AI | OpenAI SDK, `baseURL: https://ai.groupbwt.dev/v1`, модель `minimax/MiniMax-M3` |

---

## 3. Архітектура

Два незалежних підключення до БД:

- **`scrapers_db`** — зовнішня БД скраперів, тільки читання. Звідси беремо дані
  для перевірок і рахуємо кількість сутностей.
- **`quality_db`** — власна БД інструменту. Зберігаємо сесії перевірок,
  результати, AI-оцінки, конфіги.

```
app/
  (dashboard)/              ← головна сторінка з трендами
  sessions/
    new/                    ← форма запуску перевірки
    [id]/                   ← результати конкретної сесії
  api/
    checks/                 ← запуск перевірки
    sessions/               ← CRUD сесій
    ai/                     ← AI-порівняння
    webhooks/
      session-complete/     ← сигнал від системи скраперів
lib/
  scrapers-db/              ← клієнт до зовнішньої БД
  quality-db/               ← Prisma клієнт
  ai/                       ← обгортка OpenAI SDK
```

---

## 4. Типи перевірок

Система реалізує два незалежні типи перевірок, які можна вмикати окремо:

### 4.1 API→DB Check (перевірка повноти)

1. Для кожного обраного полігону — запит до API скрапера.
2. Для кожної отриманої сутності — пошук в `scrapers_db` по ID (без прив'язки
   до полігону, бо полігони можуть перетинатись і дані дедуплікуються).
3. Фіксуємо: знайдена / не знайдена в БД.
4. Агрегуємо унікальні ID по всіх полігонах на рівні сесії.

**Напрямок:** тільки API → БД. Зворотня перевірка (БД → API) не виконується
через ефект перекриття полігонів.

### 4.2 Delta Check (перевірка тренду)

Порівнює кількість сутностей між двома сесіями скрапера в `scrapers_db`:

```sql
SELECT COUNT(*) FROM entities
WHERE app_id = :appId AND session_id = :sessionId AND entity_type = :type
```

Виконується для поточної та попередньої сесії. Рахує дельту у відсотках.
API не залучається.

---

## 5. Модель даних (quality_db)

```
CheckSession
  id
  createdAt
  environment          (staging | production)
  appId
  scrapersSessionId    (поточна — зовнішня сесія скраперів)
  polygonIds[]         (які полігони перевірялись)
  entityTypes[]        (dockless | docked | pricings | zones)
  checksEnabled[]      (api_db | delta)
  aiSampleSize         (кількість пар для AI, задається користувачем)
  status               (running | completed | failed)
  triggeredBy          (manual | webhook)

PolygonCheck           (per polygon, per entity type)
  id
  checkSessionId
  polygonId
  entityType
  apiEntityIds[]       (що прийшло з API)
  foundInDb[]
  notFoundInDb[]

EntityCheckSummary     (агрегат на рівні сесія + тип сутності)
  id
  checkSessionId
  entityType
  totalUniqueInApi     (дедупліковано по всіх полігонах)
  totalFoundInDb
  totalNotFoundInDb

SessionDeltaCheck      (per entity type)
  id
  checkSessionId
  entityType
  currentScrapersSessionId
  previousScrapersSessionId
  currentCount         (з scrapers_db)
  previousCount        (з scrapers_db)
  deltaPercent
  deltaFlag            (ok | warning | critical)

AiComparison           (per entity pair)
  id
  checkSessionId
  entityType
  entityId
  apiSnapshot          (JSON)
  dbSnapshot           (JSON)
  verdict              (Same | SomewhatSame | Different)
  explanation

AlertThreshold         (пороги для delta flag)
  appId
  entityType
  warningThresholdPct
  criticalThresholdPct

AutoCheckConfig        (конфіг для автозапуску по webhook)
  appId
  entityTypes[]
  polygonStrategy      (random | by_city_random | by_city_all)
  aiSampleSize
  checksEnabled[]
  enabled
```

---

## 6. UI та навігація

### 6.1 Головна сторінка — Dashboard

- Таблиця скраперів: назва, остання сесія, статус API→DB check, статус delta,
  дата.
- Для кожного скрапера — **три графіки в ряд** (діапазон за замовчуванням: 7 днів,
  фільтрується по даті створення сесії):

| Графік | Тип | Дані | Серії |
|--------|-----|------|-------|
| **Total** | Line chart | `SessionDeltaCheck.currentCount` (з зовнішньої БД) | 4 лінії по типу сутності, toggleable |
| **Completeness** | Line chart | `EntityCheckSummary.totalNotFoundInDb` | 4 лінії по типу сутності, toggleable |
| **Quality** | Grouped bar | `AiComparison` вердикти per session | 3 групи: Same / SomewhatSame / Different |

- Кнопка **"Run Check"** — завжди доступна з головної сторінки.

### 6.2 Форма нової перевірки (`/sessions/new`)

Усі параметри на одній сторінці (не wizard):

```
1. Environment        [staging | production]
2. Scraper            [dropdown]
3. Check types        [✓ API→DB  ✓ Delta]
4. Polygons           [random | by ID | by city → all / random one]
5. Entity types       [✓ dockless ✓ docked ✓ pricings ✓ zones]
6. AI sample size     [числове поле, default: 5, max: 20]
7. Compare session    [якщо Delta увімкнено — вибір попередньої сесії]
                      [Run Check]
```

### 6.3 Сторінка сесії (`/sessions/[id]`)

Вкладки по типах сутності. В кожній вкладці:

- **API→DB**: `totalUniqueInApi` / `totalFoundInDb` / `totalNotFoundInDb`,
  список відсутніх ID.
- **Delta**: таблиця `currentCount vs previousCount`, дельта %, deltaFlag.
- **AI оцінки**: список пар із вердиктом і поясненням AI.
- **Manual review**: вибір будь-якої сутності → side-by-side JSON (API vs БД).

---

## 7. AI-оцінка

**Провайдер:** OpenAI SDK, `baseURL: https://ai.groupbwt.dev/v1`,
модель `minimax/MiniMax-M3`.

**Коли запускається:** після API→DB check, для випадкової вибірки зі спільних
сутностей (є і в API, і в БД). Розмір вибірки задає користувач (`aiSampleSize`).

**Передаємо повні об'єкти** — без видалення динамічних полів.

**Промпт-інструкція:**

```
Порівняй два об'єкти одного типу сутності (API vs БД).

Деякі поля є динамічними за природою:
- Координати: незначне переміщення в межах міста — норма.
  Переміщення в іншу країну або континент — аномалія.
- Заряд батареї, статус доступності — можуть змінюватись, це норма.
- Ідентифікатори, назви, тарифи — мають збігатись.

Оціни з урахуванням цього контексту.
Поверни JSON: { "verdict": "Same|SomewhatSame|Different", "explanation": "..." }
```

**Контроль розміру контексту:** через `aiSampleSize`, не через обрізку об'єктів.
Максимум: 20 пар за запит.

---

## 8. Автозапуск через webhook

Замість cron-розкладу — сигнал від системи скраперів після завершення сесії:

```
POST /api/webhooks/session-complete
{
  "appId": "lime",
  "scrapersSessionId": 123
}
```

Система знаходить `AutoCheckConfig` для цього `appId` (якщо `enabled: true`)
і запускає перевірку з попередньо збереженими параметрами. Полігони обираються
відповідно до `AutoCheckConfig.polygonStrategy` — так само як при ручному запуску.

---

## 9. Майбутні розширення (поза першою версією)

| Розширення | Опис |
|------------|------|
| Slack-алерти | Push при `deltaFlag = critical` або критичній кількості `notFoundInDb` |
| Config management UI | Збережені профілі перевірок, редагування `AutoCheckConfig` |
| Попередження розміру AI-вибірки | Оцінка середнього розміру об'єкта → рекомендований `aiSampleSize` |
| Розширена фільтрація дашборду | Фільтр по environment, entity type, статусу перевірки |
