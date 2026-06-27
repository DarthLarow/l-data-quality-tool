# Design Implementation Plan

Source: `docs/design/Design brief document/Data Quality Tool.dc.html`

---

## Design tokens (extract from HTML)

### Colors
```
Background layers:  #0a0a0a (app shell), #080808 (content), #0f0f0f (cards), #0d0d0d (sections), #0c0c0c (sidebar)
Border:             rgba(255,255,255,0.08) standard, rgba(255,255,255,0.07) dividers
Text:               #ededed (primary), #cfcfcf, #bdbdbd, #9a9a9a, #8a8a8a, #7a7a7a, #6b6b6b, #5e5e5e, #5a5a5a
Status green:       #3fb950  (bg tint rgba(63,185,80,0.12))
Status amber:       #d29922  (bg tint rgba(210,153,34,0.12))
Status red:         #f85149  (bg tint rgba(248,81,73,0.12))
Status blue:        #4493f8  (pulsing / running)
```

### Typography
```
UI font:   Geist 400/500/600/700  (Google Fonts)
Data font: Geist Mono 400/500/600  (Google Fonts)
Data values, IDs, session numbers, percentages → always Geist Mono
```

### Radii & spacing
```
App frame:  border-radius 12px
Cards:      9–10px
Inputs/pills/buttons: 7–8px
Small tags: 4–6px
Dot:        50%
```

### Animations
```
dqpulse:   box-shadow pulse for running dots (rgba(68,147,248,...))
dqshimmer: translateX shimmer for progress bar
```

---

## Step 1 — Foundation: fonts + CSS tokens

**Files:** `src/app/layout.tsx`, `src/app/globals.css`

**Changes:**
- Add Google Fonts link: `Geist:wght@400;500;600;700` + `Geist Mono:wght@400;500;600`
- Override CSS vars in `:root` / global body to lock to dark theme:
  ```css
  --background: #0a0a0a;
  --foreground: #ededed;
  --card: #0f0f0f;
  --border: rgba(255,255,255,0.08);
  --muted: #1a1a1a;
  --muted-foreground: #6b6b6b;
  --status-ok: #3fb950;
  --status-warning: #d29922;
  --status-critical: #f85149;
  --status-running: #4493f8;
  ```
- Set `font-family: Geist, system-ui, sans-serif` on body
- Add `font-family: 'Geist Mono', monospace` utility class `.font-mono`
- Add keyframe animations `dqpulse` and `dqshimmer`
- Disable light mode override (remove `@media (prefers-color-scheme: light)` block if present)

---

## Step 2 — Sidebar

**File:** `src/components/layout/Sidebar.tsx`

**Changes:**
- Background: `#0c0c0c`, border-right: `rgba(255,255,255,0.07)`, width `212px`
- Logo block: white 24×24 rounded-md box with "DQ" in Geist Mono + "Data Quality" title + "v2.4 · internal" subtitle in `#5e5e5e`
- Section label "CHECKS": `Geist Mono 10px 500`, `#5a5a5a`, `letter-spacing: 0.08em`
- Nav items: replace Lucide icons with inline SVG from design; active = `rgba(255,255,255,0.07)` bg + `#ededed` text; inactive = transparent + `#8a8a8a`
- Nav item icons (from design):
  - Dashboard: 4-square grid SVG
  - Sessions: 3-line list SVG
  - New Check: plus SVG
  - Config: sliders SVG (two horizontal lines with circle handles)
- Bottom user block: 26×26 circle avatar "QA" + "qa-runner" / "scrapers_db" label

---

## Step 3 — Dashboard (`/`)

**Files:** `src/app/page.tsx`, `src/components/dashboard/ScraperGrid.tsx`

### Header
- Title "Scrapers" + subtitle "9 sources · **2 critical** · **2 warnings** · **1 running**" with colored spans
- Right: search input (Geist Mono, `#7a7a7a`, border `rgba(255,255,255,0.1)`) + "＋ New Check" button (bg `#ededed`, text `#0a0a0a`, font 600)

