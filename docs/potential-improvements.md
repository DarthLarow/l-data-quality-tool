# Потенційні покращення

Беклог ідей з чернетками реалізації. Не є зобов'язанням — пріоритети й деталі
уточнюються перед стартом роботи.

---

## 1. Прогрес-бар сесії

**Проблема:** `runCheckSession` виконується синхронно всередині `POST /api/checks`;
статус сесії — лише `running` / `completed` / `failed`. Користувач не бачить,
скільки роботи залишилось (для скраперів зі стратегією `'all'` перевірка може
тривати хвилини — сотні полігонів × затримки між запитами).

**Де відображати:**
- сторінка створення сесії (одразу після запуску),
- сторінка сесії `/sessions/[id]` та список `/sessions`,
- дашборд `/` (рядок скрапера з активною сесією).

### Чернетка реалізації

**1. Схема** — додати поля прогресу в `CheckSession`:

```prisma
model CheckSession {
  // ... існуючі поля
  progressDone  Int     @default(0)
  progressTotal Int     @default(0)
  progressStage String? // напр. "dockless: полігон 3/10" або "delta: pricings"
}
```

**2. Запуск у фоні** — розділити `runCheckSession` (`src/lib/checks/orchestrator.ts`)
на дві частини, щоб `POST /api/checks` повертав `sessionId` одразу:

```typescript
// orchestrator.ts
export async function createCheckSession(input: CheckSessionInput): Promise<string> // create + progressTotal
export async function executeCheckSession(sessionId: string, input: CheckSessionInput): Promise<void>

// app/api/checks/route.ts
import { after } from 'next/server'

export async function POST(req: NextRequest) {
  const input = await req.json()
  const sessionId = await createCheckSession(input)
  after(() => executeCheckSession(sessionId, input)) // виконується після відповіді
  return NextResponse.json({ sessionId })            // клієнт редіректить на /sessions/[id]
}
```

`progressTotal` порахувати наперед: для `api_db`/`ai` — `entityTypes.length × resolvedPolygons.length`
(полігони вже резолвляться один раз до циклу), для `delta` — `+ entityTypes.length`.

**3. Репорт прогресу** — колбек, який orchestrator передає в `runApiDbCheck`
(викликається після кожного полігона) і сам викликає після кожного delta-кроку.
Оновлення БД тротлити (не частіше 1 разу/сек або кожен N-й полігон):

```typescript
type ProgressReporter = (stage: string) => Promise<void>

const makeReporter = (sessionId: string, total: number): ProgressReporter => {
  let done = 0
  let lastWrite = 0
  return async (stage) => {
    done++
    if (Date.now() - lastWrite < 1000 && done < total) return
    lastWrite = Date.now()
    await prisma.checkSession.update({
      where: { id: sessionId },
      data:  { progressDone: done, progressTotal: total, progressStage: stage },
    })
  }
}
```

**4. API** — легкий ендпоінт для поллінгу
`GET /api/sessions/[id]/progress` → `{ status, progressDone, progressTotal, progressStage }`
(`select` лише цих полів, без relations).

**5. UI** — клієнтський компонент `SessionProgressBar` (Shadcn `Progress`):

```tsx
function SessionProgressBar({ sessionId }: { sessionId: string }) {
  const [p, setP] = useState<Progress | null>(null)
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch(`/api/sessions/${sessionId}/progress`).then((r) => r.json())
      setP(r)
      if (r.status !== 'running') clearInterval(t) // completed/failed → router.refresh()
    }, 2000)
    return () => clearInterval(t)
  }, [sessionId])
  // <Progress value={done / total * 100} /> + progressStage текстом
}
```

Розміщення:
- `/sessions/new`: після сабміту не редіректити одразу, а показати бар на місці
  форми (або редірект на `/sessions/[id]`, де бар уже є) — простіший варіант: редірект;
- `/sessions/[id]`: бар над вкладками, поки `status === 'running'`;
- `/sessions` (`SessionsList`): міні-бар у рядку running-сесій;
- дашборд: `GET /api/dashboard` додає `runningSession: { id, done, total } | null`
  на скрапер → тонкий індикатор у рядку.

**Нюанс:** `after()` в dev-режимі Next.js працює, але процес має жити до кінця
виконання (для довгих сесій на проді за serverless-лімітами краще винести
executeCheckSession у чергу/воркер — поза скоупом цього покращення).

---

## 2. Прогресивна форма створення сесії

**Ідея:** на `/sessions/new` всі поля спочатку задізейблені. Користувач обирає
**скрапер** → поля розблоковуються і **автозаповнюються з `AutoCheckConfig`**
цього скрапера (якщо конфіг заданий): environment, типи перевірок, типи сутностей,
стратегія полігонів, місто.

### Чернетка реалізації

Все в межах `src/components/sessions/CheckForm.tsx` + існуючого
`GET /api/config/auto-check`:

