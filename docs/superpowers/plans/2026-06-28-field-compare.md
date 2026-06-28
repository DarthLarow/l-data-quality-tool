# Plan: Replace AI comparison with deterministic field comparison

## Context

The AI check compares API snapshots with DB snapshots to detect data quality issues.
Since field mappings (transforms, static/dynamic classification) are already explicit in code,
the AI adds no value over deterministic logic for mapped scrapers.

## Verdict model

Two states only: **`Same` | `Different`**

- `Different` — at least one static field mismatch OR one dynamic field outside its threshold
- `Same` — all static fields match and all dynamic fields within thresholds

`AiVerdict` type in `src/types/index.ts`:
```ts
export type AiVerdict = 'Same' | 'Different'
```

> Existing DB records may contain `'SomewhatSame'` — treat as `'Different'` in UI queries
> (add `|| verdict === 'SomewhatSame'` where needed, or migrate with a one-liner SQL update).

---

## Step 1 — Add thresholds to field-mappings

**File:** `src/lib/field-mappings.ts`

Add optional `threshold` to `MappingRow`:

```ts
export type MappingRow = {
  apiKey?:    string
  dbKey:      string
  transform?: (v: unknown) => unknown
  note?:      string
  constant?:  unknown
  dynamic?:   true
  onlyWhen?:  (api: Record<string, unknown>) => boolean
  threshold?: { type: 'distance_m'; maxMeters: number }
            | { type: 'absolute';   maxDelta:  number }
            | { type: 'percent';    maxPct:    number }
}
```

Update `ario/dockless` mapping:
```ts
{ apiKey: 'battery',   dbKey: 'battery',      dynamic: true, threshold: { type: 'absolute',   maxDelta:  30 } },
{ apiKey: 'latitude',  dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 500 } },
{ apiKey: 'longitude', dbKey: 'location_lng', dynamic: true }, // handled as part of lat/lng pair — skip solo check
```

> Threshold values (30 battery units, 500m GPS) are **provisional** — confirm with scraper team.

---

## Step 2 — Create `src/lib/checks/field-compare.ts`

```ts
export function compareEntityFields(
  api: Record<string, unknown>,
  db:  Record<string, unknown>,
  entityType: EntityType,
  appId: string,
): { verdict: AiVerdict; explanation: string }
```

### Algorithm

```
mismatches: string[] = []
latRow: MappingRow | null = null   // track lat to pair with lng for Haversine

for each row in getFieldMapping(appId, entityType):

  if onlyWhen && !onlyWhen(api) → skip

  if constant:
    if db[dbKey] !== constant → mismatches.push(`${dbKey}: expected "${constant}", got "${db[dbKey]}"`)
    continue

  if !apiKey || !(apiKey in api) → skip

  apiVal = row.transform ? row.transform(api[apiKey]) : api[apiKey]
  dbVal  = db[dbKey]

  if dynamic:
    if threshold.type === 'distance_m':
      // lat row: store for pairing; lng row: compute Haversine with stored lat
      distance = haversineMeters(apiLat, apiLng, dbLat, dbLng)
      if distance > maxMeters → mismatches.push(`location: ${distance}m from API (threshold ${maxMeters}m)`)
    if threshold.type === 'absolute':
      if |Number(apiVal) - Number(dbVal)| > maxDelta → mismatches.push(`${dbKey}: delta ${diff} exceeds ${maxDelta}`)
    if threshold.type === 'percent':
      if relative diff > maxPct → mismatches.push(...)
    if no threshold → skip (dynamic field, ignore)
  else (static):
    if !deepEqual(apiVal, dbVal) → mismatches.push(`${dbKey}: expected ${JSON.stringify(apiVal)}, got ${JSON.stringify(dbVal)}`)

verdict      = mismatches.length === 0 ? 'Same' : 'Different'
explanation  = mismatches.length === 0
               ? 'All fields match'
               : mismatches.join('; ')
```

### Helpers

