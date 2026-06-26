import { Badge } from '@/components/ui/badge'
import type { EntityCheckSummary, PolygonCheck } from '@/generated/prisma/client'

interface Props {
  summary: EntityCheckSummary
  polygonChecks: PolygonCheck[]
}

export function ApiDbResultsTab({ summary, polygonChecks }: Props) {
  const coverage = summary.totalUniqueInApi > 0
    ? ((summary.totalFoundInDb / summary.totalUniqueInApi) * 100).toFixed(1)
    : '0'
  const notFoundIds = [...new Set(polygonChecks.flatMap((p) => p.notFoundInDb))]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-muted-foreground">
          In API: <span className="data-value font-medium text-foreground">{summary.totalUniqueInApi}</span>
        </span>
        <span className="text-[var(--status-ok)]">
          Found in DB: <span className="data-value font-medium">{summary.totalFoundInDb}</span>
        </span>
        <span className="text-[var(--status-critical)]">
          Missing: <span className="data-value font-medium">{summary.totalNotFoundInDb}</span>
        </span>
        <Badge
          variant={summary.totalNotFoundInDb === 0 ? 'default' : 'destructive'}
          className="data-value"
        >
          {coverage}% coverage
        </Badge>
      </div>

      {notFoundIds.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Missing entity IDs:</p>
          <div className="flex max-h-40 flex-wrap gap-1 overflow-auto">
            {notFoundIds.map((id) => (
              <Badge key={id} variant="outline" className="data-value text-xs">{id}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
