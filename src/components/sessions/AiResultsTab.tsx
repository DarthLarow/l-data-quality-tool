'use client'
import { useState } from 'react'
import { getFieldMapping } from '@/lib/field-mappings'
import type { AiComparison } from '@/generated/prisma/client'

type Obj = Record<string, unknown>

// ── Haversine ────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Row type ─────────────────────────────────────────────────────────────────

type RowType = 'match' | 'dynamic' | 'mismatch' | 'neutral'

function getRowType(
  dynamic:   true | undefined,
  dbKey:     string,
  compareVal: unknown,
  dbVal:     unknown,
  hasBoth:   boolean,
  match:     boolean,
  gpsDist:   number | null,
): RowType {
  if (!hasBoth) return 'neutral'
  if (match)    return 'match'
  if (!dynamic) return 'mismatch'

  if (dbKey === 'battery') {
    const a = typeof compareVal === 'number' ? compareVal : null
    const b = typeof dbVal      === 'number' ? dbVal      : null
    if (a == null || b == null || a < 0 || a > 100 || b < 0 || b > 100) return 'mismatch'
    return 'dynamic'
  }

  if (dbKey === 'location_lat' || dbKey === 'location_lng') {
    if (gpsDist === null || gpsDist >= 50) return 'mismatch'
    return 'dynamic'
  }

  return 'dynamic'
}

const ROW_STYLE: Record<RowType, { bg: string; border: string }> = {
  match:    { bg: 'var(--dq-green-bg)',  border: 'var(--dq-green)' },
  dynamic:  { bg: 'var(--dq-amber-bg)', border: 'var(--dq-amber)' },
  mismatch: { bg: 'var(--dq-red-bg)',   border: 'var(--dq-red)'   },
  neutral:  { bg: 'transparent',        border: 'transparent'     },
}

const DIFF_COLS = '1.5fr 1.1fr 1.1fr 1.5fr'
const LARGE_PREVIEW_CHARS = 120

function isLargeArr(v: unknown): v is unknown[] {
  return Array.isArray(v) && JSON.stringify(v).length > LARGE_PREVIEW_CHARS
}

// Renders a large array truncated by character count — state controlled by parent row.
function LargeArrayCell({ val, color, expanded, onToggle }: {
  val: unknown[]; color?: string; expanded: boolean; onToggle: () => void
}) {
  const full = JSON.stringify(val)
  const btnStyle: React.CSSProperties = {
    color: 'var(--dq-text-5)', textDecoration: 'underline',
    background: 'none', border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 'inherit', padding: 0,
  }

  return (
    <span style={{ color }}>
      {expanded ? full : `${full.slice(0, LARGE_PREVIEW_CHARS)}…`}
      {' '}
      <button onClick={(e) => { e.stopPropagation(); onToggle() }} style={btnStyle}>
        {expanded ? 'show less' : 'show more'}
      </button>
    </span>
  )
}

// ── Diff table ───────────────────────────────────────────────────────────────