### Card grid
`grid-template-columns: repeat(3, 1fr)`, gap `14px`, bg `#080808`, padding `18px 22px`

### Each card
- bg `#0f0f0f`, border `rgba(255,255,255,0.08)`, **border-left: 3px solid `{accent}`** (replaces ring)
- border-radius `9px`, padding `13px 15px`
- Health dot: 8×8px circle, pulsing blue for running (use `dqpulse` animation)
- Scraper name: Geist 600 14px; appId: Geist Mono 400 11px `#5e5e5e`
- Time: Geist Mono 400 11px `#8a8a8a`

**Empty state:**
- Centered text "No sessions yet" + pill button "Run first check →" (border `rgba(255,255,255,0.13)`, font 600 11px)

**Running state:**
- "Checking…" in `#4493f8` + session + entity type label
- Progress bar: `#080808` bg with `#4493f8` fill + `dqshimmer` overlay
- "138 / 300 checked · ~2m left" in Geist Mono

**Normal state (last session):**
- Env badge row: pill with `live` (`#3fb950` on `rgba(63,185,80,0.12)`) or `stage` (`#d29922` on `rgba(210,153,34,0.12)`) + session number `#8a8a8a`
- Coverage rows: `grid-template-columns: 1fr auto 42px`; entity `#bdbdbd`, found/total `#8a8a8a` Geist Mono, pct colored by threshold
- AI row: Geist Mono 11px `● N Same` `● N ~` `● N Diff` in green/amber/red
- Action buttons row (border-top): "Sessions" (outline) + "Run →" (subtle filled)

---

## Step 4 — Sessions list (`/sessions`)

**Files:** `src/app/sessions/page.tsx`, `src/components/sessions/SessionsList.tsx`

### Header
- Title "Sessions" + "＋ New Check" button (same style as dashboard)

### Filters bar
- bg `#0b0b0b`, border-bottom `rgba(255,255,255,0.07)`
- "Scraper" dropdown pill: border `rgba(255,255,255,0.1)`, border-radius 7px, text + "All ▾"
- Status segmented control (not Select): `All | In progress | Completed | Failed` — single border wrapper, active segment bg `rgba(255,255,255,0.08)` text `#ededed`, inactive `#8a8a8a`
- "Last 7 days" pill on the right (margin-left auto)

### Table
- Header: Geist Mono 500 10.5px `#6b6b6b`, letter-spacing 0.06em, border-bottom `rgba(255,255,255,0.07)`
- Columns: `100px 110px 80px 1fr 90px 150px 130px`
- Rows: hover cursor pointer, border-bottom `rgba(255,255,255,0.045)`
- DATE: Geist Mono, colored blue if running
- SCRAPER: dot + name, Geist 500 12.5px
- SESSION: Geist Mono `#bdbdbd`
- ENTITIES: Geist 400 `#9a9a9a`
- COVERAGE: right-aligned, Geist Mono 500, colored by value
- AI: Geist Mono `#9a9a9a` (e.g. "15S · 2~ · 1✗")
- STATUS: "Completed" `#3fb950`, "● In progress" `#4493f8`, "Failed" `#f85149`

---

## Step 5 — Session results (`/sessions/[id]`)

**File:** `src/components/sessions/SessionResultsTabs.tsx`

### Page header
- Breadcrumb "Sessions /" in Geist Mono `#6b6b6b`
- Scraper name: Geist 600 17px
- Env badge: colored pill (same as card)
- Status badge: dot + text with bg tint (Completed = green, Failed = red, running = blue)
- Meta line: "scrapers session #240 · ext id `sess_a1b2c3d4e5` · created 2h ago · took 4m 12s" in Geist Mono `#7a7a7a`
- Right: "Re-run" + "Export" ghost buttons

### Summary card
- `grid-template-columns: 1fr 1fr`, border `rgba(255,255,255,0.08)`, border-radius 10px
- Left "API → DB" panel, right "AI COMPARISON" panel, divided by `border-right`
- Headers: Geist Mono 600 11px `#8a8a8a`, letter-spacing 0.06em
- Col headers: Geist Mono 500 10px `#5e5e5e`, letter-spacing 0.04em
- Data rows: `border-bottom: rgba(255,255,255,0.04)`
- Miss tag: `(−N)` in `#f85149` inline

