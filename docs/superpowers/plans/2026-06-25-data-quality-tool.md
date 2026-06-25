# Data Quality Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Побудувати внутрішній веб-інструмент (Next.js) для перевірки коректності даних скраперів: API→DB check, delta check між сесіями, AI-порівняння об'єктів, трендовий дашборд.

**Architecture:** Next.js App Router + TypeScript fullstack. Два підключення до БД: Prisma (quality_db — власна PostgreSQL у Docker) та `pg` (scrapers_db — зовнішня, read-only). AI через OpenAI SDK з корпоративним gateway.

**Tech Stack:** Next.js 15, TypeScript, Prisma 5, PostgreSQL 16 (Docker), Shadcn/UI, Recharts, OpenAI SDK, Vitest + React Testing Library.

## Global Constraints

- Node.js >= 20, pnpm як package manager
- TypeScript strict mode увімкнено
- Всі env-змінні через `.env.local` (не комітити); `.env.example` комітити
- quality_db: PostgreSQL 16 у Docker, порт 5433 (щоб не конфліктувати з локальним 5432)
- scrapers_db: read-only, жодних INSERT/UPDATE/DELETE
- AI endpoint: `baseURL: https://ai.groupbwt.dev/v1`, модель `minimax/MiniMax-M3`
- Кольорова семантика: `ok` = зелений, `warning` = жовтий, `critical` = червоний
- Shadcn/UI стиль `new-york`, тема `zinc`

---

## File Structure

```
/
├── docker-compose.yml
├── .env.example
├── prisma/
│   └── schema.prisma
├── src/
│   ├── types/index.ts                          # всі shared типи
│   ├── lib/
│   │   ├── quality-db.ts                       # Prisma client singleton
│   │   ├── scrapers-db.ts                      # pg client для зовнішньої БД
│   │   ├── ai/
│   │   │   ├── client.ts                       # OpenAI SDK wrapper
│   │   │   └── compare.ts                      # промпт + парсинг відповіді
│   │   └── checks/
│   │       ├── api-db-check.ts                 # логіка API→DB перевірки
│   │       ├── delta-check.ts                  # логіка delta перевірки
│   │       ├── orchestrator.ts                 # запуск всіх перевірок для сесії
│   │       └── adapters/
│   │           ├── scraper-adapter.ts          # інтерфейс ScraperApiAdapter
│   │           └── mock-adapter.ts             # mock для тестів
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── dashboard/
│   │   │   ├── ScraperTable.tsx
│   │   │   ├── ScraperChartRow.tsx
│   │   │   ├── TotalChart.tsx
│   │   │   ├── CompletenessChart.tsx
│   │   │   └── QualityChart.tsx
│   │   ├── sessions/
│   │   │   ├── CheckForm.tsx
│   │   │   ├── SessionResultsTabs.tsx
│   │   │   ├── ApiDbResultsTab.tsx
│   │   │   ├── DeltaResultsTab.tsx
│   │   │   ├── AiResultsTab.tsx
│   │   │   └── ManualReviewPanel.tsx
│   │   └── config/
│   │       ├── ThresholdForm.tsx
│   │       └── AutoCheckConfigForm.tsx
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx                            # Dashboard
│       ├── sessions/
│       │   ├── new/page.tsx
│       │   └── [id]/page.tsx
│       ├── config/page.tsx
│       └── api/
│           ├── checks/route.ts
│           ├── sessions/route.ts
│           ├── sessions/[id]/route.ts
│           ├── scrapers/route.ts
│           ├── scrapers/sync/route.ts
│           └── config/
│               ├── thresholds/route.ts
│               └── auto-check/route.ts
└── tests/
    ├── lib/checks/
    │   ├── api-db-check.test.ts
    │   └── delta-check.test.ts
    └── lib/ai/
        └── compare.test.ts
```

---

## Task 1: Project Setup & Docker

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.env.local` (gitignored)
- Create: `.gitignore` (доповнити)

- [ ] **Крок 1: Ініціалізувати Next.js проєкт**

```bash
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-git
```

Очікуваний результат: папка `src/app/`, файли `tsconfig.json`, `tailwind.config.ts`.

- [ ] **Крок 2: Увімкнути strict TypeScript**

У `tsconfig.json` переконатись що є:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Крок 3: Встановити базові залежності**

```bash
pnpm add prisma @prisma/client pg openai
pnpm add -D @types/pg vitest @vitejs/plugin-react @testing-library/react @testing-library/dom jsdom
```

- [ ] **Крок 4: Створити `docker-compose.yml`**

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: quality
      POSTGRES_PASSWORD: quality
      POSTGRES_DB: quality_db
    ports:
      - "5433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U quality"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

- [ ] **Крок 5: Створити `.env.example`**

```env
# Quality DB (Docker)
DATABASE_URL="postgresql://quality:quality@localhost:5433/quality_db"

# External scrapers DB (read-only)
SCRAPERS_DATABASE_URL="postgresql://user:pass@host:5432/scrapers_db"

# AI Gateway
AI_BASE_URL="https://ai.groupbwt.dev/v1"
AI_AUTH_TOKEN="sk-..."
AI_MODEL="minimax/MiniMax-M3"
```

- [ ] **Крок 6: Створити `.env.local`** з реальними значеннями (не комітити).

- [ ] **Крок 7: Переконатись що `.env.local` в `.gitignore`**

```
.env.local
.env*.local
```

- [ ] **Крок 8: Запустити Docker і перевірити підключення**

```bash
docker compose up -d
docker compose ps
# очікуємо: postgres running (healthy)
```

- [ ] **Крок 9: Налаштувати Vitest**

Створити `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

Додати до `package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Крок 10: Commit**

```bash
git add -A
git commit -m "feat: project setup with Next.js, Docker, Vitest"
```

---

## Task 2: Quality DB Schema (Prisma)

**Files:**
- Create: `prisma/schema.prisma`

**Produces:**
- Prisma Client з моделями: `Scraper`, `CheckSession`, `PolygonCheck`, `EntityCheckSummary`, `SessionDeltaCheck`, `AiComparison`, `AlertThreshold`, `AutoCheckConfig`

- [ ] **Крок 1: Ініціалізувати Prisma**

```bash
pnpm prisma init --datasource-provider postgresql
```

- [ ] **Крок 2: Записати схему в `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Scraper {
  id                   String    @id @default(cuid())
  appId                String    @unique
  name                 String
  supportedEntityTypes String[]
  isActive             Boolean   @default(true)
  lastSyncedAt         DateTime?
  createdAt            DateTime  @default(now())

  checkSessions   CheckSession[]
  alertThresholds AlertThreshold[]
  autoCheckConfig AutoCheckConfig?
}

model CheckSession {
  id                String   @id @default(cuid())
  createdAt         DateTime @default(now())
  environment       String
  appId             String
  scrapersSessionId Int
  polygonIds        String[]
  entityTypes       String[]
  checksEnabled     String[]
  aiSampleSize      Int      @default(5)
  status            String   @default("running")
  triggeredBy       String   @default("manual")

  scraper              Scraper              @relation(fields: [appId], references: [appId])
  polygonChecks        PolygonCheck[]
  entityCheckSummaries EntityCheckSummary[]
  sessionDeltaChecks   SessionDeltaCheck[]
  aiComparisons        AiComparison[]
}

model PolygonCheck {
  id             String   @id @default(cuid())
  checkSessionId String
  polygonId      String
  entityType     String
  apiEntityIds   String[]
  foundInDb      String[]
  notFoundInDb   String[]

  checkSession CheckSession @relation(fields: [checkSessionId], references: [id], onDelete: Cascade)
}

model EntityCheckSummary {
  id                String @id @default(cuid())
  checkSessionId    String
  entityType        String
  totalUniqueInApi  Int
  totalFoundInDb    Int
  totalNotFoundInDb Int

  checkSession CheckSession @relation(fields: [checkSessionId], references: [id], onDelete: Cascade)
}

model SessionDeltaCheck {
  id                        String @id @default(cuid())
  checkSessionId            String
  entityType                String
  currentScrapersSessionId  Int
  previousScrapersSessionId Int
  currentCount              Int
  previousCount             Int
  deltaPercent              Float
  deltaFlag                 String

  checkSession CheckSession @relation(fields: [checkSessionId], references: [id], onDelete: Cascade)
}

model AiComparison {
  id             String @id @default(cuid())
  checkSessionId String
  entityType     String
  entityId       String
  apiSnapshot    Json
  dbSnapshot     Json
  verdict        String
  explanation    String

  checkSession CheckSession @relation(fields: [checkSessionId], references: [id], onDelete: Cascade)
}

model AlertThreshold {
  id                   String @id @default(cuid())
  appId                String
  entityType           String
  warningThresholdPct  Float  @default(20)
  criticalThresholdPct Float  @default(50)

  scraper Scraper @relation(fields: [appId], references: [appId], onDelete: Cascade)

  @@unique([appId, entityType])
}

