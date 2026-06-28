import { notFound } from 'next/navigation'
import Link          from 'next/link'
import { prisma }   from '@/lib/quality-db'
import { SessionResultsTabs } from '@/components/sessions/SessionResultsTabs'
import { RerunButton }        from '@/components/sessions/RerunButton'

function formatPolygon(strategyIds: string[], resolvedIds: string[]): string {
  if (!strategyIds || strategyIds.length === 0) return '—'
  const strategy = strategyIds[0] ?? ''
  const resolved = resolvedIds[0] ?? ''

  if (strategy === '__random__')
    return resolved ? `random polygon (${resolved})` : 'random polygon'

  const cityAll    = strategy.match(/^__city_by_city_all__:(.+)$/)
  const cityRandom = strategy.match(/^__city_by_city_random__:(.+)$/)

  if (cityAll)
    return `${cityAll[1]} — all polygons`

  if (cityRandom) {
    const city = cityRandom[1]
    return resolved ? `${city} — random polygon (${resolved})` : `${city} — random polygon`
  }

  // by_id — strategy already contains the real ID
  return `polygon (${strategy})`
}

function relTime(d: Date) {
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

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

  const scraperRecord = await prisma.scraper.findFirst({
    where: { appId: session.appId },
    select: { name: true },
  })
  const scraperName = scraperRecord?.name ?? session.appId

  const envLive = session.environment === 'production'
  const isRun   = session.status === 'running'
  const isDone  = session.status === 'completed'

  return (
    <div className="flex flex-col">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between border-b px-[22px] py-[16px]"
        style={{ borderColor: 'var(--dq-border-1)' }}>
        <div>
          {/* Breadcrumb */}
          <div className="mb-[7px] flex items-center gap-[6px] font-mono text-[11px]"
            style={{ color: 'var(--dq-text-7)' }}>
            <Link href="/sessions"
              className="transition-colors hover:text-[#bdbdbd]"
              style={{ color: 'var(--dq-text-7)' }}>
              Sessions
            </Link>
            <span>/</span>
          </div>

          {/* Title row */}
          <div className="flex items-center gap-[10px]">
            <h1 className="text-[17px] font-semibold" style={{ letterSpacing: '-0.015em' }}>
              {scraperName}
            </h1>

            {/* Env badge */}
            <span className="rounded-[4px] px-[7px] py-[2px] font-mono text-[10px] font-medium uppercase"
              style={{
                letterSpacing: '0.04em',
                color:         envLive ? 'var(--dq-green)' : 'var(--dq-amber)',
                background:    envLive ? 'var(--dq-green-bg)' : 'var(--dq-amber-bg)',
              }}>
              {envLive ? 'live' : 'stage'}
            </span>

            {/* Status badge */}
            <span className="flex items-center gap-[6px] rounded-[5px] px-[8px] py-[3px] text-[12px] font-medium"
              style={{
                background: isRun  ? 'var(--dq-blue-bg)'
                          : isDone ? 'var(--dq-green-bg)'
                          :          'var(--dq-red-bg)',
                color:      isRun  ? 'var(--dq-blue)'
                          : isDone ? 'var(--dq-green)'
                          :          'var(--dq-red)',
              }}>
              {isRun && (
                <span className="shrink-0 rounded-full"
                  style={{ width: '6px', height: '6px', background: 'var(--dq-blue)',
                           animation: 'dqpulse 1.4s ease-out infinite' }} />
              )}
              {isRun ? 'In progress' : isDone ? 'Completed' : 'Failed'}
            </span>
          </div>

          {/* Meta */}
          <div className="mt-[6px] font-mono text-[11.5px]" style={{ color: 'var(--dq-text-6)' }}>
            scrapers session #{session.scrapersSessionId}
            {' · '}
            {formatPolygon(
              session.polygonIds,
              [...new Set(session.polygonChecks.map((p) => p.polygonId))],
            )}
            {' · '}
            created {relTime(session.createdAt)}
          </div>
        </div>

        {/* Re-run button */}
        <div className="mt-[2px]">
          <RerunButton sessionId={session.id} />
        </div>
      </div>

      <SessionResultsTabs session={session} />
    </div>
  )
}
