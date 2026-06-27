import { notFound } from 'next/navigation'
import Link          from 'next/link'
import { prisma }   from '@/lib/quality-db'
import { SessionResultsTabs } from '@/components/sessions/SessionResultsTabs'

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
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div>
          {/* Breadcrumb */}
          <div className="mb-[7px] flex items-center gap-[6px] font-mono text-[11px]"
            style={{ color: '#6b6b6b' }}>
            <Link href="/sessions"
              className="transition-colors hover:text-[#bdbdbd]"
              style={{ color: '#6b6b6b' }}>
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
                color:         envLive ? '#3fb950' : '#d29922',
                background:    envLive ? 'rgba(63,185,80,0.12)' : 'rgba(210,153,34,0.12)',
              }}>
              {envLive ? 'live' : 'stage'}
            </span>

            {/* Status badge */}
            <span className="flex items-center gap-[6px] rounded-[5px] px-[8px] py-[3px] text-[12px] font-medium"
              style={{
                background: isRun  ? 'rgba(68,147,248,0.12)'
                          : isDone ? 'rgba(63,185,80,0.12)'
                          :          'rgba(248,81,73,0.12)',
                color:      isRun  ? '#4493f8'
                          : isDone ? '#3fb950'
                          :          '#f85149',
              }}>
              {isRun && (
                <span className="shrink-0 rounded-full"
                  style={{ width: '6px', height: '6px', background: '#4493f8',
                           animation: 'dqpulse 1.4s ease-out infinite' }} />
              )}
              {isRun ? 'In progress' : isDone ? 'Completed' : 'Failed'}
            </span>
          </div>

          {/* Meta */}
          <div className="mt-[6px] font-mono text-[11.5px]" style={{ color: '#7a7a7a' }}>
            scrapers session #{session.scrapersSessionId}
            {' · '}
            created {relTime(session.createdAt)}
          </div>
        </div>

        {/* Re-run button */}
        <div className="mt-[2px]">
          <Link
            href={`/sessions/new?scraper=${session.appId}`}
            className="rounded-[7px] px-[11px] py-[7px] text-[12px] font-medium transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.13)', color: '#cfcfcf' }}>
            Re-run
          </Link>
        </div>
      </div>

      <SessionResultsTabs session={session} />
    </div>
  )
}
