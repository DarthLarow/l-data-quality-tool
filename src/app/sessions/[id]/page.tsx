import { notFound } from 'next/navigation'
import { prisma } from '@/lib/quality-db'
import { SessionResultsTabs } from '@/components/sessions/SessionResultsTabs'
import { Badge } from '@/components/ui/badge'

// Next.js 15+: params is a Promise
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await prisma.checkSession.findUnique({
    where: { id },
    include: {
      entityCheckSummaries: true,
      polygonChecks:        true,
      sessionDeltaChecks:   true,
      aiComparisons:        true,
    },
  })

  if (!session) notFound()

  const statusColor = {
    completed: 'text-[var(--status-ok)]',
    running:   'text-[var(--status-warning)]',
    failed:    'text-[var(--status-critical)]',
  }[session.status] ?? ''

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{session.appId}</h1>
          <Badge variant="outline">{session.environment}</Badge>
          <span className={`text-sm font-medium ${statusColor}`}>{session.status}</span>
        </div>
        <p className="data-value text-sm text-muted-foreground">
          Session #{session.scrapersSessionId} · {session.createdAt.toLocaleString()}
        </p>
      </div>

      <SessionResultsTabs session={session} />
    </div>
  )
}
