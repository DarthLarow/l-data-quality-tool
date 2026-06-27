import { ApiDbResultsTab } from './ApiDbResultsTab'
import { AiResultsTab } from './AiResultsTab'
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

export function SessionResultsTabs({ session }: Props) {
  const checks = new Set(session.checksEnabled)
  const sections = ENTITY_ORDER.filter((et) => session.entityTypes.includes(et))

  return (
    <div className="divide-y divide-border">
      {sections.map((et) => {
        const summary       = session.entityCheckSummaries.find((s) => s.entityType === et)
        const polygonChecks = session.polygonChecks.filter((p) => p.entityType === et)
        const aiComparisons = session.aiComparisons.filter((a) => a.entityType === et)

        return (
          <section key={et} className="py-8 first:pt-0 last:pb-0">
            <h2 className="mb-5 text-base font-semibold capitalize">{et}</h2>

            <div className="space-y-6">
              {checks.has('api_db') && (
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    API → DB
                  </h3>
                  {summary
                    ? <ApiDbResultsTab summary={summary} polygonChecks={polygonChecks} />
                    : <p className="text-sm text-muted-foreground">No data</p>}
                </div>
              )}

              {checks.has('api_db') && (
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    AI Comparison
                  </h3>
                  <AiResultsTab comparisons={aiComparisons} />
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