model AutoCheckConfig {
  id              String   @id @default(cuid())
  appId           String   @unique
  environment     String
  entityTypes     String[]
  polygonStrategy String
  aiSampleSize    Int      @default(5)
  checksEnabled   String[]
  isActive        Boolean  @default(false)

  scraper Scraper @relation(fields: [appId], references: [appId], onDelete: Cascade)
}
```

- [ ] **Крок 3: Запустити міграцію**

```bash
pnpm prisma migrate dev --name init
```

Очікуваний результат: `prisma/migrations/*/migration.sql` створено, таблиці в БД.

- [ ] **Крок 4: Перевірити схему через Prisma Studio**

```bash
pnpm prisma studio
```

Відкрити `http://localhost:5555`, переконатись що всі таблиці є.

- [ ] **Крок 5: Створити `src/lib/quality-db.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['query'] : [] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Крок 6: Commit**

```bash
git add prisma/ src/lib/quality-db.ts
git commit -m "feat: quality_db schema and Prisma client"
```

---

## Task 3: External DB Client (scrapers_db)

**Files:**
- Create: `src/lib/scrapers-db.ts`

**Produces:**
- `scrapersDb` — функція для виконання SQL-запитів до зовнішньої БД
- `countEntitiesForSession(appId, sessionId, entityType)` → `number` (прототип, може змінитись)
- `findEntitiesById(ids: string[], entityType)` → `ScraperEntity[]`

**⚠️ Примітка:** конкретні запити в цьому модулі — прототип. Реальна схема `scrapers_db` має бути підтверджена з командою розробників скраперів перед Task 9 (Delta Check).

- [ ] **Крок 1: Написати failing тест**

Створити `tests/lib/scrapers-db.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'

describe('countEntitiesForSession', () => {
  it('returns a number', async () => {
    // Ця функція буде мокована в реальних тестах;
    // тут перевіряємо що вона взагалі існує та повертає number
    const { countEntitiesForSession } = await import('@/lib/scrapers-db')
    // мокуємо pg pool
    expect(typeof countEntitiesForSession).toBe('function')
  })
})
```

- [ ] **Крок 2: Запустити тест, переконатись що падає**

```bash
pnpm test tests/lib/scrapers-db.test.ts
```

Очікуваний результат: FAIL (модуль не існує).

- [ ] **Крок 3: Реалізувати `src/lib/scrapers-db.ts`**

```typescript
import { Pool } from 'pg'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.SCRAPERS_DATABASE_URL })
  }
  return pool
}

export async function scrapersQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

// ⚠️ ПРОТОТИП: реальні назви таблиць/колонок уточнюються з командою скраперів
export async function countEntitiesForSession(
  appId: string,
  sessionId: number,
  entityType: string,
): Promise<number> {
  const rows = await scrapersQuery<{ count: string }>(
    `SELECT COUNT(*) as count FROM entities
     WHERE app_id = $1 AND session_id = $2 AND entity_type = $3`,
    [appId, sessionId, entityType],
  )
  return parseInt(rows[0]?.count ?? '0', 10)
}

// ⚠️ ПРОТОТИП: реальна структура entity та назви таблиць — уточнити
export async function findEntityById(
  entityId: string,
  entityType: string,
): Promise<Record<string, unknown> | null> {
  const rows = await scrapersQuery<Record<string, unknown>>(
    `SELECT * FROM entities WHERE id = $1 AND entity_type = $2 LIMIT 1`,
    [entityId, entityType],
  )
  return rows[0] ?? null
}

export async function findEntitiesByIds(
  entityIds: string[],
  entityType: string,
): Promise<Map<string, Record<string, unknown>>> {
  if (entityIds.length === 0) return new Map()
  const placeholders = entityIds.map((_, i) => `$${i + 2}`).join(', ')
  const rows = await scrapersQuery<Record<string, unknown> & { id: string }>(
    `SELECT * FROM entities WHERE entity_type = $1 AND id IN (${placeholders})`,
    [entityType, ...entityIds],
  )
  return new Map(rows.map((r) => [r.id, r]))
}
```

- [ ] **Крок 4: Запустити тест, переконатись що проходить**

```bash
pnpm test tests/lib/scrapers-db.test.ts
```

- [ ] **Крок 5: Commit**

```bash
git add src/lib/scrapers-db.ts tests/lib/scrapers-db.test.ts
git commit -m "feat: scrapers_db client (prototype queries)"
```

---

## Task 4: Design System & Visual Spec

> **REQUIRED SKILL:** Перед виконанням цього таску запусти скіл `frontend-design` — він веде процес розробки дизайну: вибір компонентів, кольорової схеми, layout-рішень, інтерактивних mockups. Результат скілу є вхідними даними для всіх наступних UI-тасків (5–16). Не переходь до Task 5 поки дизайн-рішення не затверджені.

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/components/ui/` (shadcn компоненти)

**Produces:** компонентна бібліотека готова до використання в усіх наступних тасках.

**Visual Spec (для реалізації в Tasks 5–16; може бути уточнена після frontend-design скілу):**

```
SIDEBAR (ширина 240px):
  [logo] Data Quality
  ─────────────────
  📊 Dashboard
  ▶  Run Check
  ⚙  Config
  ─────────────────
  [Sync Scrapers btn]

DASHBOARD PAGE:
  Scraper list (таблиця):
  | Name | Last session | API→DB | Delta | Date    |
  | Lime | #1234        | ✓ ok   | ✓ ok  | 2h ago  |
  | Bird | #1235        | ✗ warn | —     | 1d ago  |

  Для кожного скрапера — три charти в ряд:
  [Total ──────────] [Completeness ────] [Quality ─────────]
  [line chart, 4   ] [line chart, 4    ] [grouped bar per  ]
  [toggleable lines] [toggleable lines ] [session: S/SS/D  ]

  Date filter: [Last 7 days ▾]

SESSION RESULTS PAGE (/sessions/[id]):
  Header: Lime • staging • session #1234 • completed • 25 Jun 2026
  Tabs: [Dockless] [Docked] [Pricings] [Zones]
  ┌─────────────────────────────────────────┐
  │ API→DB: 1000 in API | 980 found | 20 ✗ │
  │ Delta:  1000 now | 1100 prev | -9.1% ✓ │
  │ AI: 5 compared → 4 Same, 1 SomewhatSame │
  └─────────────────────────────────────────┘
  [Відсутні в БД: list of IDs]
  [AI оцінки: expandable rows]
  [Manual review: entity picker → side-by-side JSON]
```

- [ ] **Крок 1: Встановити та ініціалізувати Shadcn/UI**

```bash
pnpm dlx shadcn@latest init
```

Обрати:
- Style: `New York`
- Base color: `Zinc`
- CSS variables: `Yes`

- [ ] **Крок 2: Встановити необхідні Shadcn компоненти**

```bash
pnpm dlx shadcn@latest add button card table tabs badge select checkbox input label tooltip
```

- [ ] **Крок 3: Встановити Recharts**

```bash
pnpm add recharts
```

- [ ] **Крок 4: Встановити lucide-react (іконки)**

```bash
pnpm add lucide-react
```

- [ ] **Крок 5: Перевірити що Shadcn компоненти доступні**

```bash
ls src/components/ui/
# має бути: button.tsx, card.tsx, table.tsx, tabs.tsx, badge.tsx, select.tsx, ...
```

- [ ] **Крок 6: Commit**

```bash
git add src/components/ui/ src/app/globals.css components.json
git commit -m "feat: design system — Shadcn/UI new-york zinc theme"
```

---

## Task 5: App Shell & Navigation

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/components/layout/Sidebar.tsx`
- Create: `src/components/layout/AppShell.tsx`

**Produces:** `AppShell` — wrapper з sidebar навігацією для всіх сторінок.

- [ ] **Крок 1: Створити `src/components/layout/Sidebar.tsx`**

```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Play, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sessions/new', label: 'Run Check', icon: Play },
  { href: '/config', label: 'Config', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-background px-3 py-4">
      <div className="mb-6 px-2 text-lg font-semibold">Data Quality</div>
      <nav className="flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}>
            <Button
              variant={pathname === href ? 'secondary' : 'ghost'}
              className={cn('w-full justify-start gap-2')}
            >
              <Icon size={16} />
              {label}
            </Button>
          </Link>
        ))}
      </nav>
    </aside>
  )
}
```

- [ ] **Крок 2: Створити `src/components/layout/AppShell.tsx`**

```tsx
import { Sidebar } from './Sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Крок 3: Оновити `src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AppShell } from '@/components/layout/AppShell'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Data Quality Tool',
  description: 'Internal scraper data quality verification',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
```

- [ ] **Крок 4: Запустити dev-сервер і перевірити навігацію**

```bash
pnpm dev
```

Відкрити `http://localhost:3000` — має відображатись sidebar з трьома пунктами.
Переконатись що навігація між `/`, `/sessions/new`, `/config` працює без помилок.

- [ ] **Крок 5: Commit**

```bash
git add src/app/layout.tsx src/components/layout/
git commit -m "feat: app shell and sidebar navigation"
```

---

## Task 6: Shared Types

**Files:**
- Create: `src/types/index.ts`

**Produces:** Всі shared TypeScript типи для використання в check engine та UI.

- [ ] **Крок 1: Створити `src/types/index.ts`**

```typescript
export type EntityType = 'dockless' | 'docked' | 'pricings' | 'zones'
export type CheckType = 'api_db' | 'delta'
export type Environment = 'staging' | 'production'
export type DeltaFlag = 'ok' | 'warning' | 'critical'
export type AiVerdict = 'Same' | 'SomewhatSame' | 'Different'
export type PolygonStrategy = 'random' | 'by_id' | 'by_city_all' | 'by_city_random'
export type CheckStatus = 'running' | 'completed' | 'failed'

export const ENTITY_TYPES: EntityType[] = ['dockless', 'docked', 'pricings', 'zones']
export const CHECK_TYPES: CheckType[] = ['api_db', 'delta']

export interface ScraperEntity {
  id: string
  [key: string]: unknown
}

export interface ApiDbCheckResult {
  entityType: EntityType
  totalUniqueInApi: number
  totalFoundInDb: number
  totalNotFoundInDb: number
  notFoundIds: string[]
  polygonResults: PolygonCheckResult[]
}

export interface PolygonCheckResult {
  polygonId: string
  entityType: EntityType
  apiEntityIds: string[]
  foundInDb: string[]
  notFoundInDb: string[]
}

export interface DeltaCheckResult {
  entityType: EntityType
  currentCount: number
  previousCount: number
  deltaPercent: number
  deltaFlag: DeltaFlag
}

export interface AiComparisonResult {
  entityId: string
  entityType: EntityType
  apiSnapshot: Record<string, unknown>
  dbSnapshot: Record<string, unknown>
  verdict: AiVerdict
  explanation: string
}

export interface CheckSessionInput {
  environment: Environment
  appId: string
  scrapersSessionId: number
  polygonIds: string[]
  entityTypes: EntityType[]
  checksEnabled: CheckType[]
  aiSampleSize: number
  previousScrapersSessionId?: number
}
```

- [ ] **Крок 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: shared TypeScript types"
```

---

## Task 7: Scraper Registry & Sync

**Files:**
- Create: `src/app/api/scrapers/route.ts`
- Create: `src/app/api/scrapers/sync/route.ts`
- Create: `src/components/dashboard/ScraperTable.tsx` (заглушка — розширюється в Task 15)

**⚠️ Примітка:** `scrapersQuery` для отримання списку скраперів — прототип. Реальний запит залежить від схеми `scrapers_db`. Після узгодження схеми — оновити `syncScrapers`.

- [ ] **Крок 1: Реалізувати GET /api/scrapers**

Створити `src/app/api/scrapers/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  const scrapers = await prisma.scraper.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(scrapers)
}
```

- [ ] **Крок 2: Реалізувати POST /api/scrapers/sync**

Створити `src/app/api/scrapers/sync/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'
import { scrapersQuery } from '@/lib/scrapers-db'
import type { EntityType } from '@/types'

// ⚠️ ПРОТОТИП: запит залежить від реальної схеми scrapers_db
interface ScraperRow {
  app_id: string
  name: string
  supported_entity_types: EntityType[]
}

export async function POST() {
  try {
    const rows = await scrapersQuery<ScraperRow>(
      `SELECT DISTINCT app_id, name, supported_entity_types FROM scrapers WHERE is_active = true`,
    )

    await Promise.all(
      rows.map((row) =>
        prisma.scraper.upsert({
          where: { appId: row.app_id },
          update: {
            name: row.name,
            supportedEntityTypes: row.supported_entity_types,
            lastSyncedAt: new Date(),
          },
          create: {
            appId: row.app_id,
            name: row.name,
            supportedEntityTypes: row.supported_entity_types,
            lastSyncedAt: new Date(),
          },
        }),
      ),
    )

    return NextResponse.json({ synced: rows.length })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
```

- [ ] **Крок 3: Перевірити ендпоінти вручну (якщо scrapers_db недоступна — синк поверне помилку, це нормально)**

```bash
curl http://localhost:3000/api/scrapers
# очікуємо: []  (порожній список — scraper ще не синкнуто)

curl -X POST http://localhost:3000/api/scrapers/sync
# якщо scrapers_db не налаштована: {"error":"..."}
# якщо налаштована: {"synced": N}
```

- [ ] **Крок 4: Commit**

```bash
git add src/app/api/scrapers/
git commit -m "feat: scraper registry API with sync endpoint"
```

---

## Task 8: AI Evaluation Engine

**Files:**
- Create: `src/lib/ai/client.ts`
- Create: `src/lib/ai/compare.ts`
- Create: `tests/lib/ai/compare.test.ts`

**Produces:**
- `compareEntities(api: Record<string, unknown>, db: Record<string, unknown>, entityType: EntityType)` → `{ verdict: AiVerdict, explanation: string }`

- [ ] **Крок 1: Написати failing тести**

Створити `tests/lib/ai/compare.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import type { AiVerdict } from '@/types'

vi.mock('@/lib/ai/client', () => ({
  aiClient: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: JSON.stringify({ verdict: 'Same', explanation: 'Objects match' })
            }
          }]
        })
      }
    }
  }
}))

describe('compareEntities', () => {
  it('returns Same verdict when objects match', async () => {
    const { compareEntities } = await import('@/lib/ai/compare')
    const api = { id: '123', name: 'Scooter A', lat: 50.1, lng: 30.2 }
    const db = { id: '123', name: 'Scooter A', lat: 50.11, lng: 30.21 }
    const result = await compareEntities(api, db, 'dockless')
    expect(result.verdict).toBe<AiVerdict>('Same')
    expect(typeof result.explanation).toBe('string')
  })

  it('parses JSON with verdict field', async () => {
    const { parseAiResponse } = await import('@/lib/ai/compare')
    const raw = '{"verdict":"Different","explanation":"Name mismatch"}'
    const result = parseAiResponse(raw)
    expect(result.verdict).toBe('Different')
    expect(result.explanation).toBe('Name mismatch')
  })

  it('handles malformed AI response gracefully', async () => {
    const { parseAiResponse } = await import('@/lib/ai/compare')
    const result = parseAiResponse('not valid json')
    expect(result.verdict).toBe('Different')
    expect(result.explanation).toContain('parse')
  })
})
```

- [ ] **Крок 2: Запустити тести — переконатись що падають**

```bash
pnpm test tests/lib/ai/compare.test.ts
```

- [ ] **Крок 3: Реалізувати `src/lib/ai/client.ts`**

```typescript
import OpenAI from 'openai'

export const aiClient = new OpenAI({
  baseURL: process.env.AI_BASE_URL,
  apiKey: process.env.AI_AUTH_TOKEN,
})
```

- [ ] **Крок 4: Реалізувати `src/lib/ai/compare.ts`**

```typescript
import { aiClient } from './client'
import type { EntityType, AiVerdict } from '@/types'

const PROMPT = `You are comparing two objects of the same entity type from a mobility scraper system.
One is from the live API, one is from the database snapshot.

Entity type: {entityType}

Dynamic fields (minor changes are NORMAL and expected):
- GPS coordinates: small movement within a city is OK. Different country/continent = anomaly.
- Battery level, availability status: always changing, ignore differences.
- Timestamps: ignore.

Static fields (should match):
- IDs, names, pricing details, zone boundaries, model/brand info.

API object:
{apiObject}

DB object:
{dbObject}

Respond ONLY with valid JSON in this exact format:
{"verdict": "Same|SomewhatSame|Different", "explanation": "one sentence reason"}`

export function parseAiResponse(raw: string): { verdict: AiVerdict; explanation: string } {
  try {
    const parsed = JSON.parse(raw) as { verdict: AiVerdict; explanation: string }
    if (!['Same', 'SomewhatSame', 'Different'].includes(parsed.verdict)) {
      return { verdict: 'Different', explanation: 'Unexpected verdict value from AI' }
    }
    return parsed
  } catch {
    return { verdict: 'Different', explanation: `Failed to parse AI response: ${raw.slice(0, 100)}` }
  }
}

export async function compareEntities(
  api: Record<string, unknown>,
  db: Record<string, unknown>,
  entityType: EntityType,
): Promise<{ verdict: AiVerdict; explanation: string }> {
  const prompt = PROMPT
    .replace('{entityType}', entityType)
    .replace('{apiObject}', JSON.stringify(api, null, 2))
    .replace('{dbObject}', JSON.stringify(db, null, 2))

  const response = await aiClient.chat.completions.create({
    model: process.env.AI_MODEL ?? 'minimax/MiniMax-M3',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  })

  const content = response.choices[0]?.message?.content ?? ''
  return parseAiResponse(content)
}
```

- [ ] **Крок 5: Запустити тести — переконатись що проходять**

```bash
pnpm test tests/lib/ai/compare.test.ts
```

- [ ] **Крок 6: Commit**

```bash
git add src/lib/ai/ tests/lib/ai/
git commit -m "feat: AI evaluation engine with MiniMax-M3"
```

---

## Task 9: Scraper API Adapter Interface

**Files:**
- Create: `src/lib/checks/adapters/scraper-adapter.ts`
- Create: `src/lib/checks/adapters/mock-adapter.ts`

**Produces:**
- `ScraperApiAdapter` interface
- `MockScraperApiAdapter` — для тестів

**⚠️ Примітка:** Реальні адаптери (LimeAdapter, BirdAdapter, тощо) реалізуються ОКРЕМО для кожного скрапера після отримання документації API. Кожен адаптер — окремий файл `src/lib/checks/adapters/{appId}-adapter.ts`. Цей таск визначає контракт.

- [ ] **Крок 1: Створити `src/lib/checks/adapters/scraper-adapter.ts`**

```typescript
import type { EntityType, ScraperEntity } from '@/types'

export interface PolygonBounds {
  polygonId: string
  // Конкретний формат (GeoJSON, bbox, тощо) — уточнити з командою скраперів
  geometry: unknown
}

export interface ScraperApiAdapter {
  appId: string
  fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]>
}

export type AdapterRegistry = Map<string, ScraperApiAdapter>

// Глобальний реєстр адаптерів — заповнюється при реалізації кожного скрапера
export const adapterRegistry: AdapterRegistry = new Map()
```

- [ ] **Крок 2: Створити `src/lib/checks/adapters/mock-adapter.ts`**

```typescript
import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'

export class MockScraperApiAdapter implements ScraperApiAdapter {
  appId: string
  private entities: ScraperEntity[]

  constructor(appId: string, entities: ScraperEntity[] = []) {
    this.appId = appId
    this.entities = entities
  }

  async fetchEntities(_polygon: PolygonBounds, _entityType: EntityType): Promise<ScraperEntity[]> {
    return this.entities
  }
}
```

- [ ] **Крок 3: Commit**

```bash
git add src/lib/checks/adapters/
git commit -m "feat: scraper API adapter interface and mock"
```

---

## Task 10: API→DB Check Engine

**Files:**
- Create: `src/lib/checks/api-db-check.ts`
- Create: `tests/lib/checks/api-db-check.test.ts`

**Produces:**
- `runApiDbCheck(sessionInput, adapter, entityType)` → `ApiDbCheckResult`

- [ ] **Крок 1: Написати failing тести**

Створити `tests/lib/checks/api-db-check.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { MockScraperApiAdapter } from '@/lib/checks/adapters/mock-adapter'
import type { CheckSessionInput } from '@/types'

vi.mock('@/lib/scrapers-db', () => ({
  findEntitiesByIds: vi.fn().mockImplementation(async (ids: string[]) => {
    // симулюємо що id-1 та id-2 є в БД, id-3 — немає
    const map = new Map()
    if (ids.includes('id-1')) map.set('id-1', { id: 'id-1', name: 'A' })
    if (ids.includes('id-2')) map.set('id-2', { id: 'id-2', name: 'B' })
    return map
  }),
}))

const baseInput: CheckSessionInput = {
  environment: 'staging',
  appId: 'mock',
  scrapersSessionId: 1,
  polygonIds: ['poly-1'],
  entityTypes: ['dockless'],
  checksEnabled: ['api_db'],
  aiSampleSize: 5,
}

describe('runApiDbCheck', () => {
  it('counts found and not found entities correctly', async () => {
    const { runApiDbCheck } = await import('@/lib/checks/api-db-check')
    const adapter = new MockScraperApiAdapter('mock', [
      { id: 'id-1' }, { id: 'id-2' }, { id: 'id-3' }
    ])
    const result = await runApiDbCheck(baseInput, adapter, 'dockless')
    expect(result.totalUniqueInApi).toBe(3)
    expect(result.totalFoundInDb).toBe(2)
    expect(result.totalNotFoundInDb).toBe(1)
    expect(result.notFoundIds).toEqual(['id-3'])
  })

  it('deduplicates entities across multiple polygons', async () => {
    const { runApiDbCheck } = await import('@/lib/checks/api-db-check')
    const input = { ...baseInput, polygonIds: ['poly-1', 'poly-2'] }
    // обидва полігони повертають однаковий id-1
    const adapter = new MockScraperApiAdapter('mock', [{ id: 'id-1' }])
    const result = await runApiDbCheck(input, adapter, 'dockless')
    expect(result.totalUniqueInApi).toBe(1) // дедупліковано
  })
})
```

- [ ] **Крок 2: Запустити тести — переконатись що падають**

```bash
pnpm test tests/lib/checks/api-db-check.test.ts
```

- [ ] **Крок 3: Реалізувати `src/lib/checks/api-db-check.ts`**

```typescript
import { findEntitiesByIds } from '@/lib/scrapers-db'
import type { ScraperApiAdapter, PolygonBounds } from './adapters/scraper-adapter'
import type { CheckSessionInput, EntityType, ApiDbCheckResult, PolygonCheckResult } from '@/types'

// ⚠️ ПРОТОТИП: fetchPolygonBounds потребує реального запиту до scrapers_db
async function fetchPolygonBounds(polygonId: string): Promise<PolygonBounds> {
  return { polygonId, geometry: null }
}

export async function runApiDbCheck(
  input: CheckSessionInput,
  adapter: ScraperApiAdapter,
  entityType: EntityType,
): Promise<ApiDbCheckResult> {
  const polygonResults: PolygonCheckResult[] = []
  const allApiIds = new Set<string>()

  for (const polygonId of input.polygonIds) {
    const bounds = await fetchPolygonBounds(polygonId)
    const entities = await adapter.fetchEntities(bounds, entityType)
    const apiEntityIds = entities.map((e) => e.id)
    apiEntityIds.forEach((id) => allApiIds.add(id))

    const foundMap = await findEntitiesByIds(apiEntityIds, entityType)
    const foundInDb = apiEntityIds.filter((id) => foundMap.has(id))
    const notFoundInDb = apiEntityIds.filter((id) => !foundMap.has(id))

    polygonResults.push({ polygonId, entityType, apiEntityIds, foundInDb, notFoundInDb })
  }

  const uniqueIds = Array.from(allApiIds)
  const foundMap = await findEntitiesByIds(uniqueIds, entityType)
  const notFoundIds = uniqueIds.filter((id) => !foundMap.has(id))

  return {
    entityType,
    totalUniqueInApi: uniqueIds.length,
    totalFoundInDb: foundMap.size,
    totalNotFoundInDb: notFoundIds.length,
    notFoundIds,
    polygonResults,
  }
}
```

- [ ] **Крок 4: Запустити тести**

```bash
pnpm test tests/lib/checks/api-db-check.test.ts
```

Очікуваний результат: обидва тести PASS.

- [ ] **Крок 5: Commit**

```bash
git add src/lib/checks/api-db-check.ts tests/lib/checks/api-db-check.test.ts
git commit -m "feat: API→DB check engine with deduplication"
```

---

## Task 11: Delta Check Engine

**Files:**
- Create: `src/lib/checks/delta-check.ts`
- Create: `tests/lib/checks/delta-check.test.ts`

**Produces:**
- `runDeltaCheck(appId, currentSessionId, previousSessionId, entityType, thresholds?)` → `DeltaCheckResult`
- `calculateDeltaFlag(deltaPercent, thresholds)` → `DeltaFlag`

- [ ] **Крок 1: Написати failing тести**

Створити `tests/lib/checks/delta-check.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/scrapers-db', () => ({
  countEntitiesForSession: vi.fn()
    .mockResolvedValueOnce(100)   // currentCount
    .mockResolvedValueOnce(1000), // previousCount
}))

describe('calculateDeltaFlag', () => {
  it('returns ok when change is within warning threshold', async () => {
    const { calculateDeltaFlag } = await import('@/lib/checks/delta-check')
    expect(calculateDeltaFlag(5)).toBe('ok')
  })

  it('returns warning when change exceeds 20%', async () => {
    const { calculateDeltaFlag } = await import('@/lib/checks/delta-check')
    expect(calculateDeltaFlag(25)).toBe('warning')
  })

  it('returns critical when change exceeds 50%', async () => {
    const { calculateDeltaFlag } = await import('@/lib/checks/delta-check')
    expect(calculateDeltaFlag(75)).toBe('critical')
  })

  it('uses custom thresholds when provided', async () => {
    const { calculateDeltaFlag } = await import('@/lib/checks/delta-check')
    expect(calculateDeltaFlag(15, { warning: 10, critical: 30 })).toBe('warning')
  })
})

describe('runDeltaCheck', () => {
  it('calculates deltaPercent correctly', async () => {
    const { runDeltaCheck } = await import('@/lib/checks/delta-check')
    const result = await runDeltaCheck('lime', 2, 1, 'dockless')
    // 100 now, 1000 before → -90%
    expect(result.deltaPercent).toBeCloseTo(-90)
    expect(result.deltaFlag).toBe('critical')
    expect(result.currentCount).toBe(100)
    expect(result.previousCount).toBe(1000)
  })
})
```

- [ ] **Крок 2: Запустити тести — переконатись що падають**

```bash
pnpm test tests/lib/checks/delta-check.test.ts
```

- [ ] **Крок 3: Реалізувати `src/lib/checks/delta-check.ts`**

```typescript
import { countEntitiesForSession } from '@/lib/scrapers-db'
import type { EntityType, DeltaCheckResult, DeltaFlag } from '@/types'

interface Thresholds {
  warning: number
  critical: number
}

const DEFAULT_THRESHOLDS: Thresholds = { warning: 20, critical: 50 }

export function calculateDeltaFlag(
  deltaPercent: number,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): DeltaFlag {
  const abs = Math.abs(deltaPercent)
  if (abs >= thresholds.critical) return 'critical'
  if (abs >= thresholds.warning) return 'warning'
  return 'ok'
}

export async function runDeltaCheck(
  appId: string,
  currentSessionId: number,
  previousSessionId: number,
  entityType: EntityType,
  thresholds?: Thresholds,
): Promise<DeltaCheckResult> {
  const [currentCount, previousCount] = await Promise.all([
    countEntitiesForSession(appId, currentSessionId, entityType),
    countEntitiesForSession(appId, previousSessionId, entityType),
  ])

  const deltaPercent =
    previousCount === 0 ? 0 : ((currentCount - previousCount) / previousCount) * 100

  return {
    entityType,
    currentCount,
    previousCount,
    deltaPercent,
    deltaFlag: calculateDeltaFlag(deltaPercent, thresholds),
  }
}
```

- [ ] **Крок 4: Запустити тести**

```bash
pnpm test tests/lib/checks/delta-check.test.ts
```

Очікуваний результат: всі тести PASS.

- [ ] **Крок 5: Commit**

```bash
git add src/lib/checks/delta-check.ts tests/lib/checks/delta-check.test.ts
git commit -m "feat: delta check engine with configurable thresholds"
```

---

## Task 12: Check Orchestration API

**Files:**
- Create: `src/lib/checks/orchestrator.ts`
- Create: `src/app/api/checks/route.ts`
- Create: `src/app/api/sessions/route.ts`
- Create: `src/app/api/sessions/[id]/route.ts`

**Produces:**
- `POST /api/checks` — запускає сесію перевірки, повертає `{ sessionId }`
- `GET /api/sessions` — список сесій
- `GET /api/sessions/[id]` — деталі сесії з усіма результатами

- [ ] **Крок 1: Реалізувати `src/lib/checks/orchestrator.ts`**

```typescript
import { prisma } from '@/lib/quality-db'
import { runApiDbCheck } from './api-db-check'
import { runDeltaCheck } from './delta-check'
import { compareEntities } from '@/lib/ai/compare'
import { adapterRegistry } from './adapters/scraper-adapter'
import type { CheckSessionInput, EntityType } from '@/types'

function sampleRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

export async function runCheckSession(input: CheckSessionInput): Promise<string> {
  const session = await prisma.checkSession.create({
    data: {
      environment: input.environment,
      appId: input.appId,
      scrapersSessionId: input.scrapersSessionId,
      polygonIds: input.polygonIds,
      entityTypes: input.entityTypes,
      checksEnabled: input.checksEnabled,
      aiSampleSize: input.aiSampleSize,
      status: 'running',
      triggeredBy: 'manual',
    },
  })

  try {
    for (const entityType of input.entityTypes as EntityType[]) {
      if (input.checksEnabled.includes('api_db')) {
        const adapter = adapterRegistry.get(input.appId)
        if (!adapter) throw new Error(`No adapter registered for appId: ${input.appId}`)

        const result = await runApiDbCheck(input, adapter, entityType)

        await prisma.entityCheckSummary.create({
          data: {
            checkSessionId: session.id,
            entityType,
            totalUniqueInApi: result.totalUniqueInApi,
            totalFoundInDb: result.totalFoundInDb,
            totalNotFoundInDb: result.totalNotFoundInDb,
          },
        })

        for (const pr of result.polygonResults) {
          await prisma.polygonCheck.create({
            data: {
              checkSessionId: session.id,
              polygonId: pr.polygonId,
              entityType,
              apiEntityIds: pr.apiEntityIds,
              foundInDb: pr.foundInDb,
              notFoundInDb: pr.notFoundInDb,
            },
          })
        }

        // AI порівняння для випадкової вибірки
        const sampleIds = sampleRandom(result.polygonResults.flatMap((p) => p.foundInDb), input.aiSampleSize)
        for (const entityId of sampleIds) {
          const { findEntitiesByIds } = await import('@/lib/scrapers-db')
          const dbMap = await findEntitiesByIds([entityId], entityType)
          const dbSnapshot = dbMap.get(entityId)
          if (!dbSnapshot) continue

          // apiSnapshot береться з polygon results
          const apiSnapshot = result.polygonResults
            .flatMap((p) => p.apiEntityIds.includes(entityId) ? [{ id: entityId }] : [])
            .at(0) ?? { id: entityId }

          const comparison = await compareEntities(apiSnapshot, dbSnapshot, entityType)
          await prisma.aiComparison.create({
            data: {
              checkSessionId: session.id,
              entityType,
              entityId,
              apiSnapshot,
              dbSnapshot,
              verdict: comparison.verdict,
              explanation: comparison.explanation,
            },
          })
        }
      }

      if (input.checksEnabled.includes('delta') && input.previousScrapersSessionId) {
        const threshold = await prisma.alertThreshold.findUnique({
          where: { appId_entityType: { appId: input.appId, entityType } },
        })
        const result = await runDeltaCheck(
          input.appId,
          input.scrapersSessionId,
          input.previousScrapersSessionId,
          entityType,
          threshold ? { warning: threshold.warningThresholdPct, critical: threshold.criticalThresholdPct } : undefined,
        )
        await prisma.sessionDeltaCheck.create({
          data: {
            checkSessionId: session.id,
            entityType,
            currentScrapersSessionId: input.scrapersSessionId,
            previousScrapersSessionId: input.previousScrapersSessionId,
            currentCount: result.currentCount,
            previousCount: result.previousCount,
            deltaPercent: result.deltaPercent,
            deltaFlag: result.deltaFlag,
          },
        })
      }
    }

    await prisma.checkSession.update({
      where: { id: session.id },
      data: { status: 'completed' },
    })
  } catch (error) {
    await prisma.checkSession.update({
      where: { id: session.id },
      data: { status: 'failed' },
    })
    throw error
  }

  return session.id
}
```

- [ ] **Крок 2: Реалізувати `src/app/api/checks/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { runCheckSession } from '@/lib/checks/orchestrator'
import type { CheckSessionInput } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const input = (await req.json()) as CheckSessionInput
    const sessionId = await runCheckSession(input)
    return NextResponse.json({ sessionId })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
```

- [ ] **Крок 3: Реалізувати `src/app/api/sessions/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  const sessions = await prisma.checkSession.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      entityCheckSummaries: true,
      sessionDeltaChecks: true,
    },
  })
  return NextResponse.json(sessions)
}
```

- [ ] **Крок 4: Реалізувати `src/app/api/sessions/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await prisma.checkSession.findUnique({
    where: { id: params.id },
    include: {
      entityCheckSummaries: true,
      polygonChecks: true,
      sessionDeltaChecks: true,
      aiComparisons: true,
    },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(session)
}
```

- [ ] **Крок 5: Реалізувати `src/app/api/entities/[id]/route.ts`** (використовується в ManualReviewPanel)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { findEntitiesByIds } from '@/lib/scrapers-db'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const url = new URL(req.url)
  const entityType = url.searchParams.get('type') ?? 'dockless'
  const map = await findEntitiesByIds([params.id], entityType)
  const entity = map.get(params.id)
  if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(entity)
}
```

- [ ] **Крок 6: Commit**

```bash
git add src/lib/checks/orchestrator.ts src/app/api/checks/ src/app/api/sessions/ src/app/api/entities/
git commit -m "feat: check orchestrator, session API routes, entity lookup"
```

---

## Task 13: Check Session Form (`/sessions/new`)

**Files:**
- Create: `src/components/sessions/CheckForm.tsx`
- Create: `src/app/sessions/new/page.tsx`

- [ ] **Крок 1: Реалізувати `src/components/sessions/CheckForm.tsx`**

```tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { EntityType, CheckType, Environment, PolygonStrategy, CheckSessionInput } from '@/types'
import { ENTITY_TYPES } from '@/types'

interface ScraperOption { appId: string; name: string; supportedEntityTypes: string[] }

export function CheckForm() {
  const router = useRouter()
  const [scrapers, setScrapers] = useState<ScraperOption[]>([])
  const [loading, setLoading] = useState(false)

  const [environment, setEnvironment] = useState<Environment>('staging')
  const [appId, setAppId] = useState('')
  const [scrapersSessionId, setScrapersSessionId] = useState('')
  const [previousScrapersSessionId, setPreviousScrapersSessionId] = useState('')
  const [polygonStrategy, setPolygonStrategy] = useState<PolygonStrategy>('random')
  const [polygonId, setPolygonId] = useState('')
  const [polygonCity, setPolygonCity] = useState('')
  const [selectedEntityTypes, setSelectedEntityTypes] = useState<EntityType[]>([])
  const [checksEnabled, setChecksEnabled] = useState<CheckType[]>(['api_db', 'delta'])
  const [aiSampleSize, setAiSampleSize] = useState(5)

  useEffect(() => {
    fetch('/api/scrapers').then((r) => r.json()).then(setScrapers)
  }, [])

  const selectedScraper = scrapers.find((s) => s.appId === appId)

  function toggleEntityType(et: EntityType) {
    setSelectedEntityTypes((prev) =>
      prev.includes(et) ? prev.filter((x) => x !== et) : [...prev, et],
    )
  }

  function toggleCheckType(ct: CheckType) {
    setChecksEnabled((prev) =>
      prev.includes(ct) ? prev.filter((x) => x !== ct) : [...prev, ct],
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const polygonIds =
      polygonStrategy === 'by_id' ? [polygonId] :
      polygonStrategy === 'random' ? ['__random__'] :
      [`__city_${polygonStrategy}__:${polygonCity}`]

    const input: CheckSessionInput = {
      environment,
      appId,
      scrapersSessionId: parseInt(scrapersSessionId),
      polygonIds,
      entityTypes: selectedEntityTypes,
      checksEnabled,
      aiSampleSize,
      previousScrapersSessionId: previousScrapersSessionId ? parseInt(previousScrapersSessionId) : undefined,
    }
    const res = await fetch('/api/checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    const { sessionId } = await res.json() as { sessionId: string }
    router.push(`/sessions/${sessionId}`)
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      <Card>
        <CardHeader><CardTitle>Run Check</CardTitle></CardHeader>
        <CardContent className="space-y-4">

          <div className="space-y-1">
            <Label>Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as Environment)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Scraper</Label>
            <Select value={appId} onValueChange={(v) => { setAppId(v); setSelectedEntityTypes([]) }}>
              <SelectTrigger><SelectValue placeholder="Select scraper" /></SelectTrigger>
              <SelectContent>
                {scrapers.map((s) => <SelectItem key={s.appId} value={s.appId}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Scrapers Session ID</Label>
            <Input type="number" value={scrapersSessionId} onChange={(e) => setScrapersSessionId(e.target.value)} placeholder="e.g. 1234" required />
          </div>

          <div className="space-y-1">
            <Label>Check Types</Label>
            <div className="flex gap-4">
              {(['api_db', 'delta'] as CheckType[]).map((ct) => (
                <label key={ct} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={checksEnabled.includes(ct)} onCheckedChange={() => toggleCheckType(ct)} />
                  {ct === 'api_db' ? 'API→DB' : 'Delta'}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Polygon</Label>
            <Select value={polygonStrategy} onValueChange={(v) => setPolygonStrategy(v as PolygonStrategy)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="random">Random polygon</SelectItem>
                <SelectItem value="by_id">By polygon ID</SelectItem>
                <SelectItem value="by_city_all">By city — all polygons</SelectItem>
                <SelectItem value="by_city_random">By city — random polygon</SelectItem>
              </SelectContent>
            </Select>
            {polygonStrategy === 'by_id' && (
              <Input className="mt-2" placeholder="Polygon ID" value={polygonId} onChange={(e) => setPolygonId(e.target.value)} />
            )}
            {(polygonStrategy === 'by_city_all' || polygonStrategy === 'by_city_random') && (
              <Input className="mt-2" placeholder="City name" value={polygonCity} onChange={(e) => setPolygonCity(e.target.value)} />
            )}
          </div>

          <div className="space-y-1">
            <Label>Entity Types</Label>
            <div className="flex flex-wrap gap-3">
              {ENTITY_TYPES.map((et) => {
                const supported = selectedScraper?.supportedEntityTypes.includes(et) ?? false
                return (
                  <label key={et} className={`flex items-center gap-2 ${!supported || !appId ? 'opacity-40' : 'cursor-pointer'}`}>
                    <Checkbox
                      checked={selectedEntityTypes.includes(et)}
                      onCheckedChange={() => toggleEntityType(et)}
                      disabled={!supported || !appId}
                    />
                    {et}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label>AI Sample Size (max 20)</Label>
            <Input type="number" min={1} max={20} value={aiSampleSize} onChange={(e) => setAiSampleSize(Number(e.target.value))} />
          {aiSampleSize > 10 && (
            <p className="text-xs text-yellow-600">Large sample size may increase response time significantly for scrapers with heavy objects.</p>
          )}
          </div>

          {checksEnabled.includes('delta') && (
            <div className="space-y-1">
              <Label>Previous Session ID (for Delta)</Label>
              <Input type="number" value={previousScrapersSessionId} onChange={(e) => setPreviousScrapersSessionId(e.target.value)} placeholder="e.g. 1233" />
            </div>
          )}

          <Button type="submit" disabled={loading || !appId || selectedEntityTypes.length === 0} className="w-full">
            {loading ? 'Running...' : 'Run Check'}
          </Button>
        </CardContent>
      </Card>
    </form>
  )
}
```

- [ ] **Крок 2: Створити `src/app/sessions/new/page.tsx`**

```tsx
import { CheckForm } from '@/components/sessions/CheckForm'

export default function NewSessionPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">New Check</h1>
      <CheckForm />
    </div>
  )
}
```

- [ ] **Крок 3: Перевірити форму в браузері**

```bash
pnpm dev
```

Перейти на `http://localhost:3000/sessions/new`. Переконатись:
- Форма рендериться без помилок
- Dropdown скраперів порожній (ще не синкнуто — це нормально)
- Entity types disabled поки не обрано scraper
- Delta поле з'являється тільки якщо Delta увімкнено

- [ ] **Крок 4: Commit**

```bash
git add src/components/sessions/CheckForm.tsx src/app/sessions/new/
git commit -m "feat: check session form UI"
```

---

## Task 14: Session Results Page (`/sessions/[id]`)

**Files:**
- Create: `src/components/sessions/SessionResultsTabs.tsx`
- Create: `src/components/sessions/ApiDbResultsTab.tsx`
- Create: `src/components/sessions/DeltaResultsTab.tsx`
- Create: `src/components/sessions/AiResultsTab.tsx`
- Create: `src/components/sessions/ManualReviewPanel.tsx`
- Create: `src/app/sessions/[id]/page.tsx`

- [ ] **Крок 1: Реалізувати `src/components/sessions/ApiDbResultsTab.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { EntityCheckSummary, PolygonCheck } from '@prisma/client'

interface Props {
  summary: EntityCheckSummary
  polygonChecks: PolygonCheck[]
}

export function ApiDbResultsTab({ summary, polygonChecks }: Props) {
  const coverage = summary.totalUniqueInApi > 0
    ? ((summary.totalFoundInDb / summary.totalUniqueInApi) * 100).toFixed(1)
    : '0'
  const notFoundIds = polygonChecks.flatMap((p) => p.notFoundInDb)

  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-sm">
        <span className="text-muted-foreground">In API: <strong>{summary.totalUniqueInApi}</strong></span>
        <span className="text-green-600">Found in DB: <strong>{summary.totalFoundInDb}</strong></span>
        <span className="text-red-600">Missing: <strong>{summary.totalNotFoundInDb}</strong></span>
        <Badge variant={summary.totalNotFoundInDb === 0 ? 'default' : 'destructive'}>
          {coverage}% coverage
        </Badge>
      </div>
      {notFoundIds.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Missing entity IDs:</p>
          <div className="flex max-h-40 flex-wrap gap-1 overflow-auto">
            {notFoundIds.map((id) => (
              <Badge key={id} variant="outline" className="font-mono text-xs">{id}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Крок 2: Реалізувати `src/components/sessions/DeltaResultsTab.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { SessionDeltaCheck } from '@prisma/client'

const flagVariant = {
  ok: 'default',
  warning: 'secondary',
  critical: 'destructive',
} as const

const flagColor = {
  ok: 'text-green-600',
  warning: 'text-yellow-600',
  critical: 'text-red-600',
} as const

interface Props { deltaCheck: SessionDeltaCheck }

export function DeltaResultsTab({ deltaCheck }: Props) {
  const sign = deltaCheck.deltaPercent >= 0 ? '+' : ''
  return (
    <div className="flex items-center gap-6 text-sm">
      <span className="text-muted-foreground">Current: <strong>{deltaCheck.currentCount.toLocaleString()}</strong></span>
      <span className="text-muted-foreground">Previous: <strong>{deltaCheck.previousCount.toLocaleString()}</strong></span>
      <span className={flagColor[deltaCheck.deltaFlag as keyof typeof flagColor]}>
        Delta: <strong>{sign}{deltaCheck.deltaPercent.toFixed(1)}%</strong>
      </span>
      <Badge variant={flagVariant[deltaCheck.deltaFlag as keyof typeof flagVariant]}>
        {deltaCheck.deltaFlag}
      </Badge>
    </div>
  )
}
```

- [ ] **Крок 3: Реалізувати `src/components/sessions/AiResultsTab.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { AiComparison } from '@prisma/client'

const verdictVariant = {
  Same: 'default',
  SomewhatSame: 'secondary',
  Different: 'destructive',
} as const

interface Props { comparisons: AiComparison[] }

export function AiResultsTab({ comparisons }: Props) {
  if (comparisons.length === 0) {
    return <p className="text-sm text-muted-foreground">No AI comparisons for this entity type.</p>
  }
  return (
    <div className="space-y-2">
      {comparisons.map((c) => (
        <Card key={c.id}>
          <CardContent className="flex items-start gap-3 py-3">
            <Badge variant={verdictVariant[c.verdict as keyof typeof verdictVariant]}>{c.verdict}</Badge>
            <div>
              <p className="font-mono text-xs text-muted-foreground">{c.entityId}</p>
              <p className="text-sm">{c.explanation}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Крок 4: Реалізувати `src/components/sessions/ManualReviewPanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { PolygonCheck } from '@prisma/client'

interface Props { polygonChecks: PolygonCheck[] }

export function ManualReviewPanel({ polygonChecks }: Props) {
  const [entityId, setEntityId] = useState('')
  const [apiData, setApiData] = useState<unknown>(null)
  const [dbData, setDbData] = useState<unknown>(null)

  async function handleLookup() {
    const pc = polygonChecks.find((p) => p.apiEntityIds.includes(entityId))
    setApiData(pc ? { id: entityId, source: 'polygon', polygonId: pc.polygonId } : null)
    const res = await fetch(`/api/entities/${entityId}`)
    if (res.ok) setDbData(await res.json())
    else setDbData({ error: 'Not found in DB' })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Entity ID" value={entityId} onChange={(e) => setEntityId(e.target.value)} className="font-mono" />
        <Button variant="outline" onClick={handleLookup} disabled={!entityId}>Lookup</Button>
      </div>
      {(apiData || dbData) && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">API</p>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(apiData, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">DB</p>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(dbData, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Крок 5: Реалізувати `src/components/sessions/SessionResultsTabs.tsx`**

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { ApiDbResultsTab } from './ApiDbResultsTab'
import { DeltaResultsTab } from './DeltaResultsTab'
import { AiResultsTab } from './AiResultsTab'
import { ManualReviewPanel } from './ManualReviewPanel'
import type { CheckSession, EntityCheckSummary, PolygonCheck, SessionDeltaCheck, AiComparison } from '@prisma/client'

interface SessionWithResults extends CheckSession {
  entityCheckSummaries: EntityCheckSummary[]
  polygonChecks: PolygonCheck[]
  sessionDeltaChecks: SessionDeltaCheck[]
  aiComparisons: AiComparison[]
}

interface Props { session: SessionWithResults }

export function SessionResultsTabs({ session }: Props) {
  return (
    <Tabs defaultValue={session.entityTypes[0] ?? 'dockless'}>
      <TabsList>
        {session.entityTypes.map((et) => (
          <TabsTrigger key={et} value={et}>{et}</TabsTrigger>
        ))}
      </TabsList>
      {session.entityTypes.map((et) => {
        const summary = session.entityCheckSummaries.find((s) => s.entityType === et)
        const delta = session.sessionDeltaChecks.find((d) => d.entityType === et)
        const aiComparisons = session.aiComparisons.filter((a) => a.entityType === et)
        const polygonChecks = session.polygonChecks.filter((p) => p.entityType === et)
        return (
          <TabsContent key={et} value={et} className="space-y-6 pt-4">
            {summary && session.checksEnabled.includes('api_db') && (
              <section>
                <h3 className="mb-2 font-semibold">API → DB</h3>
                <ApiDbResultsTab summary={summary} polygonChecks={polygonChecks} />
              </section>
            )}
            {delta && session.checksEnabled.includes('delta') && (
              <section>
                <h3 className="mb-2 font-semibold">Delta</h3>
                <DeltaResultsTab deltaCheck={delta} />
              </section>
            )}
            {session.checksEnabled.includes('api_db') && (
              <section>
                <h3 className="mb-2 font-semibold">AI Comparisons <Badge variant="outline">{aiComparisons.length}</Badge></h3>
                <AiResultsTab comparisons={aiComparisons} />
              </section>
            )}
            <section>
              <h3 className="mb-2 font-semibold">Manual Review</h3>
              <ManualReviewPanel polygonChecks={polygonChecks} />
            </section>
          </TabsContent>
        )
      })}
    </Tabs>
  )
}
```

- [ ] **Крок 6: Створити `src/app/sessions/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/quality-db'
import { SessionResultsTabs } from '@/components/sessions/SessionResultsTabs'
import { Badge } from '@/components/ui/badge'

const statusVariant = { running: 'secondary', completed: 'default', failed: 'destructive' } as const

export default async function SessionPage({ params }: { params: { id: string } }) {
  const session = await prisma.checkSession.findUnique({
    where: { id: params.id },
    include: {
      entityCheckSummaries: true,
      polygonChecks: true,
      sessionDeltaChecks: true,
      aiComparisons: true,
    },
  })
  if (!session) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{session.appId}</h1>
        <Badge variant="outline">{session.environment}</Badge>
        <Badge variant="outline">session #{session.scrapersSessionId}</Badge>
        <Badge variant={statusVariant[session.status as keyof typeof statusVariant]}>{session.status}</Badge>
        <span className="text-sm text-muted-foreground">{new Date(session.createdAt).toLocaleString()}</span>
      </div>
      <SessionResultsTabs session={session} />
    </div>
  )
}
```

- [ ] **Крок 7: Перевірити в браузері** (якщо є тестова сесія — відкрити її сторінку і перевірити tabs)

- [ ] **Крок 8: Commit**

```bash
git add src/components/sessions/ src/app/sessions/
git commit -m "feat: session results page with tabs for each entity type"
```

---

## Task 15: Dashboard Charts

**Files:**
- Create: `src/components/dashboard/TotalChart.tsx`
- Create: `src/components/dashboard/CompletenessChart.tsx`
- Create: `src/components/dashboard/QualityChart.tsx`
- Create: `src/components/dashboard/ScraperChartRow.tsx`

**Produces:** три charти для одного скрапера, готові до вставки в Dashboard.

- [ ] **Крок 1: Реалізувати `src/components/dashboard/TotalChart.tsx`**

```tsx
'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useState } from 'react'
import type { SessionDeltaCheck } from '@prisma/client'

const ENTITY_COLORS = { dockless: '#3b82f6', docked: '#10b981', pricings: '#f59e0b', zones: '#8b5cf6' }

interface DataPoint {
  date: string
  dockless?: number
  docked?: number
  pricings?: number
  zones?: number
}

interface Props { deltaChecks: SessionDeltaCheck[]; dates: string[] }

export function TotalChart({ deltaChecks, dates }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const data: DataPoint[] = dates.map((date) => {
    const entry: DataPoint = { date }
    for (const et of ['dockless', 'docked', 'pricings', 'zones'] as const) {
      const check = deltaChecks.find((d) => d.entityType === et && d.currentCount > 0)
      if (check) entry[et] = check.currentCount
    }
    return entry
  })

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Total (DB counts)</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend
            iconSize={10}
            wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
            onClick={(e) => setHidden((prev) => {
              const next = new Set(prev)
              const key = String(e.dataKey)
              next.has(key) ? next.delete(key) : next.add(key)
              return next
            })}
          />
          {(Object.entries(ENTITY_COLORS) as [string, string][]).map(([et, color]) => (
            <Line
              key={et}
              type="monotone"
              dataKey={et}
              stroke={color}
              hide={hidden.has(et)}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Крок 2: Реалізувати `src/components/dashboard/CompletenessChart.tsx`**

```tsx
'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useState } from 'react'
import type { EntityCheckSummary } from '@prisma/client'

const ENTITY_COLORS = { dockless: '#3b82f6', docked: '#10b981', pricings: '#f59e0b', zones: '#8b5cf6' }

interface Props { summaries: EntityCheckSummary[]; dates: string[] }

export function CompletenessChart({ summaries, dates }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const data = dates.map((date) => {
    const entry: Record<string, unknown> = { date }
    for (const et of ['dockless', 'docked', 'pricings', 'zones']) {
      const s = summaries.find((x) => x.entityType === et)
      if (s) entry[et] = s.totalNotFoundInDb
    }
    return entry
  })

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Missing in DB</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend
            iconSize={10}
            wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
            onClick={(e) => setHidden((prev) => {
              const next = new Set(prev)
              const key = String(e.dataKey)
              next.has(key) ? next.delete(key) : next.add(key)
              return next
            })}
          />
          {(Object.entries(ENTITY_COLORS) as [string, string][]).map(([et, color]) => (
            <Line key={et} type="monotone" dataKey={et} stroke={color} hide={hidden.has(et)} dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Крок 3: Реалізувати `src/components/dashboard/QualityChart.tsx`**

```tsx
'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { AiComparison } from '@prisma/client'

interface Props { aiComparisons: AiComparison[]; sessionDates: { id: string; date: string }[] }

export function QualityChart({ aiComparisons, sessionDates }: Props) {
  const data = sessionDates.map(({ id, date }) => {
    const comps = aiComparisons.filter((c) => c.checkSessionId === id)
    return {
      date,
      Same: comps.filter((c) => c.verdict === 'Same').length,
      SomewhatSame: comps.filter((c) => c.verdict === 'SomewhatSame').length,
      Different: comps.filter((c) => c.verdict === 'Different').length,
    }
  })

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">AI Quality</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Same" fill="#10b981" stackId="a" />
          <Bar dataKey="SomewhatSame" fill="#f59e0b" stackId="a" />
          <Bar dataKey="Different" fill="#ef4444" stackId="a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Крок 4: Реалізувати `src/components/dashboard/ScraperChartRow.tsx`**

```tsx
import { TotalChart } from './TotalChart'
import { CompletenessChart } from './CompletenessChart'
import { QualityChart } from './QualityChart'
import type { CheckSession, EntityCheckSummary, SessionDeltaCheck, AiComparison } from '@prisma/client'

interface SessionData extends CheckSession {
  entityCheckSummaries: EntityCheckSummary[]
  sessionDeltaChecks: SessionDeltaCheck[]
  aiComparisons: AiComparison[]
}

interface Props { sessions: SessionData[] }

export function ScraperChartRow({ sessions }: Props) {
  const dates = sessions.map((s) => new Date(s.createdAt).toLocaleDateString('uk-UA', { month: 'short', day: 'numeric' }))
  const sessionDates = sessions.map((s) => ({
    id: s.id,
    date: new Date(s.createdAt).toLocaleDateString('uk-UA', { month: 'short', day: 'numeric' }),
  }))

  const allDeltaChecks = sessions.flatMap((s) => s.sessionDeltaChecks)
  const allSummaries = sessions.flatMap((s) => s.entityCheckSummaries)
  const allAiComparisons = sessions.flatMap((s) => s.aiComparisons)

  return (
    <div className="grid grid-cols-3 gap-4">
      <TotalChart deltaChecks={allDeltaChecks} dates={dates} />
      <CompletenessChart summaries={allSummaries} dates={dates} />
      <QualityChart aiComparisons={allAiComparisons} sessionDates={sessionDates} />
    </div>
  )
}
```

- [ ] **Крок 5: Commit**

```bash
git add src/components/dashboard/
git commit -m "feat: dashboard chart components (Total, Completeness, Quality)"
```

---

## Task 16: Dashboard Page

**Files:**
- Create: `src/components/dashboard/ScraperTable.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/api/dashboard/route.ts`

- [ ] **Крок 1: Реалізувати API для дашборду**

Створити `src/app/api/dashboard/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const days = parseInt(url.searchParams.get('days') ?? '7')
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const scrapers = await prisma.scraper.findMany({
    where: { isActive: true },
    include: {
      checkSessions: {
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        include: {
          entityCheckSummaries: true,
          sessionDeltaChecks: true,
          aiComparisons: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(scrapers)
}
```

- [ ] **Крок 2: Реалізувати `src/components/dashboard/ScraperTable.tsx`**

```tsx
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScraperChartRow } from './ScraperChartRow'
import { RefreshCw } from 'lucide-react'

const flagVariant = { ok: 'default', warning: 'secondary', critical: 'destructive', '—': 'outline' } as const

export function ScraperDashboard() {
  const [scrapers, setScrapers] = useState<any[]>([])
  const [days, setDays] = useState('7')
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function load() {
    const res = await fetch(`/api/dashboard?days=${days}`)
    setScrapers(await res.json())
  }

  useEffect(() => { load() }, [days])

  async function handleSync() {
    setSyncing(true)
    await fetch('/api/scrapers/sync', { method: 'POST' })
    await load()
    setSyncing(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-3">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            Sync Scrapers
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {scrapers.map((scraper) => {
          const lastSession = scraper.checkSessions.at(-1)
          const lastDelta = lastSession?.sessionDeltaChecks?.[0]
          const lastSummary = lastSession?.entityCheckSummaries?.[0]
          const apiStatus = lastSummary
            ? (lastSummary.totalNotFoundInDb === 0 ? 'ok' : 'warning')
            : '—'
          const deltaStatus = lastDelta?.deltaFlag ?? '—'
          const isExpanded = expanded.has(scraper.id)

          return (
            <div key={scraper.id} className="rounded-lg border">
              <div
                className="flex cursor-pointer items-center justify-between p-4 hover:bg-muted/30"
                onClick={() => setExpanded((prev) => {
                  const next = new Set(prev)
                  next.has(scraper.id) ? next.delete(scraper.id) : next.add(scraper.id)
                  return next
                })}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{scraper.name}</span>
                  {lastSession && (
                    <Link href={`/sessions/${lastSession.id}`} onClick={(e) => e.stopPropagation()}>
                      <Badge variant="outline" className="font-mono text-xs">
                        #{lastSession.scrapersSessionId}
                      </Badge>
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={flagVariant[apiStatus as keyof typeof flagVariant]}>API→DB: {apiStatus}</Badge>
                  <Badge variant={flagVariant[deltaStatus as keyof typeof flagVariant]}>Delta: {deltaStatus}</Badge>
                  {lastSession && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(lastSession.createdAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              {isExpanded && scraper.checkSessions.length > 0 && (
                <div className="border-t px-4 pb-4 pt-3">
                  <ScraperChartRow sessions={scraper.checkSessions} />
                </div>
              )}
            </div>
          )
        })}
        {scrapers.length === 0 && (
          <p className="text-center text-muted-foreground py-12">
            No scrapers found. Click "Sync Scrapers" to load from the external database.
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Крок 3: Оновити `src/app/page.tsx`**

```tsx
import { ScraperDashboard } from '@/components/dashboard/ScraperTable'

export default function DashboardPage() {
  return <ScraperDashboard />
}
```

- [ ] **Крок 4: Перевірити в браузері**

```bash
pnpm dev
```

Відкрити `http://localhost:3000`. Переконатись:
- Заголовок "Dashboard" відображається
- Date filter працює
- "Sync Scrapers" кнопка є
- При кліку на рядок скрапера розгортаються charти

- [ ] **Крок 5: Commit**

```bash
git add src/components/dashboard/ScraperTable.tsx src/app/page.tsx src/app/api/dashboard/
git commit -m "feat: dashboard page with scraper table and expandable charts"
```

---

## Task 17: Config Management UI

**Files:**
- Create: `src/app/api/config/thresholds/route.ts`
- Create: `src/app/api/config/auto-check/route.ts`
- Create: `src/components/config/ThresholdForm.tsx`
- Create: `src/components/config/AutoCheckConfigForm.tsx`
- Create: `src/app/config/page.tsx`

- [ ] **Крок 1: Реалізувати API для AlertThreshold**

Створити `src/app/api/config/thresholds/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  return NextResponse.json(await prisma.alertThreshold.findMany())
}

export async function POST(req: NextRequest) {
  const { appId, entityType, warningThresholdPct, criticalThresholdPct } = await req.json()
  const threshold = await prisma.alertThreshold.upsert({
    where: { appId_entityType: { appId, entityType } },
    update: { warningThresholdPct, criticalThresholdPct },
    create: { appId, entityType, warningThresholdPct, criticalThresholdPct },
  })
  return NextResponse.json(threshold)
}
```

- [ ] **Крок 2: Реалізувати API для AutoCheckConfig**

Створити `src/app/api/config/auto-check/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/quality-db'

export async function GET() {
  return NextResponse.json(await prisma.autoCheckConfig.findMany())
}

export async function POST(req: NextRequest) {
  const data = await req.json()
  const config = await prisma.autoCheckConfig.upsert({
    where: { appId: data.appId },
    update: data,
    create: data,
  })
  return NextResponse.json(config)
}
```

- [ ] **Крок 3: Реалізувати `src/components/config/ThresholdForm.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ENTITY_TYPES } from '@/types'
import type { EntityType } from '@/types'

interface Props { scrapers: { appId: string; name: string }[]; onSaved: () => void }

export function ThresholdForm({ scrapers, onSaved }: Props) {
  const [appId, setAppId] = useState('')
  const [entityType, setEntityType] = useState<EntityType>('dockless')
  const [warning, setWarning] = useState('20')
  const [critical, setCritical] = useState('50')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/config/thresholds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, entityType, warningThresholdPct: Number(warning), criticalThresholdPct: Number(critical) }),
    })
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Scraper</Label>
          <Select value={appId} onValueChange={setAppId}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{scrapers.map((s) => <SelectItem key={s.appId} value={s.appId}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Entity Type</Label>
          <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{ENTITY_TYPES.map((et) => <SelectItem key={et} value={et}>{et}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Warning threshold %</Label>
          <Input type="number" value={warning} onChange={(e) => setWarning(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Critical threshold %</Label>
          <Input type="number" value={critical} onChange={(e) => setCritical(e.target.value)} />
        </div>
      </div>
      <Button type="submit" disabled={!appId}>Save Threshold</Button>
    </form>
  )
}
```

- [ ] **Крок 4: Реалізувати `src/app/config/page.tsx`**

```tsx
'use client'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ThresholdForm } from '@/components/config/ThresholdForm'
import { Badge } from '@/components/ui/badge'

export default function ConfigPage() {
  const [scrapers, setScrapers] = useState<{ appId: string; name: string }[]>([])
  const [thresholds, setThresholds] = useState<any[]>([])

  async function load() {
    const [sc, th] = await Promise.all([
      fetch('/api/scrapers').then((r) => r.json()),
      fetch('/api/config/thresholds').then((r) => r.json()),
    ])
    setScrapers(sc)
    setThresholds(th)
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Config</h1>

      <Card>
        <CardHeader><CardTitle>Alert Thresholds</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ThresholdForm scrapers={scrapers} onSaved={load} />
          {thresholds.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left">Scraper</th>
                  <th className="text-left">Entity</th>
                  <th className="text-left">Warning</th>
                  <th className="text-left">Critical</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map((t) => (
                  <tr key={t.id}>
                    <td>{t.appId}</td>
                    <td><Badge variant="outline">{t.entityType}</Badge></td>
                    <td className="text-yellow-600">{t.warningThresholdPct}%</td>
                    <td className="text-red-600">{t.criticalThresholdPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Крок 5: Перевірити сторінку `/config` в браузері**

Переконатись що форма рендериться, можна зберегти threshold і таблиця оновлюється.

- [ ] **Крок 6: Commit**

```bash
git add src/app/api/config/ src/components/config/ src/app/config/
git commit -m "feat: config management UI for thresholds"
```

---

## Task 18: Seed Data & Quality Verification

**Files:**
- Create: `prisma/seed.ts`

**Мета:** переконатись що весь golden path працює end-to-end.

- [ ] **Крок 1: Створити `prisma/seed.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Seed тестовий scraper
  const scraper = await prisma.scraper.upsert({
    where: { appId: 'test-scraper' },
    update: {},
    create: {
      appId: 'test-scraper',
      name: 'Test Scraper',
      supportedEntityTypes: ['dockless', 'docked'],
      isActive: true,
    },
  })

  // Seed тестову сесію з результатами
  const session = await prisma.checkSession.create({
    data: {
      environment: 'staging',
      appId: 'test-scraper',
      scrapersSessionId: 1001,
      polygonIds: ['poly-1'],
      entityTypes: ['dockless'],
      checksEnabled: ['api_db', 'delta'],
      aiSampleSize: 3,
      status: 'completed',
      triggeredBy: 'manual',
    },
  })

  await prisma.entityCheckSummary.create({
    data: {
      checkSessionId: session.id,
      entityType: 'dockless',
      totalUniqueInApi: 150,
      totalFoundInDb: 145,
      totalNotFoundInDb: 5,
    },
  })

  await prisma.sessionDeltaCheck.create({
    data: {
      checkSessionId: session.id,
      entityType: 'dockless',
      currentScrapersSessionId: 1001,
      previousScrapersSessionId: 1000,
      currentCount: 150,
      previousCount: 160,
      deltaPercent: -6.25,
      deltaFlag: 'ok',
    },
  })

  await prisma.aiComparison.createMany({
    data: [
      { checkSessionId: session.id, entityType: 'dockless', entityId: 'ent-1', apiSnapshot: { id: 'ent-1', lat: 50.1, lng: 30.2 }, dbSnapshot: { id: 'ent-1', lat: 50.11, lng: 30.21 }, verdict: 'Same', explanation: 'Minor coordinate drift within city bounds.' },
      { checkSessionId: session.id, entityType: 'dockless', entityId: 'ent-2', apiSnapshot: { id: 'ent-2', name: 'Scooter A' }, dbSnapshot: { id: 'ent-2', name: 'Scooter B' }, verdict: 'Different', explanation: 'Name field does not match.' },
    ],
  })

  await prisma.alertThreshold.upsert({
    where: { appId_entityType: { appId: 'test-scraper', entityType: 'dockless' } },
    update: {},
    create: { appId: 'test-scraper', entityType: 'dockless', warningThresholdPct: 20, criticalThresholdPct: 50 },
  })

  console.log('Seed complete:', { scraperId: scraper.id, sessionId: session.id })
}

main().finally(() => prisma.$disconnect())
```

- [ ] **Крок 2: Встановити `tsx` для запуску seed**

```bash
pnpm add -D tsx
```

Додати до `package.json`:
```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Крок 3: Запустити seed**

```bash
pnpm prisma db seed
```

Очікуваний результат: `Seed complete: { scraperId: ..., sessionId: ... }`

- [ ] **Крок 3: Запустити всі тести**

```bash
pnpm test
```

Очікуваний результат: всі тести PASS.

- [ ] **Крок 4: Ручна перевірка golden path**

```bash
pnpm dev
```

Чеклист ручної перевірки:

- [ ] `http://localhost:3000` — бачиш "Test Scraper" в таблиці
- [ ] Клік на рядок скрапера — розгортаються три charти (Total, Completeness, Quality)
- [ ] Клік на badge сесії — відкривається `/sessions/[id]`
- [ ] На сторінці сесії є таб `dockless`, відображаються: API→DB stats, Delta stats, 2 AI comparisons
- [ ] Badge "Same" зелений, "Different" червоний
- [ ] Manual Review panel — поле для вводу entity ID
- [ ] `http://localhost:3000/config` — форма порогів, таблиця з `test-scraper / dockless / 20% / 50%`
- [ ] `http://localhost:3000/sessions/new` — форма Run Check, dropdown скраперів порожній (синк не виконано з реальною БД — нормально)
- [ ] Date filter на дашборді (7/14/30 днів) — переключається без помилок
- [ ] Toggle ліній на charті — ховає/показує лінії, масштаб змінюється

- [ ] **Крок 5: Фінальний commit**

```bash
git add prisma/seed.ts package.json
git commit -m "feat: seed data and quality verification checklist"
```

---

## Post-Implementation Checklist

Після виконання всіх тасків:

- [ ] `pnpm test` — всі тести зелені
- [ ] `pnpm build` — білд без TypeScript помилок
- [ ] Seed дані завантажені, golden path пройдено вручну
- [ ] `scrapers_db` підключена та `POST /api/scrapers/sync` повертає реальні скрапери
- [ ] Delta check SQL уточнено з командою розробників скраперів
- [ ] Адаптери для реальних скраперів реалізовані (по одному файлу на скрапер) і зареєстровані в `adapterRegistry`
