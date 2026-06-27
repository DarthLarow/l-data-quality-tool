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
  match:    { bg: 'rgba(63,185,80,0.07)',  border: '#3fb950'     },
  dynamic:  { bg: 'rgba(210,153,34,0.08)', border: '#d29922'     },
  mismatch: { bg: 'rgba(248,81,73,0.08)',  border: '#f85149'     },
  neutral:  { bg: 'transparent',           border: 'transparent' },
}

const DIFF_COLS = '1.5fr 1.1fr 1.1fr 1.5fr'

// ── Diff table ───────────────────────────────────────────────────────────────

function DiffTable({ api, db, entityType, appId }: { api: Obj; db: Obj; entityType: string; appId: string }) {
  const [rawOpen, setRawOpen] = useState(false)

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

  const dbBorder = '1px solid rgba(255,255,255,0.1)'

  return (
    <div className="overflow-hidden rounded-[7px]" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      {/* Column headers */}
      <div className="grid items-center gap-[8px] px-[10px] py-[7px] font-mono text-[10px] font-medium"
        style={{ gridTemplateColumns: DIFF_COLS, background: '#0c0c0c', color: '#5e5e5e', letterSpacing: '0.04em' }}>
        <span>RAW</span>
        <span>RULE</span>
        <span>TRANSFORMED</span>
        <div style={{ paddingLeft: '12px', borderLeft: dbBorder }}>DB</div>
      </div>

      {/* Rows */}
      {visibleRows.map(({ apiKey, dbKey, transform, note, constant, dynamic }) => {
        const isConst     = constant !== undefined
        const apiPresent  = apiKey !== undefined && apiKey in api
        const rawVal      = apiPresent ? api[apiKey!] : undefined
        const transformed = isConst ? undefined : (transform ? transform(rawVal) : rawVal)
        const dbPresent   = dbKey in db
        const dbVal       = db[dbKey]

        const compareVal = isConst ? constant : transformed
        const hasBoth    = (isConst || apiPresent) && dbPresent
        const match      = hasBoth && JSON.stringify(compareVal) === JSON.stringify(dbVal)
        const rType      = getRowType(dynamic, dbKey, compareVal, dbVal, hasBoth, match, gpsDist)
        const rs         = ROW_STYLE[rType]
        const ruleText   = note ?? (!transform && !isConst ? 'copy' : '')

        return (
          <div
            key={`${apiKey ?? '_const'}-${dbKey}`}
            className="grid items-start gap-[8px] px-[10px] py-[5px] font-mono text-[11px]"
            style={{
              gridTemplateColumns: DIFF_COLS,
              background:   rs.bg,
              borderLeft:   `2px solid ${rs.border}`,
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            {/* API Raw */}
            <div style={{ color: '#cfcfcf' }}>
              {isConst
                ? <span style={{ color: '#5e5e5e' }}>—</span>
                : <>
                    <span style={{ color: '#5a8ab0' }}>&quot;{apiKey}&quot;</span>
                    <span style={{ color: '#5e5e5e' }}>: </span>
                    <span>{JSON.stringify(rawVal)}</span>
                  </>}
            </div>

            {/* Rule */}
            <div style={{ color: '#8a8a8a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {ruleText}
            </div>

            {/* Transformed */}
            <div style={{ color: '#bdbdbd' }}>
              {!isConst && apiPresent ? JSON.stringify(transformed) : ''}
            </div>

            {/* DB */}
            <div style={{ paddingLeft: '12px', borderLeft: dbBorder, color: rType === 'mismatch' ? '#f4a59f' : '#cfcfcf' }}>
              {dbPresent
                ? <>
                    <span style={{ color: '#7a5a9a' }}>&quot;{dbKey}&quot;</span>
                    <span style={{ color: '#5e5e5e' }}>: </span>
                    <span>{JSON.stringify(dbVal)}</span>
                  </>
                : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>}
            </div>
          </div>
        )
      })}

      {/* Raw API accordion */}
      <div className="px-[10px] py-[7px]" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          className="flex items-center gap-[6px] font-mono text-[11px] transition-colors hover:text-[#bdbdbd]"
          style={{ color: '#6b6b6b', cursor: 'pointer', background: 'none', border: 'none' }}
          onClick={(e) => { e.stopPropagation(); setRawOpen((o) => !o) }}
        >
          <span style={{ transform: rawOpen ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
          Raw API entity
        </button>
        {rawOpen && (
          <pre className="mt-[6px] max-h-52 overflow-auto rounded-[5px] p-[8px] font-mono text-[10px]"
            style={{ background: 'rgba(255,255,255,0.03)', color: '#bdbdbd' }}>
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
    Same:         { color: '#3fb950', bg: 'rgba(63,185,80,0.13)'  },
    SomewhatSame: { color: '#d29922', bg: 'rgba(210,153,34,0.13)' },
    Different:    { color: '#f85149', bg: 'rgba(248,81,73,0.13)'  },
  }
  const s = STYLES[verdict] ?? { color: '#9a9a9a', bg: 'rgba(255,255,255,0.07)' }
  return (
    <span className="shrink-0 rounded-[5px] px-[7px] py-[2px] font-mono text-[11px] font-medium"
      style={{ color: s.color, background: s.bg }}>
      {verdict}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { comparisons: AiComparison[]; appId: string }

export function AiResultsTab({ comparisons, appId }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (comparisons.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: '#6b6b6b' }}>
        No AI comparisons for this entity type.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-[6px]">
      {comparisons.map((c) => {
        const isOpen = openId === c.id
        const api    = (c.apiSnapshot ?? {}) as Obj
        const db     = (c.dbSnapshot  ?? {}) as Obj

        return (
          <div
            key={c.id}
            className="overflow-hidden rounded-[8px] cursor-pointer select-none"
            style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={() => setOpenId(isOpen ? null : c.id)}
          >
            {/* Header row */}
            <div className="flex items-center gap-[10px] px-[14px] py-[11px]">
              <span
                className="shrink-0 text-[10px] transition-transform"
                style={{
                  color:     '#6b6b6b',
                  transform: isOpen ? 'rotate(90deg)' : 'none',
                  display:   'inline-block',
                }}>
                ▶
              </span>
              <VerdictBadge verdict={c.verdict} />
              <span className="shrink-0 font-mono text-[12px]" style={{ color: '#cfcfcf' }}>
                {c.entityId}
              </span>
              <span className="min-w-0 truncate text-[12px]" style={{ color: '#8a8a8a' }}>
                {c.explanation}
              </span>
            </div>

            {/* Expanded diff table */}
            {isOpen && (
              <div className="px-[14px] pb-[14px]"
                style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
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
  )
}
