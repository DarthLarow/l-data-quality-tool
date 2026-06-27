import { ApiDbResultsTab } from './ApiDbResultsTab'
import { AiResultsTab } from './AiResultsTab'
import { Badge } from '@/components/ui/badge'
import type {
  CheckSession, EntityCheckSummary, PolygonCheck,
  SessionDeltaCheck, AiComparison,
} from '@/generated/prisma/client'

interface SessionWithResults extends CheckSession {
  entityCheckSummaries: EntityCheckSummary[]
  polygonChecks:        PolygonCheck[]
  sessionDeltaChecks:   SessionDeltaCheck[]
  aiComparisons:        AiComparison[]
}

interface Props { session: SessionWithResults }

const ENTITY_ORDER = ['dockless', 'docked', 'pricings', 'zones'] as const

const VERDICT_STYLE = {
  Same:         'text-[var(--status-ok)]',
  SomewhatSame: 'text-[var(--status-warning)]',
  Different:    'text-[var(--status-critical)]',
} as const

export function SessionResultsTabs({ session }: Props) {
  const checks  = new Set(session.checksEnabled)
  const sections = ENTITY_ORDER.filter((et) => session.entityTypes.includes(et))

  const showApiDb = checks.has('api_db')
  const showAi    = checks.has('ai') || checks.has('api_db')

  const aiByVerdict = session.aiComparisons.reduce<Record<string, number>>((acc, c) => {
    acc[c.verdict] = (acc[c.verdict] ?? 0) + 1
    return acc
  }, {})

  return (
    <div>
      {/* ── Session summary ──────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap gap-8 rounded-lg border bg-muted/30 px-5 py-4">
        {showApiDb && session.entityCheckSummaries.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              API → DB
            </p>
            <table className="text-sm border-collapse">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="pb-1 pr-5 text-left text-[10px] font-medium text-muted-foreground">Entity</th>
                  <th className="pb-1 pr-4 text-right text-[10px] font-medium text-muted-foreground">Checked</th>
                  <th className="pb-1 pr-4 text-right text-[10px] font-medium text-muted-foreground">Found</th>
                  <th className="pb-1 pr-4 text-right text-[10px] font-medium text-muted-foreground">Missing</th>
                  <th className="pb-1 text-right text-[10px] font-medium text-muted-foreground">Coverage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {sections.map((et) => {
                  const s = session.entityCheckSummaries.find((x) => x.entityType === et)
                  if (!s || s.totalUniqueInApi === 0) return null
                  const pct = Math.round((s.totalFoundInDb / s.totalUniqueInApi) * 100)
                  return (
                    <tr key={et}>
                      <td className="py-1 pr-5 text-xs capitalize text-muted-foreground">{et}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{s.totalUniqueInApi}</td>
                      <td className="py-1 pr-4 text-right tabular-nums text-[var(--status-ok)]">{s.totalFoundInDb}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">
                        {s.totalNotFoundInDb > 0
                          ? <span className="text-[var(--status-critical)]">{s.totalNotFoundInDb}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="py-1 text-right">
                        <span className={`font-mono text-xs ${s.totalNotFoundInDb === 0 ? 'text-[var(--status-ok)]' : 'text-[var(--status-critical)]'}`}>
                          {pct}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {showAi && session.aiComparisons.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              AI Comparison
            </p>
            <table className="text-sm border-collapse">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="pb-1 pr-5 text-left text-[10px] font-medium text-muted-foreground">Entity</th>
                  <th className="pb-1 pr-4 text-right text-[10px] font-medium text-muted-foreground">Same</th>
                  <th className="pb-1 pr-4 text-right text-[10px] font-medium text-muted-foreground">Somewhat</th>
                  <th className="pb-1 text-right text-[10px] font-medium text-muted-foreground">Different</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {sections.map((et) => {
                  const cts = session.aiComparisons.filter((a) => a.entityType === et)
                  if (cts.length === 0) return null
                  const counts = cts.reduce<Record<string, number>>((acc, c) => {
                    acc[c.verdict] = (acc[c.verdict] ?? 0) + 1; return acc
                  }, {})
                  const dash = <span className="text-muted-foreground/40">—</span>
                  return (
                    <tr key={et}>
                      <td className="py-1 pr-5 text-xs capitalize text-muted-foreground">{et}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">
                        {counts.Same ? <span className={VERDICT_STYLE.Same}>{counts.Same}</span> : dash}
                      </td>
                      <td className="py-1 pr-4 text-right tabular-nums">
                        {counts.SomewhatSame ? <span className={VERDICT_STYLE.SomewhatSame}>{counts.SomewhatSame}</span> : dash}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {counts.Different ? <span className={VERDICT_STYLE.Different}>{counts.Different}</span> : dash}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Sticky section nav ───────────────────────────────────────────── */}
      {/* -top-6 compensates for main's p-6 padding so the nav sticks flush  */}
      {/* to the visual top of the scroll container, not 24px below it.      */}
      <nav className="sticky -top-6 z-10 -mx-6 mb-6 flex items-center gap-1 border-b bg-background px-6 py-2">
        {sections.map((et) => {
          const summary  = session.entityCheckSummaries.find((s) => s.entityType === et)
          const aiCount  = session.aiComparisons.filter((a) => a.entityType === et).length
          const missCount = summary?.totalNotFoundInDb ?? 0
          const pct = summary && summary.totalUniqueInApi > 0
            ? Math.round((summary.totalFoundInDb / summary.totalUniqueInApi) * 100)
            : null

          return (
            <a
              key={et}
              href={`#section-${et}`}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm capitalize transition-colors hover:bg-muted"
            >
              <span>{et}</span>
              {pct !== null && (
                <span className={`font-mono text-[11px] ${missCount > 0 ? 'text-[var(--status-critical)]' : 'text-[var(--status-ok)]'}`}>
                  {pct}%
                </span>
              )}
              {aiCount > 0 && (
                <span className="text-[11px] text-muted-foreground">·{aiCount} AI</span>
              )}
            </a>
          )
        })}
      </nav>

      {/* ── Entity sections ──────────────────────────────────────────────── */}
      <div className="divide-y divide-border">
        {sections.map((et) => {
          const summary       = session.entityCheckSummaries.find((s) => s.entityType === et)
          const polygonChecks = session.polygonChecks.filter((p) => p.entityType === et)
          const aiComparisons = session.aiComparisons.filter((a) => a.entityType === et)

          return (
            <section
              key={et}
              id={`section-${et}`}
              className="scroll-mt-10 py-8 first:pt-2 last:pb-0"
            >
              <h2 className="mb-5 text-base font-semibold capitalize">{et}</h2>

              <div className="space-y-6">
                {showApiDb && (
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      API → DB
                    </h3>
                    {summary
                      ? <ApiDbResultsTab summary={summary} polygonChecks={polygonChecks} />
                      : <p className="text-sm text-muted-foreground">No data</p>}
                  </div>
                )}

                {showAi && (
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      AI Comparison
                    </h3>
                    <AiResultsTab comparisons={aiComparisons} appId={session.appId} />
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
