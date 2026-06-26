import { TotalChart } from './TotalChart'
import { CompletenessChart } from './CompletenessChart'
import { QualityChart } from './QualityChart'
import type { CheckSession, EntityCheckSummary, SessionDeltaCheck, AiComparison } from '@/generated/prisma/client'

interface SessionData extends CheckSession {
  entityCheckSummaries: EntityCheckSummary[]
  sessionDeltaChecks:   SessionDeltaCheck[]
  aiComparisons:        AiComparison[]
}

interface Props { sessions: SessionData[] }

export function ScraperChartRow({ sessions }: Props) {
  const dates = sessions.map((s) =>
    new Date(s.createdAt).toLocaleDateString('uk-UA', { month: 'short', day: 'numeric' }),
  )
  const sessionDates = sessions.map((s) => ({
    id:   s.id,
    date: new Date(s.createdAt).toLocaleDateString('uk-UA', { month: 'short', day: 'numeric' }),
  }))

  const allDeltaChecks  = sessions.flatMap((s) => s.sessionDeltaChecks)
  const allSummaries    = sessions.flatMap((s) => s.entityCheckSummaries)
  const allAiComparisons = sessions.flatMap((s) => s.aiComparisons)

  return (
    <div className="grid grid-cols-3 gap-4">
      <TotalChart     deltaChecks={allDeltaChecks}   dates={dates} />
      <CompletenessChart summaries={allSummaries}    dates={dates} />
      <QualityChart   aiComparisons={allAiComparisons} sessionDates={sessionDates} />
    </div>
  )
}
