# Design Brief — Data Quality Tool

## What is this?

An internal web tool for QA engineers and scraper developers to verify data quality collected by web scrapers. Scrapers collect mobility data (scooters, bikes, docking stations, pricing, zones) from city APIs. After each collection session, engineers run checks to find missing data, anomalies, and compare API responses with what's stored in the database.

**Target users:** Technical — QA engineers and backend developers. Comfortable with data, tables, numbers. They need information density, not hand-holding.

**Primary jobs:**
1. Open dashboard → instantly see which scrapers have issues
2. Start a new check for a specific scraper and session
3. Review check results — what's missing, what's different, what AI flagged
4. Configure alert thresholds per scraper

---

## Tech stack

Next.js + TypeScript + Tailwind CSS v4 + Shadcn/UI (radix-nova preset) + Recharts. Dark mode preferred. Monospace font for data values (IDs, numbers, percentages).

---

## Pages to design

### 1. Dashboard `/`

A grid of scraper cards. Each card represents one data source (Ario, Bird, Voi, Bolt, etc.).

**Each card shows:**
- Scraper name + appId
- Health status dot (● green = all good, ● yellow = some issues, ● red = critical/failures, ● pulsing blue = running)
- Last session: relative time ("2h ago") + environment badge (`stage` or `live`) + session number (`#240`)
- Coverage table per entity type:
  ```
  dockless   298/300   99%
  pricings   100/100  100%
  zones       47/50    94%
  ```
- AI comparison summary: `12 Same · 2 Somewhat · 1 Different`
- Bottom actions: [Sessions] [Run →]

**Clicking the card body** → goes to the latest session results.

Cards without sessions show a "No sessions yet" empty state.

**Design challenge:** The grid needs to work with 10–20 scrapers. Cards should be scannable at a glance — health status must be immediately visible.

---

### 2. Sessions List `/sessions`

A filterable table of all check sessions across scrapers.

**Filters (top bar):**
- Scraper (select)
- Status: All / In progress / Completed / Failed
- Date range: Last 7 / 14 / 30 days / All time

**Table columns:**
| Date | Scraper | Session | Entities | Coverage | AI | Status |
|---|---|---|---|---|---|---|
| 2h ago | Ario | #240 | dockless · zones | 97% | 15S · 2~ · 1✗ | Completed |
| running | Bird | #891 | dockless | — | — | ● In progress |

- Clicking a row → session detail
- "New Check" button top right

**Status indicators:**
- `Completed` — green text
- `In progress` — pulsing blue dot + "In progress"
- `Failed` — red text

---

### 3. Session Results `/sessions/[id]`

The most complex page. Shows results of one check session.

**Page header:**
- Scraper name + environment badge + status
- Session ID (external) + created time

**Summary bar (top of results):**
Two side-by-side mini-tables inside a subtle card:

```
API → DB                          AI Comparison
──────────────────────────────    ─────────────────────────────
Entity    Checked  Found  Miss %  Entity    Same  Somewhat  Diff
dockless     300    298     2  99% dockless     5         1     —
pricings     100    100     —  100% pricings    3         —     —
zones         50     47     3  94% zones        2         —     1
```

**Sticky navigation bar** — pills that jump to entity sections:
```
[ dockless 99% ·5AI ]  [ pricings 100% ·3AI ]  [ zones 94% ·2AI ]
```

**Content sections** (one per entity type):

Each section has two sub-sections:

**API → DB** — shows completeness:
- Stats: "300 checked · 298 found · 2 missing · 99%"
- If there are missing entities: expandable list of missing IDs

**AI Comparison** — list of compared entity pairs, each as a collapsible card:
```
┌─────────────────────────────────────────────────────────────┐
│ ▶  [Same]  entity-id-12345                                  │
│    Coordinates match within acceptable GPS drift threshold. │
└─────────────────────────────────────────────────────────────┘
```

