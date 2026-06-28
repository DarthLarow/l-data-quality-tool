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

No entity limit — compare **ALL** matched pairs (not a sample).

---

## Step 1 — Add thresholds and latPair to field-mappings

**File:** `src/lib/field-mappings.ts`

Add `DynamicThreshold` type, `threshold` and `latPair` to `MappingRow`:

```ts
export type DynamicThreshold =
  | { type: 'distance_m'; maxMeters: number }
  | { type: 'absolute';   maxDelta:  number }
  | { type: 'percent';    maxPct:    number }

export type MappingRow = {
  apiKey?:    string
  dbKey:      string
  transform?: (v: unknown) => unknown
  note?:      string
  constant?:  unknown
  dynamic?:   true
  threshold?: DynamicThreshold
  latPair?:   string   // partner dbKey for distance_m (lat row sets this to the lng dbKey)
  onlyWhen?:  (api: Record<string, unknown>) => boolean
}
```

Update `ario/dockless` mapping:
```ts
{ apiKey: 'battery',   dbKey: 'battery',      dynamic: true }, // no threshold — dynamic fields without threshold are skipped
{ apiKey: 'latitude',  dbKey: 'location_lat', dynamic: true, threshold: { type: 'distance_m', maxMeters: 5000 }, latPair: 'location_lng' },
{ apiKey: 'longitude', dbKey: 'location_lng', dynamic: true }, // no solo threshold — paired with lat row above
```

> Threshold configurability: each scraper has its own mapping entry in `FIELD_MAPPINGS`
> (e.g. `FIELD_MAPPINGS['ario']`, `FIELD_MAPPINGS['bird']`), so thresholds are naturally
> per-scraper and per-field. No shared config needed.
>
> `maxMeters: 5000` — API snapshot is live, DB snapshot is from the scraping session (potentially
> hours old). Vehicles can move kilometers in that window. 5km catches wrong coordinate system /
> wrong city errors without false-positives on normal movement.

---

## Step 2 — Create `src/lib/checks/field-compare.ts`

```ts
export interface FieldCompareResult {
  verdict:     AiVerdict
  explanation: string
  mismatches:  string[]
}

export function compareEntityFields(
  api: Record<string, unknown>,
  db:  Record<string, unknown>,
  entityType: EntityType,
  appId: string,
): FieldCompareResult
```

### Algorithm

```
mismatches: string[] = []
pendingLat: { apiLat, dbLat, lngKey, maxMeters } | null = null

for each row in getFieldMapping(appId, entityType):

  if onlyWhen && !onlyWhen(api) → skip

  if constant:
    if !deepEqual(db[dbKey], constant) → mismatches.push(...)
    continue

  if !apiKey || !(apiKey in api) → skip

  apiVal = row.transform ? row.transform(api[apiKey]) : api[apiKey]
  dbVal  = db[dbKey]

  if dynamic:
    if threshold.type === 'distance_m':
      if latPair defined (this is lat row):
        pendingLat = { apiLat: apiVal, dbLat: dbVal, lngKey: latPair, maxMeters }
      else (this is the lng partner row):
        retrieve pendingLat; apiLng = apiVal; dbLng = dbVal
        distance = haversineMeters(pendingLat.apiLat, apiLng, pendingLat.dbLat, dbLng)
        if distance > pendingLat.maxMeters → mismatches.push(`location: ${distance}m from API (threshold ${maxMeters}m)`)
        pendingLat = null
    if threshold.type === 'absolute':
      if |Number(apiVal) - Number(dbVal)| > maxDelta → mismatches.push(...)
    if threshold.type === 'percent':
      if relative diff > maxPct% → mismatches.push(...)
    if no threshold → skip (dynamic field without rule)
  else (static):
    if !deepEqual(apiVal, dbVal) → mismatches.push(`${dbKey}: expected …, got …`)

verdict     = mismatches.length === 0 ? 'Same' : 'Different'
explanation = mismatches.length === 0 ? 'All fields match' : mismatches.join('; ')
```

### Edge case: no mapping for scraper/entityType

```ts
return { verdict: 'Same', explanation: 'No field mapping defined — comparison skipped', mismatches: [] }
```

### Helpers

```ts
function haversineMeters(lat1, lng1, lat2, lng2): number
function deepEqual(a, b): boolean  // JSON.stringify for objects/arrays, === for primitives
```

---

## Step 3 — Tests

**File:** `src/lib/__tests__/field-compare.test.ts`

