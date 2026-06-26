import { Badge } from '@/components/ui/badge'
import type { SessionDeltaCheck } from '@/generated/prisma/client'

const flagColor = {
  ok:       'text-[var(--status-ok)]',
  warning:  'text-[var(--status-warning)]',
  critical: 'text-[var(--status-critical)]',
} as const

const badgeVariant = {
  ok:       'default',
  warning:  'secondary',
  critical: 'destructive',
} as const

interface Props { deltaCheck: SessionDeltaCheck }

export function DeltaResultsTab({ deltaCheck }: Props) {
  const flag  = deltaCheck.deltaFlag as keyof typeof flagColor
  const sign  = deltaCheck.deltaPercent >= 0 ? '+' : ''

  return (
    <div className="flex flex-wrap items-center gap-6 text-sm">
      <span className="text-muted-foreground">
        Current: <span className="data-value font-medium text-foreground">
          {deltaCheck.currentCount.toLocaleString()}
        </span>
      </span>
      <span className="text-muted-foreground">
        Previous: <span className="data-value font-medium text-foreground">
          {deltaCheck.previousCount.toLocaleString()}
        </span>
      </span>
      <span className={flagColor[flag]}>
        Delta: <span className="data-value font-medium">
          {sign}{deltaCheck.deltaPercent.toFixed(1)}%
        </span>
      </span>
      <Badge variant={badgeVariant[flag]}>{deltaCheck.deltaFlag}</Badge>
    </div>
  )
}