### Sticky nav pills
- `position: sticky; top: 0`
- Each pill: `#0f0f0f` bg, border `rgba(255,255,255,0.1)`, radius 8px, Geist 500 12.5px
- Contains: colored dot + entity name + colored pct (Geist Mono) + "· N AI" in `#6b6b6b`

### Entity sections
- bg `#0d0d0d`, border `rgba(255,255,255,0.08)`, radius 10px
- Section header: `#101010` bg, entity name Geist 600 14px + pct colored + "· N AI" in `#6b6b6b`
- If critical: "+ 1 different" in `#f85149`

### API→DB sub-section
- Stats row: inline `300 checked · 298 found · 2 missing · 99%` in Geist Mono `#bdbdbd`
- Numbers colored: checked `#ededed`, found `#3fb950`, missing `#f85149`, pct colored
- Missing IDs toggle button: `rgba(248,81,73,0.08)` bg, `rgba(248,81,73,0.2)` border, `#f4a59f` text
- Missing IDs list: pills with same red tint, Geist Mono

### AI comparison cards
- Collapsed row: chevron `▶` (rotates 90° when expanded) + verdict badge + entity ID (Geist Mono `#cfcfcf`) + summary text (Geist `#8a8a8a`, truncated)
- Verdict badge styles:
  - Same: `#3fb950` text on `rgba(63,185,80,0.13)` bg
  - SomewhatSame: `#d29922` on `rgba(210,153,34,0.13)`
  - Different: `#f85149` on `rgba(248,81,73,0.13)`

### Diff table (expanded card)
- Header: Geist Mono 500 10px `#5e5e5e`, bg `#0c0c0c`
- 4 columns: `1.5fr 1.1fr 1.1fr 1.5fr`
- DB column has `padding-left: 14px; border-left: 1px solid rgba(255,255,255,0.1)`
- Row types (left border 2px + bg tint):
  - `g` (match): `rgba(63,185,80,0.07)` bg + `#3fb950` border
  - `y` (dynamic/acceptable): `rgba(210,153,34,0.08)` bg + `#d29922` border
  - `r` (mismatch): `rgba(248,81,73,0.08)` bg + `#f85149` border, DB value `#f4a59f`
- Cell text: API `#cfcfcf`, rule `#8a8a8a`, transformed `#bdbdbd`, DB varies

---

## Step 6 — New Check form (`/sessions/new`)

**File:** `src/app/sessions/new/page.tsx` (or its form component)

### Layout
- Page header: "New Check" title + "Configure and launch a verification run" subtitle `#8a8a8a`
- Content: padding `20px 24px`, bg `#080808`, gap 18px, flex-column

### Environment — segmented control
- Two segments "staging" / "production" with single border wrapper (radius 7px)
- Active: `rgba(255,255,255,0.09)` bg `#ededed` text; inactive: transparent `#8a8a8a`

### Scraper — styled select
- Flex row: scraper name Geist 500 13px + `appId ▾` in Geist Mono `#6b6b6b`
- Border `rgba(255,255,255,0.1)`, radius 7px

### Session ID input
- Prefix `#` in `#5e5e5e` + monospace number input
- Max-width 240px

### Check types — card checkboxes
Each type as a bordered row card:
- Unchecked: border `rgba(255,255,255,0.08)`, bg transparent
- Checked: border `rgba(255,255,255,0.16)`, bg `rgba(255,255,255,0.03)`
- Checkbox: 18×18px rounded-md; checked = `#ededed` bg with SVG checkmark `#0a0a0a`
- Title: Geist 500 13px + subtitle Geist 400 11px `#7a7a7a`

### Polygon strategy + Entity types — pill toggles
Active pill: border `rgba(255,255,255,0.22)`, bg `rgba(255,255,255,0.08)`, `#ededed`
Inactive pill: border `rgba(255,255,255,0.1)`, bg transparent, `#8a8a8a`