Cases to cover:
- Same — all static fields match, dynamic within threshold
- Different — vehicle_id mismatch (static)
- Different — category mismatch after transform
- Different — helmet_status mismatch after transform
- Same — GPS ~340m within 500m threshold
- Different — GPS ~1.1km exceeds 500m threshold
- Same — battery delta 20 ≤ threshold 30
- Different — battery delta 40 > threshold 30
- `onlyWhen` skips rows where predicate is false (ario pricings sub-types)
- constant mismatch → Different
- no mapping (unknown scraper) → Same with skipped explanation

---

## Step 4 — Wire into orchestrator

**File:** `src/lib/checks/orchestrator.ts`

```ts
// Remove:
import { compareEntities } from '@/lib/ai/compare'
function sampleRandom<T>(arr: T[], n: number): T[]

// Add:
import { compareEntityFields } from '@/lib/checks/field-compare'

// Inside ai check block — compare ALL matched pairs, no limit:
const allFoundIds = [...new Set(result.polygonResults.flatMap((p) => p.foundInDb))]
const dbMap       = await findEntitiesByIds(allFoundIds, entityType, input.appId)

for (const entityId of allFoundIds) {
  const dbSnapshot  = dbMap.get(entityId)
  if (!dbSnapshot) continue
  const apiSnapshot = result.apiEntityMap.get(entityId) ?? { id: entityId }
  const comparison  = compareEntityFields(apiSnapshot, dbSnapshot, entityType, input.appId) // sync!
  await prisma.aiComparison.create({ ... })
}

// Guard becomes simply:
if (checks.has('ai')) { ... }   // remove the && input.aiSampleSize > 0 condition

// aiSampleSize DB field stays for backwards compat; always write 0:
aiSampleSize: 0,
```

---

## Step 5 — Mark old AI code as unused

**File:** `src/lib/ai/compare.ts`

Add `// @deprecated` banner at top. Do NOT delete yet — may be useful if AI analysis returns in future.

---

## Step 6 — Update types

**File:** `src/types/index.ts`

```ts
// Before:
export type AiVerdict = 'Same' | 'SomewhatSame' | 'Different'

// After:
export type AiVerdict = 'Same' | 'Different'

// Remove aiSampleSize from CheckSessionInput:
export interface CheckSessionInput {
  environment: Environment
  appId: string
  scrapersSessionId: number
  polygonIds: string[]
  entityTypes: EntityType[]
  checksEnabled: CheckType[]
  // aiSampleSize removed — no entity limit for field compare
  previousScrapersSessionId?: number
}
```

---

## Step 7 — Frontend changes

| File | Change |
|------|--------|
| `CheckForm.tsx` | Rename check type label `'ai'` → **"Field Check"**, update description |
| `CheckForm.tsx` | **Remove** "AI Sample Size" slider section and `aiSampleSize` state entirely |
| `CheckForm.tsx` | Remove `aiSampleSize` from form submit payload |
| `SessionResultsTabs.tsx` | Rename tab "AI" → **"Field Check"** |
| `SessionResultsTabs.tsx` | Remove "SOMEWHAT SAME" column — keep ENTITY / SAME / DIFFERENT |
| `AiResultsTab.tsx` | Remove "Somewhat same" from filter bar |
| `ScraperGrid.tsx` | Remove SomewhatSame dot/label from summary |
| `QualityChart.tsx` | Rename "AI Quality" → **"Field Quality"** |
| `AutoCheckConfigForm.tsx` | Remove "AI Sample Size" field entirely |

Internal component names (`AiResultsTab`, `aiComparisons`, `AiComparison`) — **do not rename** (avoid churn).

---

## Step 8 — Handle legacy DB records

Existing `AiComparison` rows with `verdict = 'SomewhatSame'`:

**Option A (quick, no migration):** In UI treat `SomewhatSame` as `Different`:
```ts
const isDifferent = (v: string) => v === 'Different' || v === 'SomewhatSame'
```

**Option B (clean):** One-time SQL migration:
```sql
UPDATE "AiComparison" SET verdict = 'Different' WHERE verdict = 'SomewhatSame';
```

Recommended: Option B before going to production; Option A for now.

---

## Execution order

```
Step 1 → Step 2 → Step 3 (TDD: tests first, then implement) → Step 4 → Step 5 → Step 6 → Step 7 → Step 8
```

---

## Open questions

1. **`maxMeters` value** — 5000m is the default; confirm with scraper team if different per app
2. **GPS float precision** — if scrapers round coordinates differently on API vs DB, `deepEqual` may produce false positives; revisit if it becomes noisy in practice
