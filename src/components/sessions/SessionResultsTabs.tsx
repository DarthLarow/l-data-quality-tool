import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiDbResultsTab } from './ApiDbResultsTab'
import { DeltaResultsTab } from './DeltaResultsTab'
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

export function SessionResultsTabs({ session }: Props) {
  const entityTypes = session.entityTypes
  const showAi = session.checksEnabled.includes('api_db') && session.aiComparisons.length > 0

  return (
    <div className="space-y-8">
      {/* API→DB and Delta per entity type */}
      <Tabs defaultValue={entityTypes[0] ?? 'dockless'}>
        <TabsList>
          {entityTypes.map((et) => (
            <TabsTrigger key={et} value={et}>{et}</TabsTrigger>
          ))}
        </TabsList>

        {entityTypes.map((et) => {
          const summary       = session.entityCheckSummaries.find((s) => s.entityType === et)
          const polygonChecks = session.polygonChecks.filter((p) => p.entityType === et)
          const deltaCheck    = session.sessionDeltaChecks.find((d) => d.entityType === et)

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
            </TabsContent>
          )
        })}
      </Tabs>

      {/* AI Comparisons — all entity types in one section */}
      {showAi && (
        <section>
          <h2 className="mb-4 text-base font-semibold">AI Comparisons</h2>
          <div className="space-y-0">
            {entityTypes.map((et, idx) => {
              const comparisons = session.aiComparisons.filter((a) => a.entityType === et)
              return (
                <div key={et}>
                  {idx > 0 && <hr className="my-6 border-border" />}
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {et}
                  </p>
                  <AiResultsTab comparisons={comparisons} />
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