### AI Sample Size (conditional on AI checked)
- Container: `#0d0d0d` bg, border `rgba(255,255,255,0.08)`, radius 8px
- Counter: `−` button (26×26, border) + number (Geist Mono 600 15px) + `+` button
- Progress bar: bg `rgba(255,255,255,0.08)`, fill `#ededed`
- Range labels "1" / "20" in Geist Mono 10px `#5e5e5e`

### Previous Session ID (conditional on Delta checked)
- Same style as Scrapers Session ID input

### Submit row
- "Run Check →" button: bg `#ededed`, text `#0a0a0a`, Geist 600 13px, radius 8px
- Estimate: Geist Mono 11.5px `#6b6b6b` "≈ 7 min · 3 entity types"

---

## Step 7 — Config (`/config`)

**Files:** `src/app/config/page.tsx`, `src/components/config/ScraperThresholdEditor.tsx`

### Header
- "Scraper Config" title + "Auto-check schedules and alert thresholds" subtitle
- "Sync from scrapers_db" button: border `rgba(255,255,255,0.13)`, Geist 500 12px `#ededed`

### Table
- Columns: `150px 1.4fr 1.3fr 130px`
- Header: Geist Mono 500 10.5px `#6b6b6b`, letter-spacing 0.06em, border-bottom `rgba(255,255,255,0.07)`
- Row divider: `rgba(255,255,255,0.05)`

### SCRAPER column
- Colored dot (7×7px) + name Geist 500 13px

### AUTO-CHECK column
- Active: "● staging · API→DB" `#cfcfcf` + subtitle row (entity types, schedule) `#6b6b6b` Geist Mono 11px
- Not configured: `#6b6b6b` italic

### THRESHOLDS column
- "N sets configured" in `#bdbdbd` Geist Mono; "—" in `#6b6b6b`

### ACTIONS column (right-aligned, gap 10px)
- **Switch**: `width:34px;height:19px`, radius 10px; ON: `#3fb950` bg; OFF: `rgba(255,255,255,0.14)`; knob: 15×15px white circle, `left: 17px` (on) / `left: 2px` (off), transition 0.15s
- **Pencil button**: 28×28px, border `rgba(255,255,255,0.1)`, radius 6px, inline SVG pencil `#9a9a9a`
- **Bell button**: 28×28px, radius 6px; active (open): border `rgba(210,153,34,0.4)`, bg `rgba(210,153,34,0.12)`, color `#d29922`; inactive: border `rgba(255,255,255,0.1)`, `#9a9a9a`

### Inline threshold panel (bell open)
- Container: `margin: 2px 4px 14px`, bg `#0d0d0d`, border `rgba(255,255,255,0.08)`, radius 9px, padding `16px 18px`
- Header: "ALERT THRESHOLDS · {name}" Geist Mono 600 11px `#9a9a9a`, letter-spacing 0.05em
- Column groups: `grid-template-columns: 120px repeat(6, 1fr)`, gap 8px
- Group labels with `border-bottom: rgba(255,255,255,0.08)`: "NOT FOUND IN DB" | "API / DB MISMATCH" | "DELTA %"
- WARN/CRIT sub-headers: `#d29922` / `#f85149`
- Inputs: `background:#080808`, border `rgba(255,255,255,0.1)`, radius 5px, text centered, Geist Mono 12px `#ededed`

---

## Implementation order

| Step | Effort | Impact |
|------|--------|--------|
| 1. Fonts + tokens | Small | Immediately changes feel across all pages |
| 2. Sidebar | Small | Visible on every page |
| 3. Dashboard cards | Medium | Core page, most visual delta |
| 4. Sessions list | Small | Minor table/filter tweaks |
| 5. Session results | Large | Most complex, diff table rows |
| 6. New Check form | Medium | Segmented controls, card checkboxes, sample counter |
| 7. Config | Small | Switch + bell styling only |

Start with steps 1–2 (global + sidebar) as they apply everywhere before doing per-page work.
