'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { getFieldMapping } from '@/lib/field-mappings'
import type { AiComparison } from '@/generated/prisma/client'

type Obj = Record<string, unknown>

const verdictVariant = {
  Same:         'default',
  SomewhatSame: 'secondary',
  Different:    'destructive',
} as const

// ─── Diff table ───────────────────────────────────────────────────────────────

function DiffTable({ api, db, entityType, appId }: { api: Obj; db: Obj; entityType: string; appId: string }) {
  const [rawOpen, setRawOpen] = useState(false)

  const mapping = getFieldMapping(appId, entityType)
  const visibleRows = mapping.filter(
    ({ apiKey, constant }) => constant !== undefined || (apiKey !== undefined && apiKey in api),
  )

  const cell  = 'px-2 py-[3px] align-top'
  const mono  = 'font-mono text-[11px]'
  const muted = 'text-muted-foreground'

  return (
    <table className="w-full text-[11px] border-separate border-spacing-y-px">
      <thead>
        <tr>
          <th colSpan={3} className={`${cell} text-center text-[10px] font-semibold uppercase tracking-wide ${muted} border-b border-border`}>
            API
          </th>
          <th className={`${cell} text-center text-[10px] font-semibold uppercase tracking-wide ${muted} border-b border-l border-border`}>
            DB
          </th>
        </tr>
        <tr>
          {(['Raw', 'Transform rule', 'Transformed'] as const).map((h) => (
            <th key={h} className={`${cell} text-left text-[10px] font-medium ${muted} pb-1`}>{h}</th>
          ))}
          <th className={`${cell} border-l border-border`} />
        </tr>
      </thead>

      <tbody>
        {visibleRows.map(({ apiKey, dbKey, transform, note, constant }) => {
          const isConst    = constant !== undefined
          const apiPresent = apiKey !== undefined && apiKey in api
          const rawVal     = apiPresent ? api[apiKey!] : undefined
          const transformed = isConst ? undefined : (transform ? transform(rawVal) : rawVal)
          const dbPresent  = dbKey in db
          const dbVal      = db[dbKey]

          const compareVal = isConst ? constant : transformed
          const hasBoth = (isConst || apiPresent) && dbPresent
          const match   = hasBoth && JSON.stringify(compareVal) === JSON.stringify(dbVal)
          const bg = !hasBoth ? '' : match ? 'bg-green-500/15' : 'bg-yellow-500/15'
          const ruleText = note ?? (!transform && !isConst ? 'copy' : '')

          return (
            <tr key={`${apiKey ?? '_const'}-${dbKey}`} className={`rounded ${bg}`}>
              <td className={`${cell} ${mono}`}>
                {isConst
                  ? <span className={muted}>-</span>
                  : <><span className="text-blue-400">"{apiKey}"</span><span className={muted}>: </span><span>{JSON.stringify(rawVal)}</span></>}
              </td>
              <td className={`${cell} ${muted} whitespace-nowrap`}>{ruleText}</td>
              <td className={`${cell} ${mono}`}>
                {!isConst && apiPresent ? JSON.stringify(transformed) : ''}
              </td>
              <td className={`${cell} ${mono} border-l border-border`}>
                {dbPresent
                  ? <><span className="text-purple-400">"{dbKey}"</span><span className={muted}>: </span><span>{JSON.stringify(dbVal)}</span></>
                  : <span className="text-muted-foreground/30">—</span>}
              </td>
            </tr>
          )
        })}

        {/* Raw API entity accordion */}
        <tr>
          <td colSpan={4} className="pt-2">
            <button
              className={`flex items-center gap-1 text-[11px] ${muted} hover:text-foreground transition-colors`}
              onClick={(e) => { e.stopPropagation(); setRawOpen((o) => !o) }}
            >
              {rawOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Raw API entity
            </button>
          </td>
        </tr>
        {rawOpen && (
          <tr>
            <td colSpan={4} className="px-1 pb-1">
              <pre className="rounded bg-background/60 p-2 text-[10px] font-mono overflow-auto max-h-52">
                {JSON.stringify(api, null, 2)}
              </pre>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function ComparisonDetail({ c, appId }: { c: AiComparison; appId: string }) {
  const api = (c.apiSnapshot ?? {}) as Obj
  const db  = (c.dbSnapshot  ?? {}) as Obj

  return (
    <div className="mt-3 border-t pt-3">
      <div className="rounded-md bg-muted p-2 overflow-auto">
        <DiffTable api={api} db={db} entityType={c.entityType} appId={appId} />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { comparisons: AiComparison[]; appId: string }

export function AiResultsTab({ comparisons, appId }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (comparisons.length === 0) {
    return <p className="text-sm text-muted-foreground">No AI comparisons for this entity type.</p>
  }

  const counts = comparisons.reduce(
    (acc, c) => { acc[c.verdict] = (acc[c.verdict] ?? 0) + 1; return acc },
    {} as Record<string, number>,
  )

  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-sm text-muted-foreground">
        <span>{comparisons.length} compared</span>
        {Object.entries(counts).map(([v, n]) => (
          <Badge key={v} variant={verdictVariant[v as keyof typeof verdictVariant] ?? 'outline'}>
            {n} {v}
          </Badge>
        ))}
      </div>

      <div className="space-y-2">
        {comparisons.map((c) => {
          const isOpen = openId === c.id
          return (
            <Card
              key={c.id}
              className="cursor-pointer select-none"
              onClick={() => setOpenId(isOpen ? null : c.id)}
            >
              <CardContent className="py-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-muted-foreground shrink-0">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <Badge variant={verdictVariant[c.verdict as keyof typeof verdictVariant] ?? 'outline'}>
                    {c.verdict}
                  </Badge>
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-muted-foreground truncate">{c.entityId}</p>
                    <p className="text-sm mt-0.5">{c.explanation}</p>
                  </div>
                </div>
                {isOpen && <ComparisonDetail c={c} appId={appId} />}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
