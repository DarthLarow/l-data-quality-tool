'use client'
import { useState } from 'react'
import { ENTITY_TYPES } from '@/types'
import type { AlertThreshold } from '@/generated/prisma/client'

interface Props {
  appId:       string
  scraperName: string
  thresholds:  AlertThreshold[]
  onSaved:     () => void
}

interface RowState {
  deltaWarn:    string
  deltaCrit:    string
  missingWarn:  string
  missingCrit:  string
  mismatchWarn: string
  mismatchCrit: string
  saving:       boolean
  dirty:        boolean
}

function toRow(t: AlertThreshold): RowState {
  return {
    deltaWarn:    String(t.warningThresholdPct),
    deltaCrit:    String(t.criticalThresholdPct),
    missingWarn:  t.missingCountWarning  != null ? String(t.missingCountWarning)  : '',
    missingCrit:  t.missingCountCritical != null ? String(t.missingCountCritical) : '',
    mismatchWarn: t.mismatchCountWarning  != null ? String(t.mismatchCountWarning)  : '',
    mismatchCrit: t.mismatchCountCritical != null ? String(t.mismatchCountCritical) : '',
    saving: false,
    dirty:  false,
  }
}

function toPayload(appId: string, entityType: string, row: RowState) {
  const n = (v: string) => v === '' ? null : Number(v)
  return {
    appId, entityType,
    warningThresholdPct:  Number(row.deltaWarn),
    criticalThresholdPct: Number(row.deltaCrit),
    missingCountWarning:  n(row.missingWarn),
    missingCountCritical: n(row.missingCrit),
    mismatchCountWarning:  n(row.mismatchWarn),
    mismatchCountCritical: n(row.mismatchCrit),
  }
}

function NumInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      min={0}
      value={value}
      placeholder="—"
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-[5px] py-[5px] text-center font-mono text-[12px] outline-none"
      style={{
        background: '#080808',
        border:     '1px solid rgba(255,255,255,0.1)',
        color:      '#ededed',
      }}
    />
  )
}

const GRID = '120px repeat(6, 1fr) auto'