Expanded state shows a **diff table** — side-by-side API vs DB field comparison:
```
API                          Transform rule    Transformed    │ DB
─────────────────────────────────────────────────────────────────
"carId": 12345               str()             "12345"        │ "vehicle_id": "12345"   ← GREEN row (match)
"battery": 87                copy              87             │ "battery": 91           ← YELLOW row (dynamic field, acceptable diff)
"stickerid": "SC-099"        copy              "SC-099"       │ "name": "SC-099"        ← GREEN row
"type": 1                    1→"Ario TS 1.0"   "Ario TS 1.0"  │ "category": "Bolt 4"   ← RED row (mismatch)
```

Row colors:
- **Green** — values match
- **Yellow** — dynamic field (battery, GPS) within acceptable range
- **Red** — static field mismatch or dynamic field with anomalous difference

Verdict badges: `Same` (green), `SomewhatSame` (amber), `Different` (red)

---

### 4. New Check `/sessions/new`

A form to configure and launch a check.

**Fields:**
- Environment (staging / production)
- Scraper (select from active scrapers)
- Scrapers Session ID (number input)
- Check types: `[ ] API→DB` `[ ] AI Comparison` `[ ] Delta`
- Polygon strategy: Random / By ID / By city (all) / By city (random)
- Entity types: `[ ] dockless` `[ ] docked` `[ ] pricings` `[ ] zones`
- AI Sample Size (1–20, shown only if AI Comparison is enabled)
- Previous Session ID (shown only if Delta is enabled)

Submit button: "Run Check" → redirects to session results page when done.

---

### 5. Config `/config`

Per-scraper configuration table.

**Top:** "Sync from scrapers_db" button (loads scraper list from external DB)

**Table — one row per active scraper:**

```
Scraper      Auto-check               Thresholds        [toggle] [✏] [🔔]
──────────────────────────────────────────────────────────────────────────
Ario         ● staging · API→DB       dockless miss mm δ    ●●   [✏] [🔔]
             dockless, pricings, zones
Bird         not configured           —                        ○   [✏] [🔔]
```

- **Toggle (Switch)** — enable/disable auto-check schedule
- **✏ (Pencil)** → expands inline form for auto-check configuration
- **🔔 (Bell)** → expands inline threshold editor

**Inline threshold editor** (when 🔔 clicked):
```
           ─── Not found in DB ───   ─── API/DB mismatch ───   ─── Delta % ───
           Warn      Crit             Warn      Crit             Warn    Crit
dockless   [10]      [50]             [3]       [10]             [20]    [50]
pricings   [5]       [20]             [—]       [—]              [20]    [50]
+ Add threshold
```

---

## Visual language

**Data density:** This is a tool for engineers. Pack information efficiently. Small fonts for metadata, clear hierarchy between names and values.

**Color semantics (consistent across all pages):**
- Green — healthy, match, found, same
- Amber/yellow — warning, somewhat, dynamic drift
- Red — critical, missing, mismatch, different, failed
- Blue (pulsing) — currently running
- Muted gray — neutral, empty, not applicable (`—`)

**Monospace for data values:** All IDs, numbers, percentages, session numbers, entity IDs — monospace font. Regular font for labels and names.

**Status dots:** Small filled circles (●) used consistently for health states on cards, in nav, in tables.

**Tables everywhere:** Most data is tabular. Tables should be clean, with very subtle row dividers, no heavy borders.

**Cards:** Rounded borders, subtle shadow or border. Cards on the dashboard should be compact but visually distinct by health state (consider a subtle left border color, or a colored dot in the header).

---

## Tone

Professional internal tooling. Not flashy. Think Linear, Vercel dashboard, GitHub Actions — dense, functional, dark mode native. Monochrome base with purposeful use of color only for status semantics.

No decorative illustrations. No gradients on data. Micro-interactions welcome (hover states, smooth collapsing panels, subtle transitions).

The product name is **Data Quality Tool** — no logo needed, just a wordmark in the sidebar.
