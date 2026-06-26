'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ENTITY_FIELD_MAPPINGS } from '@/lib/field-mappings'
import type { AiComparison } from '@/generated/prisma/client'

type Obj = Record<string, unknown>

const verdictVariant = {
  Same:         'default',
  SomewhatSame: 'secondary',
  Different:    'destructive',
} as const

// ─── Diff table ───────────────────────────────────────────────────────────────

function ApiCell({ apiKey, rawVal, transformedVal, note, present }: {
  apiKey:         string
  rawVal:         unknown
  transformedVal: unknown
  note?:          string
  present:        boolean
}) {
  if (!present) return <span className="text-muted-foreground/40 italic text-[11px]">—</span>
  const hasTransform = transformedVal !== rawVal

  return (
    <span className="font-mono text-[11px] leading-relaxed">
      <span className="text-blue-400">"{apiKey}"</span>
      <span className="text-muted-foreground">: </span>
      <span>{JSON.stringify(rawVal)}</span>
      {hasTransform && (
        <>
          <span className="mx-1 text-muted-foreground/60">→</span>
          <span className="text-amber-400">{JSON.stringify(transformedVal)}</span>
          {note && <span className="ml-1 text-muted-foreground/50 text-[10px]">({note})</span>}
        </>
      )}
    </span>
  )
}

function DbCell({ dbKey, value, present }: { dbKey: string; value: unknown; present: boolean }) {
  if (!present) return <span className="text-muted-foreground/40 italic text-[11px]">—</span>
  return (
    <span className="font-mono text-[11px] leading-relaxed">
      <span className="text-purple-400">"{dbKey}"</span>
      <span className="text-muted-foreground">: </span>
      <span>{JSON.stringify(value)}</span>
    </span>
  )
}

function DiffTable({ api, db, entityType }: { api: Obj; db: Obj; entityType: string }) {
  const mapping = ENTITY_FIELD_MAPPINGS[entityType] ?? []
  // Only show rows where at least one side is present in this snapshot
  const visibleRows = mapping.filter(({ apiKey, dbKey }) => apiKey in api || dbKey in db)
  const mappedApiKeys = new Set(mapping.map((m) => m.apiKey))
  const unmappedApiKeys = Object.keys(api).filter((k) => !mappedApiKeys.has(k))

  return (
    <table className="w-full text-[11px] border-separate border-spacing-y-0.5">
      <thead>
        <tr>
          <td className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-[50%]">
            API
          </td>
          <td className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-[50%]">
            DB
          </td>
        </tr>
      </thead>
      <tbody>
        {visibleRows.map(({ apiKey, dbKey, transform, note }) => {
          const apiPresent = apiKey in api
          const dbPresent  = dbKey in db
          const rawVal     = api[apiKey]
          const transformed = transform ? transform(rawVal) : rawVal
          const dbVal      = db[dbKey]

          const bothPresent = apiPresent && dbPresent
          const match = bothPresent && JSON.stringify(transformed) === JSON.stringify(dbVal)
          const bg = !bothPresent ? '' : match ? 'bg-green-500/15' : 'bg-yellow-500/15'

          return (
            <tr key={`${apiKey}-${dbKey}`} className={bg}>
              <td className="rounded-l px-2 py-0.5 align-top">
                <ApiCell
                  apiKey={apiKey}
                  rawVal={rawVal}
                  transformedVal={transformed}
                  note={note}
                  present={apiPresent}
                />
              </td>
              <td className="rounded-r px-2 py-0.5 align-top">
                <DbCell dbKey={dbKey} value={dbVal} present={dbPresent} />
              </td>
            </tr>
          )
        })}

        {unmappedApiKeys.length > 0 && (
          <tr>
            <td colSpan={2} className="pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
              Unique API fields
            </td>
          </tr>
        )}

        {unmappedApiKeys.map((k) => (
          <tr key={k}>
            <td className="px-2 py-0.5 align-top" colSpan={2}>
              <span className="font-mono text-[11px]">
                <span className="text-blue-400">"{k}"</span>
                <span className="text-muted-foreground">: </span>
                <span>{JSON.stringify(api[k])}</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function ComparisonDetail({ c }: { c: AiComparison }) {
  const api = (c.apiSnapshot ?? {}) as Obj
  const db  = (c.dbSnapshot  ?? {}) as Obj
  const [rawOpen, setRawOpen] = useState(false)

  return (
    <div className="mt-3 border-t pt-3 space-y-3">
      <div>
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => { e.stopPropagation(); setRawOpen((o) => !o) }}
        >
          {rawOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          API raw
        </button>
        {rawOpen && (
          <pre className="mt-1.5 rounded-md bg-muted p-2 text-xs font-mono overflow-auto max-h-48">
            {JSON.stringify(api, null, 2)}
          </pre>
        )}
      </div>

      <div className="rounded-md bg-muted p-2 overflow-auto">
        <DiffTable api={api} db={db} entityType={c.entityType} />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { comparisons: AiComparison[] }

export function AiResultsTab({ comparisons }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (comparisons.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No AI comparisons for this entity type.</p>
    )
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
                {isOpen && <ComparisonDetail c={c} />}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