export function ScraperThresholdEditor({ appId, scraperName, thresholds, onSaved }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(thresholds.map((t) => [t.entityType, toRow(t)])),
  )
  const [adding,     setAdding]    = useState(false)
  const [newType,    setNewType]   = useState('')
  const [newRow,     setNewRow]    = useState<Omit<RowState, 'saving' | 'dirty'>>({
    deltaWarn: '20', deltaCrit: '50', missingWarn: '', missingCrit: '', mismatchWarn: '', mismatchCrit: '',
  })
  const [addSaving, setAddSaving]  = useState(false)

  const configuredTypes = Object.keys(rows)
  const availableTypes  = ENTITY_TYPES.filter((et) => !configuredTypes.includes(et))

  function update(entityType: string, field: keyof Omit<RowState, 'saving' | 'dirty'>, value: string) {
    setRows((prev) => ({
      ...prev,
      [entityType]: { ...prev[entityType]!, [field]: value, dirty: true },
    }))
  }

  function updateNew(field: keyof typeof newRow, value: string) {
    setNewRow((prev) => ({ ...prev, [field]: value }))
  }

  async function save(entityType: string) {
    const row = rows[entityType]!
    setRows((prev) => ({ ...prev, [entityType]: { ...row, saving: true } }))
    await fetch('/api/config/thresholds', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(toPayload(appId, entityType, row)),
    })
    setRows((prev) => ({ ...prev, [entityType]: { ...prev[entityType]!, saving: false, dirty: false } }))
    onSaved()
  }

  async function remove(entityType: string) {
    await fetch('/api/config/thresholds', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ appId, entityType }),
    })
    setRows((prev) => { const next = { ...prev }; delete next[entityType]; return next })
    onSaved()
  }

  async function addNew() {
    if (!newType) return
    setAddSaving(true)
    await fetch('/api/config/thresholds', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(toPayload(appId, newType, { ...newRow, saving: false, dirty: false })),
    })
    setRows((prev) => ({ ...prev, [newType]: { ...newRow, saving: false, dirty: false } }))
    setNewType('')
    setNewRow({ deltaWarn: '20', deltaCrit: '50', missingWarn: '', missingCrit: '', mismatchWarn: '', mismatchCrit: '' })
    setAdding(false)
    setAddSaving(false)
    onSaved()
  }

  return (
    <div className="rounded-[9px]"
      style={{
        margin:     '2px 22px 14px',
        background: '#0d0d0d',
        border:     '1px solid rgba(255,255,255,0.08)',
        padding:    '16px 18px',
      }}>

      {/* Panel header */}
      <div className="mb-[14px] font-mono text-[11px] font-semibold"
        style={{ color: '#9a9a9a', letterSpacing: '0.05em' }}>
        ALERT THRESHOLDS · {scraperName.toUpperCase()}
      </div>

      {configuredTypes.length === 0 && !adding && (
        <p className="text-[12px]" style={{ color: '#6b6b6b' }}>No thresholds configured.</p>
      )}

      {(configuredTypes.length > 0 || adding) && (
        <div style={{ overflow: 'auto' }}>
          {/* Column group labels */}
          <div className="grid gap-[8px] pb-[6px] font-mono text-[9.5px] font-medium"
            style={{
              gridTemplateColumns: GRID,
              letterSpacing: '0.04em',
              color: '#7a7a7a',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}>
            <div />
            <div style={{ gridColumn: 'span 2', textAlign: 'center' }}>NOT FOUND IN DB</div>
            <div style={{ gridColumn: 'span 2', textAlign: 'center' }}>API / DB MISMATCH</div>
            <div style={{ gridColumn: 'span 2', textAlign: 'center' }}>DELTA %</div>
            <div />
          </div>

          {/* WARN / CRIT sub-header */}
          <div className="grid gap-[8px] py-[5px] font-mono text-[10px] font-medium"
            style={{ gridTemplateColumns: GRID }}>
            <div className="text-[10px]" style={{ color: '#6b6b6b', letterSpacing: '0.04em' }}>ENTITY</div>
            {[0, 1, 2].map((g) => (
              <>
                <div key={`w${g}`} className="text-center" style={{ color: '#d29922' }}>W</div>
                <div key={`c${g}`} className="text-center" style={{ color: '#f85149' }}>C</div>
              </>
            ))}
            <div />
          </div>

          {/* Existing rows */}
          {configuredTypes.map((et) => {
            const row = rows[et]!
            return (
              <div key={et} className="grid items-center gap-[8px] py-[4px]"
                style={{ gridTemplateColumns: GRID, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="text-[12px] capitalize" style={{ color: '#bdbdbd' }}>{et}</div>
                <NumInput value={row.missingWarn}  onChange={(v) => update(et, 'missingWarn',  v)} />
                <NumInput value={row.missingCrit}  onChange={(v) => update(et, 'missingCrit',  v)} />
                <NumInput value={row.mismatchWarn} onChange={(v) => update(et, 'mismatchWarn', v)} />
                <NumInput value={row.mismatchCrit} onChange={(v) => update(et, 'mismatchCrit', v)} />
                <NumInput value={row.deltaWarn}    onChange={(v) => update(et, 'deltaWarn',    v)} />
                <NumInput value={row.deltaCrit}    onChange={(v) => update(et, 'deltaCrit',    v)} />
                <div className="flex items-center justify-end gap-[6px]">
                  {row.dirty && (
                    <button
                      type="button"
                      disabled={row.saving}
                      onClick={() => save(et)}
                      className="rounded-[5px] px-[8px] py-[3px] font-mono text-[11px] transition-colors"
                      style={{
                        background: 'rgba(255,255,255,0.07)',
                        border:     '1px solid rgba(255,255,255,0.14)',
                        color:      '#ededed',
                        cursor:     row.saving ? 'not-allowed' : 'pointer',
                        opacity:    row.saving ? 0.5 : 1,
                      }}
                    >
                      {row.saving ? '…' : 'Save'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(et)}
                    className="flex items-center justify-center rounded-[5px] transition-colors"
                    style={{
                      width:      '22px',
                      height:     '22px',
                      border:     '1px solid rgba(255,255,255,0.08)',
                      color:      '#6b6b6b',
                      cursor:     'pointer',
                      background: 'transparent',
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}

          {/* Add new row */}
          {adding && (
            <div className="grid items-center gap-[8px] py-[6px]"
              style={{ gridTemplateColumns: GRID, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {/* Entity type picker */}
              <div className="relative">
                <div className="pointer-events-none flex items-center justify-between rounded-[5px] px-[8px] py-[5px] font-mono text-[11.5px]"
                  style={{ border: '1px solid rgba(255,255,255,0.1)', background: '#080808', color: newType ? '#ededed' : '#5e5e5e' }}>
                  {newType || 'type ▾'}
                </div>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="absolute inset-0 w-full cursor-pointer opacity-0"
                >
                  <option value="">Select…</option>
                  {availableTypes.map((et) => <option key={et} value={et}>{et}</option>)}
                </select>
              </div>

              <NumInput value={newRow.missingWarn}  onChange={(v) => updateNew('missingWarn',  v)} />
              <NumInput value={newRow.missingCrit}  onChange={(v) => updateNew('missingCrit',  v)} />
              <NumInput value={newRow.mismatchWarn} onChange={(v) => updateNew('mismatchWarn', v)} />
              <NumInput value={newRow.mismatchCrit} onChange={(v) => updateNew('mismatchCrit', v)} />
              <NumInput value={newRow.deltaWarn}    onChange={(v) => updateNew('deltaWarn',    v)} />
              <NumInput value={newRow.deltaCrit}    onChange={(v) => updateNew('deltaCrit',    v)} />

              <div className="flex items-center justify-end gap-[6px]">
                <button
                  type="button"
                  disabled={!newType || addSaving}
                  onClick={addNew}
                  className="rounded-[5px] px-[8px] py-[3px] font-mono text-[11px]"
                  style={{
                    background: '#ededed',
                    color:      '#0a0a0a',
                    cursor:     !newType || addSaving ? 'not-allowed' : 'pointer',
                    opacity:    !newType || addSaving ? 0.4 : 1,
                    border:     'none',
                  }}
                >
                  {addSaving ? '…' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="rounded-[5px] px-[8px] py-[3px] font-mono text-[11px]"
                  style={{
                    background: 'transparent',
                    border:     '1px solid rgba(255,255,255,0.1)',
                    color:      '#8a8a8a',
                    cursor:     'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add threshold button */}
      {!adding && availableTypes.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-[10px] flex items-center gap-[6px] rounded-[6px] px-[10px] py-[5px] font-mono text-[11.5px] transition-colors"
          style={{
            border:     '1px solid rgba(255,255,255,0.1)',
            color:      '#8a8a8a',
            cursor:     'pointer',
            background: 'transparent',
          }}
        >
          + Add threshold
        </button>
      )}
    </div>
  )
}