```ts
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number
function deepEqual(a: unknown, b: unknown): boolean  // JSON.stringify for objects/arrays, === for primitives
```

### Edge case: no mapping for scraper

If `getFieldMapping` returns `[]`:
```ts
return { verdict: 'Same', explanation: 'No field mapping defined — comparison skipped' }
```

---

## Step 3 — Tests

**File:** `src/lib/__tests__/field-compare.test.ts`

```ts
describe('compareEntityFields / ario dockless', () => {
  it('Same — all static fields match, dynamic within threshold')
  it('Different — vehicle_id mismatch')
  it('Different — amt mismatch')
  it('Different — GPS 800m > 500m threshold')
  it('Same — GPS 340m within 500m threshold')
  it('Different — battery delta 40 > threshold 30')
  it('Same — battery delta 20 within threshold 30')
  it('onlyWhen skips rows where predicate is false')
  it('constant mismatch → Different')
  it('no mapping → Same with skipped explanation')
})
```

---

## Step 4 — Wire into orchestrator

**File:** `src/lib/checks/orchestrator.ts`

```ts
// Remove:
import { compareEntities } from '@/lib/ai/compare'

// Add:
import { compareEntityFields } from '@/lib/checks/field-compare'

// Change (inside the ai check block):
// Before:  const comparison = await compareEntities(apiSnapshot, dbSnapshot, entityType, input.appId)
// After:   const comparison = compareEntityFields(apiSnapshot, dbSnapshot, entityType, input.appId)
```

The function is now **synchronous** — remove `await`, can run all sampleIds in parallel if needed.

---

## Step 5 — Update UI labels

| File | Old label | New label |
|------|-----------|-----------|
| `CheckForm.tsx` | "AI Sample Size" | "Sample Size" |
| `CheckForm.tsx` | check type label `'ai'` | "Field Check" |
| `SessionResultsTabs.tsx` | "· N AI" | "· N compared" |
| `SessionResultsTabs.tsx` | tab label "AI" | "Field Check" |
| `ScraperGrid.tsx` | AI summary dots | remove `SomewhatSame` dot |
| `QualityChart.tsx` | "AI Quality" | "Field Quality" |
| `AutoCheckConfigForm.tsx` | "AI Sample Size" | "Sample Size" |
| `AiResultsTab.tsx` filter | remove "Somewhat same" option | keep Same + Different only |

Internal names (`AiResultsTab`, `aiComparisons`, `AiComparison`) — **do not rename** (avoid churn).

---

## Step 6 — Remove AI dependency

- Delete or empty `src/lib/ai/compare.ts` (keep `parseAiResponse` if useful for tests, otherwise remove)
- Verify `src/lib/ai/client.ts` is no longer imported anywhere → delete if so
- `AI_MODEL` env var — remove from `.env.local`, `.env.example`, docs

---

## Step 7 — Handle legacy DB records

Existing `AiComparison` rows with `verdict = 'SomewhatSame'` need handling:

**Option A (quick):** In UI, treat `SomewhatSame` as `Different` everywhere:
```ts
const isDifferent = (v: string) => v === 'Different' || v === 'SomewhatSame'
```

**Option B (clean):** One-time SQL migration:
```sql
UPDATE "AiComparison" SET verdict = 'Different' WHERE verdict = 'SomewhatSame';
```

Recommended: Option B before going to production.

---

## Execution order

```
Step 1 (15 min) → Step 2 (60 min) → Step 3 (30 min) → Step 4 (10 min) → Step 5 (20 min) → Step 6 (10 min) → Step 7 (5 min)
```

Steps 2 and 3 can be TDD: write failing tests first, then implement.

---

## Open questions

1. **Threshold values** — confirm `maxMeters` and `maxDelta` with scraper team
2. **`geometry_coordinates`** — deep JSON comparison may be slow for large polygons; consider hash comparison
3. **Unmapped dynamic fields** — fields in raw DB row not in mapping are silently ignored; acceptable for now
