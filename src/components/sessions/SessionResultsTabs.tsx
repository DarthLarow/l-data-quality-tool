import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiDbResultsTab } from './ApiDbResultsTab'
import { DeltaResultsTab } from './DeltaResultsTab'
import { AiResultsTab } from './AiResultsTab'
import { ManualReviewPanel } from './ManualReviewPanel'
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

export function SessionResultsTabs({ session }: Props) {
  const entityTypes = session.entityTypes

  return (
    <Tabs defaultValue={entityTypes[0] ?? 'dockless'}>
      <TabsList>
        {entityTypes.map((et) => (
          <TabsTrigger key={et} value={et}>{et}</TabsTrigger>
        ))}
      </TabsList>

      {entityTypes.map((et) => {
        const summary      = session.entityCheckSummaries.find((s) => s.entityType === et)
        const polygonChecks = session.polygonChecks.filter((p) => p.entityType === et)
        const deltaCheck   = session.sessionDeltaChecks.find((d) => d.entityType === et)
        const aiComparisons = session.aiComparisons.filter((a) => a.entityType === et)

        return (
          <TabsContent key={et} value={et} className="space-y-6 pt-4">
            {summary && session.checksEnabled.includes('api_db') && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  API → DB
                </h3>
                <ApiDbResultsTab summary={summary} polygonChecks={polygonChecks} />
              </section>
            )}

            {deltaCheck && session.checksEnabled.includes('delta') && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Delta
                </h3>
                <DeltaResultsTab deltaCheck={deltaCheck} />
              </section>
            )}

            {session.checksEnabled.includes('api_db') && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  AI Comparisons
                </h3>
                <AiResultsTab comparisons={aiComparisons} />
              </section>
            )}

            {session.checksEnabled.includes('api_db') && polygonChecks.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Manual Review
                </h3>
                <ManualReviewPanel
                  polygonChecks={polygonChecks}
                  aiComparisons={aiComparisons}
                  entityType={et}
                  appId={session.appId}
                />
              </section>
            )}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}