```tsx
const [appId, setAppId] = useState<string | null>(null)
const [prefilledFrom, setPrefilledFrom] = useState<'auto-check' | null>(null)
const locked = appId === null // усі поля (крім селекта скрапера) disabled={locked}

async function onScraperChange(newAppId: string) {
  setAppId(newAppId)
  const cfg = await fetch(`/api/config/auto-check?appId=${newAppId}`).then((r) => r.ok ? r.json() : null)
  if (cfg) {
    setForm((f) => ({
      ...f,
      environment:     cfg.environment,
      entityTypes:     cfg.entityTypes,
      checksEnabled:   cfg.checksEnabled,
      polygonStrategy: cfg.polygonStrategy,
      polygonCity:     cfg.polygonCity ?? f.polygonCity,
    }))
    setPrefilledFrom('auto-check')
  } else {
    setForm(DEFAULTS)          // конфігу немає — розблокувати з дефолтами
    setPrefilledFrom(null)
  }
}
```

UX-деталі:
- задізейблені поля візуально приглушені + tooltip «Спочатку оберіть скрапер»;
- якщо значення підтягнулись з auto-check — бейдж
  «Заповнено з auto-check конфігурації» і кнопка «Скинути до дефолтів»;
- зміна скрапера після заповнення — повторний prefill (з підтвердженням,
  якщо користувач уже щось редагував);
- session ID підвантажується як і зараз, після вибору скрапера + environment.

Backend-змін не потребує, якщо `GET /api/config/auto-check` вже вміє фільтр по
`appId` (перевірити; якщо ні — додати query-параметр).

---

## 3. ШІ-саммарайзер сесії

**Ідея:** на `/sessions/[id]` кнопка **«Обробити за допомогою ШІ»** → аналіз
результатів сесії моделлю (`minimax/MiniMax-M3` через існуючий `aiClient`) →
редірект на **`/sessions/[id]/summary`**: загальний самарі сесії + список
помічених дефектів (заголовок, серйозність, опис, докази, рекомендація).

### Чернетка реалізації

**1. Схема:**

```prisma
model SessionAiSummary {
  id             String   @id @default(cuid())
  checkSessionId String   @unique
  createdAt      DateTime @default(now())
  model          String
  overview       String   // 2–4 речення загального висновку
  defects        Json     // SessionDefect[]
  checkSession   CheckSession @relation(fields: [checkSessionId], references: [id], onDelete: Cascade)
}
```

```typescript
interface SessionDefect {
  title:           string                            // «30% dockless відсутні в БД»
  severity:        'info' | 'warning' | 'critical'
  entityType:      string | null                     // dockless | docked | pricings | zones | null
  description:     string                            // що саме не так і чому це проблема
  evidence:        string                            // числа/ID з даних сесії
  suggestedAction: string                            // що перевірити розробнику скрапера
}
```

**2. API** — `POST /api/sessions/[id]/summarize`:

1. Зібрати компактний JSON-контекст сесії (без повних снепшотів, щоб не роздувати промпт):
   - `entityCheckSummaries` (totalUniqueInApi / FoundInDb / NotFoundInDb, failedPolygons.length, suspectedBlock),
   - `sessionDeltaChecks` (deltaPercent, deltaFlag, counts),
   - `aiComparisons`: лише `verdict === 'Different'` — entityId, entityType, explanation (обрізати до ~50 записів),
   - метадані: appId, environment, entityTypes, checksEnabled.
2. Промпт (окремим файлом `docs/ai-comparison-prompts/session-summary.md`, за
   аналогією з існуючими промптами):

   ```
   You are a QA analyst for a mobility-data scraper system. Below is the JSON
   result of one data-quality check session. Summarize the session health and
   list concrete defects.

   Rules:
   - severity=critical: suspected block, >20% entities missing, critical delta flag
   - severity=warning: 5–20% missing, warning delta, field mismatches in static fields
   - severity=info: minor observations
   - evidence must cite concrete numbers/IDs from the input
   - respond ONLY with valid JSON:
     {"overview": "...", "defects": [{"title": "...", "severity": "...",
      "entityType": "...", "description": "...", "evidence": "...",
      "suggestedAction": "..."}]}
   ```
3. Виклик `aiClient.chat.completions.create({ model: 'minimax/MiniMax-M3', ... })`,
   парсинг JSON (одна повторна спроба при невалідному JSON), `upsert` у
   `SessionAiSummary` (повторний запуск = перегенерація).
4. Відповідь `{ ok: true }` → клієнт робить `router.push(`/sessions/${id}/summary`)`.

**3. Кнопка** — `SummarizeButton.tsx` поруч із `RerunButton` на `/sessions/[id]`:
клієнтський компонент, стан loading («Аналізую…», spinner, disabled), при помилці — toast.
Якщо самарі вже існує — кнопка стає «ШІ-самарі ↗» (лінк) + опція «Перегенерувати».

**4. Сторінка** — `src/app/sessions/[id]/summary/page.tsx` (server component):
- читає `SessionAiSummary`; якщо немає — empty state з кнопкою запуску;
- зверху — картка overview + дата генерації + модель;
- нижче — список дефектів, відсортований critical → warning → info:
  Card з бейджем серйозності (кольори як у deltaFlag), заголовком,
  описом, блоком evidence (моноширинний) і suggestedAction;
- кнопка «Перегенерувати» → той самий POST.

**Нюанси:**
- сесії зі статусом `running` — кнопка disabled (аналізувати неповні дані немає сенсу);
- якщо сесія `failed` — дозволити, але додати в контекст промпта статус, щоб ШІ
  прокоментував падіння;
- вартість/latency: один виклик на сесію, контекст ~кілька КБ — прийнятно.