function DiffTable({ api, db, entityType, appId }: { api: Obj; db: Obj; entityType: string; appId: string }) {
  const [rawOpen, setRawOpen] = useState(false)
  // Per-row expanded state for large arrays (keyed by dbKey)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const toggleRow = (dbKey: string) =>
    setExpandedRows((prev) => { const s = new Set(prev); s.has(dbKey) ? s.delete(dbKey) : s.add(dbKey); return s })

  const mapping = getFieldMapping(appId, entityType)
  const visibleRows = mapping.filter(
    ({ apiKey, constant, onlyWhen }) =>
      (constant !== undefined || (apiKey !== undefined && apiKey in api)) &&
      (!onlyWhen || onlyWhen(api)),
  )

  const latRow = visibleRows.find((r) => r.dbKey === 'location_lat')
  const lngRow = visibleRows.find((r) => r.dbKey === 'location_lng')
  const gpsDist: number | null = (() => {
    if (!latRow?.apiKey || !lngRow?.apiKey) return null
    const aLat = api[latRow.apiKey], aLng = api[lngRow.apiKey]
    const dLat = db['location_lat'],  dLng = db['location_lng']
    if (typeof aLat !== 'number' || typeof aLng !== 'number' ||
        typeof dLat !== 'number' || typeof dLng !== 'number') return null
    return haversineKm(aLat, aLng, dLat, dLng)
  })()

  const dbBorder = '1px solid var(--dq-border-3)'

  return (
    <div className="overflow-hidden rounded-[7px]" style={{ border: '1px solid var(--dq-border-2)' }}>
      {/* Column headers */}
      <div className="grid items-center gap-[8px] px-[10px] py-[7px] font-mono text-[10px] font-medium"
        style={{ gridTemplateColumns: DIFF_COLS, background: 'var(--dq-bg-5)', color: 'var(--dq-text-8)', letterSpacing: '0.04em' }}>
        <span>RAW</span>
        <span>RULE</span>
        <span>TRANSFORMED</span>
        <div style={{ paddingLeft: '12px', borderLeft: dbBorder }}>DB</div>
      </div>

      {/* Rows */}
      {visibleRows.map(({ apiKey, dbKey, transform, normalize, note, constant, dynamic }) => {
        const isConst     = constant !== undefined
        const apiPresent  = apiKey !== undefined && apiKey in api
        const rawVal      = apiPresent ? api[apiKey!] : undefined
        const transformed = isConst ? undefined : (transform ? transform(rawVal) : rawVal)
        const dbPresent   = dbKey in db
        const dbVal       = db[dbKey]

        const compareVal     = isConst ? constant : transformed
        const normalizedCmp  = normalize ? normalize(compareVal) : compareVal
        const normalizedDb   = normalize ? normalize(dbVal)      : dbVal
        const hasBoth        = (isConst || apiPresent) && dbPresent
        const match          = hasBoth && JSON.stringify(normalizedCmp) === JSON.stringify(normalizedDb)
        const rType          = getRowType(dynamic, dbKey, normalizedCmp, normalizedDb, hasBoth, match, gpsDist)
        const rs         = ROW_STYLE[rType]
        const ruleText   = note ?? (isConst ? 'constant' : (!transform ? 'copy' : ''))

        return (
          <div
            key={`${apiKey ?? '_const'}-${dbKey}`}
            className="grid items-start gap-[8px] px-[10px] py-[5px] font-mono text-[11px]"
            style={{
              gridTemplateColumns: DIFF_COLS,
              background:   rs.bg,
              borderLeft:   `2px solid ${rs.border}`,
              borderBottom: '1px solid var(--dq-border-1)',
            }}
          >
            {/* API Raw */}
            <div style={{ color: 'var(--dq-text-2)' }}>
              {isConst
                ? <span style={{ color: 'var(--dq-text-8)' }}>—</span>
                : <>
                    <span style={{ color: '#5a8ab0' }}>&quot;{apiKey}&quot;</span>
                    <span style={{ color: 'var(--dq-text-8)' }}>: </span>
                    {isLargeArr(rawVal)
                      ? <LargeArrayCell val={rawVal} expanded={expandedRows.has(dbKey)} onToggle={() => toggleRow(dbKey)} />
                      : <span>{JSON.stringify(rawVal)}</span>}
                  </>}
            </div>

            {/* Rule */}
            <div style={{ color: 'var(--dq-text-5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {ruleText}
            </div>

            {/* Transformed */}
            <div style={{ color: 'var(--dq-text-3)' }}>
              {!isConst && apiPresent
                ? isLargeArr(transformed)
                  ? <LargeArrayCell val={transformed} expanded={expandedRows.has(dbKey)} onToggle={() => toggleRow(dbKey)} />
                  : JSON.stringify(transformed)
                : ''}
            </div>

            {/* DB */}
            <div style={{ paddingLeft: '12px', borderLeft: dbBorder, color: rType === 'mismatch' ? 'var(--dq-red)' : 'var(--dq-text-2)' }}>
              {dbPresent
                ? <>
                    <span style={{ color: '#7a5a9a' }}>&quot;{dbKey}&quot;</span>
                    <span style={{ color: 'var(--dq-text-8)' }}>: </span>
                    {isLargeArr(dbVal)
                      ? <LargeArrayCell val={dbVal} expanded={expandedRows.has(dbKey)} onToggle={() => toggleRow(dbKey)} color={rType === 'mismatch' ? 'var(--dq-red)' : undefined} />
                      : <span>{JSON.stringify(dbVal)}</span>}
                  </>
                : <span style={{ color: 'var(--dq-text-7)' }}>—</span>}
            </div>
          </div>
        )
      })}

      {/* Raw API accordion */}
      <div className="px-[10px] py-[7px]" style={{ borderTop: '1px solid var(--dq-border-1)' }}>
        <button
          className="flex items-center gap-[6px] font-mono text-[11px] transition-colors hover:text-[#bdbdbd]"
          style={{ color: 'var(--dq-text-7)', cursor: 'pointer', background: 'none', border: 'none' }}
          onClick={(e) => { e.stopPropagation(); setRawOpen((o) => !o) }}
        >
          <span style={{ transform: rawOpen ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
          Raw API entity
        </button>
        {rawOpen && (
          <pre className="mt-[6px] max-h-52 overflow-auto rounded-[5px] p-[8px] font-mono text-[10px]"
            style={{ background: 'var(--dq-border-1)', color: 'var(--dq-text-3)' }}>
            {JSON.stringify(api, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

// ── Verdict badge ─────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: string }) {
  const STYLES: Record<string, { color: string; bg: string }> = {
    Same:      { color: 'var(--dq-green)', bg: 'var(--dq-green-bg)' },
    Different: { color: 'var(--dq-red)',   bg: 'var(--dq-red-bg)'   },
    Skipped:   { color: 'var(--dq-text-4)', bg: 'var(--dq-border-1)' },
  }
  const s = STYLES[verdict] ?? { color: 'var(--dq-text-4)', bg: 'var(--dq-border-1)' }
  return (
    <span className="shrink-0 rounded-[5px] px-[7px] py-[2px] font-mono text-[11px] font-medium"
      style={{ color: s.color, background: s.bg }}>
      {verdict}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const VERDICT_FILTERS = [
  { value: 'all',       label: 'All'       },
  { value: 'Same',      label: 'Same'      },
  { value: 'Different', label: 'Different' },
  { value: 'Skipped',   label: 'Skipped'   },
] as const

type VerdictFilter = typeof VERDICT_FILTERS[number]['value']

const VERDICT_COLOR: Record<string, string> = {
  Same:      'var(--dq-green)',
  Different: 'var(--dq-red)',
  Skipped:   'var(--dq-text-6)',
}

const PAGE_SIZE = 25

interface Props { comparisons: AiComparison[]; appId: string }

export function AiResultsTab({ comparisons, appId }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<VerdictFilter>('all')
  const [page,   setPage]   = useState(0)

  if (comparisons.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: 'var(--dq-text-7)' }}>
        No AI comparisons for this entity type.
      </p>
    )
  }

  const counts = comparisons.reduce<Record<string, number>>((acc, c) => {
    acc[c.verdict] = (acc[c.verdict] ?? 0) + 1
    return acc
  }, {})

  const filtered   = filter === 'all' ? comparisons : comparisons.filter((c) => c.verdict === filter)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const visible    = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const goToPage = (p: number) => { setPage(p); setOpenId(null) }
  const changeFilter = (v: VerdictFilter) => { setFilter(v); setPage(0); setOpenId(null) }

  const navBtnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '3px 10px', fontFamily: 'inherit', fontSize: '12px',
    border: '1px solid var(--dq-border-2)', borderRadius: '6px',
    background: 'transparent', cursor: disabled ? 'default' : 'pointer',
    color: disabled ? 'var(--dq-text-8)' : 'var(--dq-text-4)',
  })

  return (
    <div className="flex flex-col gap-[10px]">
      {/* Filter bar */}
      <div className="flex items-center gap-[6px]">
        {VERDICT_FILTERS.map(({ value, label }) => {
          const count   = value === 'all' ? comparisons.length : (counts[value] ?? 0)
          const active  = filter === value
          const dotColor = value !== 'all' ? VERDICT_COLOR[value] : undefined
          return (
            <button
              key={value}
              onClick={() => changeFilter(value)}
              className="flex items-center gap-[6px] rounded-[6px] px-[10px] py-[5px] text-[12px] transition-colors"
              style={{
                border:     active ? '1px solid var(--dq-border-strong)' : '1px solid var(--dq-border-2)',
                background: active ? 'var(--dq-border-2)' : 'transparent',
                color:      active ? 'var(--dq-text-1)' : 'var(--dq-text-5)',
                cursor:     'pointer',
                fontWeight: active ? 500 : 400,
              }}
            >
              {dotColor && (
                <span className="shrink-0 rounded-full"
                  style={{ width: '6px', height: '6px', background: dotColor }} />
              )}
              {label}
              <span className="font-mono text-[11px]"
                style={{ color: active ? 'var(--dq-text-4)' : 'var(--dq-text-7)' }}>
                {count}
              </span>
            </button>
          )
        })}

        {totalPages > 1 && (
          <div className="ml-auto flex items-center gap-[6px]">
            <button disabled={page === 0} onClick={() => goToPage(page - 1)} style={navBtnStyle(page === 0)}>‹</button>
            <span className="font-mono text-[11px]" style={{ color: 'var(--dq-text-5)' }}>
              {page + 1} / {totalPages}
            </span>
            <button disabled={page === totalPages - 1} onClick={() => goToPage(page + 1)} style={navBtnStyle(page === totalPages - 1)}>›</button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex flex-col gap-[6px]">
        {visible.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--dq-text-7)' }}>No comparisons match this filter.</p>
        ) : visible.map((c) => {
          const isOpen = openId === c.id
          const api    = (c.apiSnapshot ?? {}) as Obj
          const db     = (c.dbSnapshot  ?? {}) as Obj

          return (
            <div
              key={c.id}
              className="overflow-hidden rounded-[8px]"
              style={{ background: 'var(--dq-bg-3)', border: '1px solid var(--dq-border-2)' }}
            >
              {/* Header row — click anywhere here to toggle */}
              <div
                className="flex items-center gap-[10px] px-[14px] py-[11px] select-none cursor-pointer"
                onClick={() => setOpenId(isOpen ? null : c.id)}
              >
                <span
                  className="shrink-0 text-[10px] transition-transform"
                  style={{
                    color:     'var(--dq-text-7)',
                    transform: isOpen ? 'rotate(90deg)' : 'none',
                    display:   'inline-block',
                  }}>
                  ▶
                </span>
                <VerdictBadge verdict={c.verdict} />
                <span className="shrink-0 font-mono text-[12px]" style={{ color: 'var(--dq-text-2)' }}>
                  {c.entityId}
                </span>
                <span className="min-w-0 truncate text-[12px]" style={{ color: 'var(--dq-text-5)' }}>
                  {c.explanation}
                </span>
              </div>

              {/* Expanded diff table */}
              {isOpen && (
                <div className="px-[14px] pb-[14px]"
                  style={{ borderTop: '1px solid var(--dq-border-1)' }}
                  onClick={(e) => e.stopPropagation()}>
                  <div className="pt-[12px]">
                    <DiffTable api={api} db={db} entityType={c.entityType} appId={appId} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-[6px]">
          <button disabled={page === 0} onClick={() => goToPage(page - 1)} style={navBtnStyle(page === 0)}>‹</button>
          <span className="font-mono text-[11px]" style={{ color: 'var(--dq-text-5)' }}>
            {page + 1} / {totalPages}
          </span>
          <button disabled={page === totalPages - 1} onClick={() => goToPage(page + 1)} style={navBtnStyle(page === totalPages - 1)}>›</button>
        </div>
      )}
    </div>
  )
}
