'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AiComparison } from '@/generated/prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>

type FieldStatus = 'match' | 'diff' | 'unique'

const verdictVariant = {
  Same:         'default',
  SomewhatSame: 'secondary',
  Different:    'destructive',
} as const

// ─── Field comparison ─────────────────────────────────────────────────────────

function fieldStatus(key: string, val: unknown, other: Obj): FieldStatus {
  if (!(key in other)) return 'unique'
  return JSON.stringify(val) === JSON.stringify(other[key]) ? 'match' : 'diff'
}

// ─── JSON viewer with per-row highlighting ────────────────────────────────────

function HighlightedJson({
  data,
  compare,
  highlight,
}: {
  data: Obj
  compare?: Obj   // reference object for highlighting
  highlight: boolean
}) {
  return (
    <div className="font-mono text-xs leading-5 overflow-auto max-h-96">
      <span className="text-muted-foreground">{'{'}</span>
      {Object.entries(data).map(([k, v]) => {
        const status = highlight && compare ? fieldStatus(k, v, compare) : 'unique'
        const bg =
          status === 'match' ? 'bg-green-500/15' :
          status === 'diff'  ? 'bg-yellow-500/15' :
          ''
        return (
          <div key={k} className={`px-1 rounded ${bg}`}>
            <span className="text-blue-400">"{k}"</span>
            <span className="text-muted-foreground">: </span>
            <span className="text-foreground">{JSON.stringify(v)}</span>
            <span className="text-muted-foreground">,</span>
          </div>
        )
      })}
      <span className="text-muted-foreground">{'}'}</span>
    </div>
  )
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function ComparisonDetail({ c }: { c: AiComparison }) {
  const api = (c.apiSnapshot ?? {}) as Obj
  const db  = (c.dbSnapshot  ?? {}) as Obj

  return (
    <div className="mt-3 grid grid-cols-3 gap-3 border-t pt-3">
      {/* Panel 1: raw API */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          API raw
        </p>
        <div className="rounded-md bg-muted p-2">
          <HighlightedJson data={api} highlight={false} />
        </div>
      </div>

      {/* Panel 2: API normalized (highlighted vs DB) */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          API vs DB
        </p>
        <div className="rounded-md bg-muted p-2">
          <HighlightedJson data={api} compare={db} highlight />
        </div>
      </div>

      {/* Panel 3: DB (highlighted vs API) */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          DB
        </p>
        <div className="rounded-md bg-muted p-2">
          <HighlightedJson data={db} compare={api} highlight />
        </div>
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
                    <p className="data-value text-xs text-muted-foreground truncate">{c.entityId}</p>
                    <p className="text-sm">{c.explanation}</p>
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
