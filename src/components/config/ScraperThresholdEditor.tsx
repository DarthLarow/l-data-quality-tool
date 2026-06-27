'use client'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ENTITY_TYPES } from '@/types'
import type { AlertThreshold } from '@/generated/prisma/client'

interface Props {
  appId:      string
  thresholds: AlertThreshold[]
  onSaved:    () => void
}

interface RowState {
  deltaWarn:      string
  deltaCrit:      string
  missingWarn:    string
  missingCrit:    string
  mismatchWarn:   string
  mismatchCrit:   string
  saving:  boolean
  dirty:   boolean
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

const INPUT_CLS = 'h-7 w-16 font-mono text-xs text-center'

function NumInput({ value, onChange, color }: { value: string; onChange: (v: string) => void; color?: string }) {
  return (
    <Input
      type="number" min={0}
      value={value}
      placeholder="—"
      onChange={(e) => onChange(e.target.value)}
      className={`${INPUT_CLS} ${color ?? ''}`}
    />
  )
}

export function ScraperThresholdEditor({ appId, thresholds, onSaved }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(thresholds.map((t) => [t.entityType, toRow(t)])),
  )
  const [adding,     setAdding]    = useState(false)
  const [newType,    setNewType]   = useState('')
  const [newRow,     setNewRow]    = useState<Omit<RowState, 'saving' | 'dirty'>>({
    deltaWarn: '20', deltaCrit: '50', missingWarn: '', missingCrit: '', mismatchWarn: '', mismatchCrit: '',
  })
  const [addSaving, setAddSaving] = useState(false)

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
    setRows((prev) => ({ ...prev, [entityType]: { ...prev[entityType]!, saving: true } }))
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

  const warnCls = 'text-[var(--status-warning)]'
  const critCls = 'text-[var(--status-critical)]'

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-4">
      {configuredTypes.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">No thresholds configured.</p>
      )}

      {configuredTypes.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            {/* Group labels */}
            <tr className="text-[9px] uppercase tracking-widest text-muted-foreground/60">
              <th />
              <th colSpan={2} className="pb-0.5 text-center font-medium border-b border-border/20">Not found in DB</th>
              <th />
              <th colSpan={2} className="pb-0.5 text-center font-medium border-b border-border/20">API / DB mismatch</th>
              <th />
              <th colSpan={2} className="pb-0.5 text-center font-medium border-b border-border/20">Delta %</th>
              <th />
            </tr>
            {/* Column labels */}
            <tr className="text-[10px] text-muted-foreground">
              <th className="pb-1 pr-3 text-left font-medium">Entity</th>
              <th className="pb-1 pr-1 text-center font-medium">Warn</th>
              <th className="pb-1 pr-4 text-center font-medium">Crit</th>
              <th className="w-1" />
              <th className="pb-1 pr-1 text-center font-medium">Warn</th>
              <th className="pb-1 pr-4 text-center font-medium">Crit</th>
              <th className="w-1" />
              <th className="pb-1 pr-1 text-center font-medium">Warn</th>
              <th className="pb-1 pr-2 text-center font-medium">Crit</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {configuredTypes.map((et) => {
              const row = rows[et]!
              return (
                <tr key={et}>
                  <td className="py-1.5 pr-3 capitalize text-muted-foreground w-20">{et}</td>
                  {/* Not found */}
                  <td className="py-1.5 pr-1"><NumInput value={row.missingWarn}  onChange={(v) => update(et, 'missingWarn',  v)} color={warnCls} /></td>
                  <td className="py-1.5 pr-4"><NumInput value={row.missingCrit}  onChange={(v) => update(et, 'missingCrit',  v)} color={critCls} /></td>
                  <td />
                  {/* Mismatch */}
                  <td className="py-1.5 pr-1"><NumInput value={row.mismatchWarn} onChange={(v) => update(et, 'mismatchWarn', v)} color={warnCls} /></td>
                  <td className="py-1.5 pr-4"><NumInput value={row.mismatchCrit} onChange={(v) => update(et, 'mismatchCrit', v)} color={critCls} /></td>
                  <td />
                  {/* Delta % */}
                  <td className="py-1.5 pr-1"><NumInput value={row.deltaWarn}    onChange={(v) => update(et, 'deltaWarn',    v)} color={warnCls} /></td>
                  <td className="py-1.5 pr-2"><NumInput value={row.deltaCrit}    onChange={(v) => update(et, 'deltaCrit',    v)} color={critCls} /></td>
                  {/* Actions */}
                  <td className="py-1.5">
                    <div className="flex items-center gap-1">
                      {row.dirty && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={row.saving} onClick={() => save(et)}>
                          {row.saving ? '…' : 'Save'}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => remove(et)}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* Add row */}
      {adding ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border/30 pt-3">
          <div className="space-y-1">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Entity</p>
            <Select value={newType} onValueChange={setNewType}>
              <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                {availableTypes.map((et) => <SelectItem key={et} value={et}>{et}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {(
            [
              ['Not found', 'missingWarn',  'missingCrit'],
              ['Mismatch',  'mismatchWarn', 'mismatchCrit'],
              ['Delta %',   'deltaWarn',    'deltaCrit'],
            ] as [string, keyof typeof newRow, keyof typeof newRow][]
          ).map(([label, warnKey, critKey]) => (
            <div key={label} className="flex items-end gap-1">
              <div className="space-y-1">
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{label} W</p>
                <Input type="number" min={0} value={newRow[warnKey]} placeholder="—"
                  onChange={(e) => updateNew(warnKey, e.target.value)}
                  className={`${INPUT_CLS} ${warnCls}`} />
              </div>
              <div className="space-y-1">
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">C</p>
                <Input type="number" min={0} value={newRow[critKey]} placeholder="—"
                  onChange={(e) => updateNew(critKey, e.target.value)}
                  className={`${INPUT_CLS} ${critCls}`} />
              </div>
            </div>
          ))}

          <Button size="sm" className="h-7 px-3 text-xs" disabled={!newType || addSaving} onClick={addNew}>
            {addSaving ? '…' : 'Add'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        availableTypes.length > 0 && (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground" onClick={() => setAdding(true)}>
            <Plus size={11} />
            Add threshold
          </Button>
        )
      )}
    </div>
  )
}
