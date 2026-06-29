# L-Data Quality Tool

Internal web tool for verifying correctness of data collected by scrapers. Helps QA engineers and scraper developers detect completeness and data quality issues, and track trends across collection sessions.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + TypeScript |
| ORM | Prisma 6 (`src/generated/prisma`) |
| Tool DB (`quality_db`) | PostgreSQL 16 via Docker (port 5433) |
| Scrapers DB (`scrapers_db`) | PostgreSQL (external, read-only, via kubectl port-forward) |
| UI | Tailwind CSS v4 + Shadcn/UI v5 + Recharts 3 |

## Prerequisites

- Node.js 20+
- Docker (for `quality_db`)
- `kubectl` configured for the scraper cluster (for `scrapers_db`)

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Start the local database**

```bash
docker compose up -d
```

This starts PostgreSQL on port 5433 with `quality_db`.

**3. Create `.env.local`**

```env
DATABASE_URL="postgresql://quality:quality@localhost:5433/quality_db"

SCRAPERS_DB_HOST=localhost
SCRAPERS_DB_PORT=5434
SCRAPERS_DB_NAME=<db_name>
SCRAPERS_DB_USER=<user>
SCRAPERS_DB_PASSWORD=<password>
```

**4. Run migrations and seed**

```bash
npx prisma migrate deploy
npm run seed
```

**5. Connect to scrapers_db**

In a separate terminal, open the port-forward before using the tool:

```bash
npm run scrapers-db:stage   # port 5435 (staging)
# or
npm run scrapers-db:prod    # port 5434 (production)
```

**6. Start the dev server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. Go to `/config` → click **Sync from scrapers_db** (requires active port-forward)
2. Go to `/sessions/new` → select environment, scraper, and scrapers session ID
3. Configure the check:
   - **API→DB**: verifies each entity returned by the scraper API exists in the DB
   - **Delta**: compares entity counts between two scraper sessions to detect anomalies
   - **Field comparison**: compares field values between API response and DB snapshot
4. View results at `/sessions/[id]`

## Pages

| Page | Description |
|------|-------------|
| `/` | Dashboard: scraper list with trend charts (Total / Completeness / Field comparison) |
| `/sessions/new` | Launch a new check session |
| `/sessions/[id]` | Session results: API→DB, Delta, field comparisons |
| `/config` | Sync scrapers + per-scraper thresholds |

## Commands

```bash
npm run dev              # development server
npm run build            # production build
npm test                 # run tests (Vitest)
npm run test:watch       # watch mode
npm run scrapers-db:stage  # kubectl port-forward to staging scrapers_db
npm run scrapers-db:prod   # kubectl port-forward to production scrapers_db
npm run seed             # seed quality_db with initial data
npx prisma studio        # open Prisma Studio (quality_db)
npx prisma migrate dev   # create and apply a new migration
```

## Notes

- `scrapers_db` is **read-only** — never write to it
- `Scraper.appId` in `quality_db` maps to `apps.name` in `scrapers_db` (not `apps.id`)
- After running `prisma migrate dev` or `prisma generate`, restart the dev server to clear the Next.js cache
