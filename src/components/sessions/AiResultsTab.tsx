import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { AiComparison } from '@/generated/prisma/client'

const verdictVariant = {
  Same:         'default',
  SomewhatSame: 'secondary',
  Different:    'destructive',
} as const

interface Props { comparisons: AiComparison[] }

export function AiResultsTab({ comparisons }: Props) {
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
        {comparisons.map((c) => (
          <Card key={c.id}>
            <CardContent className="flex items-start gap-3 py-3">
              <Badge variant={verdictVariant[c.verdict as keyof typeof verdictVariant] ?? 'outline'}>
                {c.verdict}
              </Badge>
              <div className="min-w-0">
                <p className="data-value text-xs text-muted-foreground truncate">{c.entityId}</p>
                <p className="text-sm">{c.explanation}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
