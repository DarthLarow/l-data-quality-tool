'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface AiVerdict { verdict: string }
interface EntitySummary {
  entityType:        string
  totalUniqueInApi:  number
  totalFoundInDb:    number
  totalNotFoundInDb: number
}
interface Session {
  id:                  string
  createdAt:           string
  scrapersSessionId:   number
  environment:         string
  status:              string
  checksEnabled:       string[]
  entityTypes:         string[]
  entityCheckSummaries: EntitySummary[]
  aiComparisons:       AiVerdict[]
}
interface ScraperItem {
  id:            string
  appId:         string
  name:          string
  checkSessions: Session[]
}

type Health = 'healthy' | 'warning' | 'critical' | 'running' | 'unknown'

function computeHealth(s: Session | undefined): Health {
  if (!s) return 'unknown'
  if (s.status === 'running') return 'running'
  if (s.status === 'failed')  return 'critical'
  if (s.aiComparisons.some((c) => c.verdict === 'Different'))        return 'critical'
  if (s.entityCheckSummaries.some((e) => e.totalNotFoundInDb > 0))  return 'warning'
  return 'healthy'
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function pctColor(p: number) {
  return p >= 98 ? 'var(--dq-green)' : p >= 94 ? 'var(--dq-amber)' : 'var(--dq-red)'
}

const ACCENT: Record<Health, string> = {
  healthy: 'var(--dq-green)',
  warning:  'var(--dq-amber)',
  critical: 'var(--dq-red)',
  running:  'var(--dq-blue)',
  unknown:  'var(--dq-border-4)',
}

export function ScraperGrid() {
  const [scrapers, setScrapers] = useState<ScraperItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => { setScrapers(d as ScraperItem[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // ── Page header stats ──────────────────────────────────────────
  const healthCounts = scrapers.reduce(
    (acc, s) => {
      const h = computeHealth(s.checkSessions[0])
      acc[h] = (acc[h] ?? 0) + 1
      return acc
    },
    {} as Record<Health, number>,
  )

  return (
    <div className="flex flex-col">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b px-[22px] py-[16px]"
        style={{ borderColor: 'var(--dq-border-1)' }}>
        <div>
          <div className="text-[16px] font-semibold" style={{ letterSpacing: '-0.015em' }}>
            Scrapers
          </div>
          {!loading && (
            <div className="mt-[3px] text-[12px]" style={{ color: 'var(--dq-text-5)' }}>
              {scrapers.length} source{scrapers.length !== 1 ? 's' : ''}
              {!!healthCounts.critical && (
                <> · <span style={{ color: 'var(--dq-red)' }}>{healthCounts.critical} critical</span></>
              )}
              {!!healthCounts.warning && (
                <> · <span style={{ color: 'var(--dq-amber)' }}>{healthCounts.warning} warning{healthCounts.warning !== 1 ? 's' : ''}</span></>
              )}
              {!!healthCounts.running && (
                <> · <span style={{ color: 'var(--dq-blue)' }}>{healthCounts.running} running</span></>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-[10px]">
          {/* Search (visual only — filter not implemented yet) */}
          <div className="flex items-center gap-[7px] rounded-[7px] px-[11px] py-[7px] font-mono text-[12px]"
            style={{ border: '1px solid var(--dq-border-3)', color: 'var(--dq-text-6)', width: '160px' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" />
              <line x1="8.6" y1="8.6" x2="12" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            search…
          </div>
          <Link href="/sessions/new"
            className="rounded-[7px] px-[13px] py-[8px] text-[12px] font-semibold"
            style={{ background: 'var(--dq-btn-bg)', color: 'var(--dq-btn-fg)' }}>
            ＋ New Check
          </Link>
        </div>
      </div>

      {/* ── Grid area ───────────────────────────────────────────── */}
      <div className="flex-1 p-[18px_22px]" style={{ background: 'var(--dq-bg-2)' }}>
        {loading ? (
          <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-[158px] rounded-[9px]"
                style={{ background: 'var(--dq-bg-3)', border: '1px solid var(--dq-border-2)', opacity: 0.6 }}>
                <div className="m-[13px_15px] h-3 w-24 rounded animate-pulse" style={{ background: 'var(--dq-border-1)' }} />
              </div>
            ))}
          </div>
        ) : scrapers.length === 0 ? (
          <p className="py-16 text-center text-sm" style={{ color: 'var(--dq-text-7)' }}>
            No active scrapers. Go to Config → Sync from scrapers_db.
          </p>
        ) : (
          <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {scrapers.map((scraper) => {
              const last   = scraper.checkSessions[0]
              const health = computeHealth(last)
              const accent = ACCENT[health]

              const verdicts = (last?.aiComparisons ?? []).reduce<Record<string, number>>((acc, c) => {
                acc[c.verdict] = (acc[c.verdict] ?? 0) + 1
                return acc
              }, {})
              const hasAi = Object.keys(verdicts).length > 0

              const envLive = last?.environment === 'production'

              return (
                <div
                  key={scraper.id}
                  onClick={() => last && router.push(`/sessions/${last.id}`)}
                  className="flex flex-col gap-[10px] rounded-[9px] transition-colors"
                  style={{
                    background:   'var(--dq-bg-3)',
                    border:       '1px solid var(--dq-border-2)',
                    borderLeft:   `3px solid ${accent}`,
                    padding:      '13px 15px',
                    minHeight:    '158px',
                    cursor:       last ? 'pointer' : 'default',
                  }}
                >
                  {/* ── Card header ────────────────────────────────── */}
                  <div className="flex items-start justify-between gap-[8px]">
                    <div className="flex min-w-0 items-center gap-[8px]">
                      <span
                        className="shrink-0 rounded-full"
                        style={{
                          width:     '8px',
                          height:    '8px',
                          background: accent,
                          animation:  health === 'running' ? 'dqpulse 1.4s ease-out infinite' : undefined,
                        }}
                      />
                      <span className="truncate text-[14px] font-semibold" style={{ letterSpacing: '-0.01em' }}>
                        {scraper.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] truncate" style={{ color: 'var(--dq-text-8)' }}>
                        {scraper.appId}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[11px]" style={{ color: 'var(--dq-text-5)' }}>
                      {last ? relTime(last.createdAt) : ''}
                    </span>
                  </div>

                  {/* ── Body ───────────────────────────────────────── */}
                  {!last ? (
                    /* Empty state */
                    <div className="flex flex-1 flex-col items-center justify-center gap-[9px] py-[16px]"
                      style={{ color: 'var(--dq-text-7)' }}>
                      <div className="text-[12px]">No sessions yet</div>
                      <Link
                        href={`/sessions/new?scraper=${scraper.appId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-[6px] px-[13px] py-[6px] text-[11px] font-semibold"
                        style={{ border: '1px solid var(--dq-border-4)', color: 'var(--dq-text-1)' }}
                      >
                        Run first check →
                      </Link>
                    </div>
                  ) : last.status === 'running' ? (
                    /* Running state */
                    <div className="flex flex-1 flex-col justify-center gap-[9px]">
                      <div className="flex items-center gap-[8px]">
                        <span className="text-[11px] font-medium" style={{ color: 'var(--dq-blue)' }}>Checking…</span>
                        <span className="font-mono text-[11px]" style={{ color: 'var(--dq-text-7)' }}>
                          #{last.scrapersSessionId}
                        </span>
                      </div>
                      <div className="relative overflow-hidden rounded-[3px]"
                        style={{ height: '5px', background: 'var(--dq-border-1)' }}>
                        <div className="h-full rounded-[3px]" style={{ width: '40%', background: 'var(--dq-blue)' }} />
                        <div className="absolute inset-y-0 left-0 w-[40px]"
                          style={{
                            background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent)',
                            animation:  'dqshimmer 1.3s infinite',
                          }} />
                      </div>
                      <div className="font-mono text-[11px]" style={{ color: 'var(--dq-text-7)' }}>In progress…</div>
                    </div>
                  ) : (
                    /* Normal state */
                    <>
                      {/* Env + session */}
                      <div className="flex items-center gap-[8px]">
                        <span className="rounded-[4px] px-[7px] py-[1px] font-mono text-[10px] font-medium uppercase"
                          style={{
                            letterSpacing: '0.04em',
                            color:      envLive ? 'var(--dq-green)' : 'var(--dq-amber)',
                            background: envLive ? 'var(--dq-green-bg)' : 'var(--dq-amber-bg)',
                          }}>
                          {envLive ? 'live' : 'stage'}
                        </span>
                        <span className="font-mono text-[11px]" style={{ color: 'var(--dq-text-5)' }}>
                          #{last.scrapersSessionId}
                        </span>
                      </div>

                      {/* Coverage rows — skip entities with 0 API items (no data collected) */}
                      {last.entityCheckSummaries.some((e) => e.totalUniqueInApi > 0) && (
                        <div className="flex flex-col">
                          {last.entityCheckSummaries.filter((e) => e.totalUniqueInApi > 0).map((e) => {
                            const pct = Math.round((e.totalFoundInDb / e.totalUniqueInApi) * 100)
                            return (
                              <div key={e.entityType}
                                className="grid items-center gap-[10px] py-[4px]"
                                style={{ gridTemplateColumns: '1fr auto 42px', borderTop: '1px solid var(--dq-border-1)' }}>
                                <span className="text-[12px]" style={{ color: 'var(--dq-text-3)' }}>{e.entityType}</span>
                                <span className="text-right font-mono text-[12px]" style={{ color: 'var(--dq-text-5)' }}>
                                  {e.totalFoundInDb}/{e.totalUniqueInApi}
                                </span>
                                <span className="text-right font-mono text-[12px] font-medium"
                                  style={{ color: pctColor(pct) }}>
                                  {pct}%
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* AI summary */}
                      {hasAi && (
                        <div className="flex items-center gap-[12px] pt-[1px] font-mono text-[11px]">
                          <span style={{ color: 'var(--dq-green)' }}>● {verdicts.Same         ?? 0} Same</span>
                          <span style={{ color: 'var(--dq-amber)' }}>● {verdicts.SomewhatSame ?? 0} Somewhat same</span>
                          <span style={{ color: 'var(--dq-red)' }}>● {verdicts.Different    ?? 0} Different</span>
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Actions ────────────────────────────────────── */}
                  {last && (
                    <div className="mt-auto flex gap-[8px] pt-[10px]"
                      style={{ borderTop: '1px solid var(--dq-border-1)' }}
                      onClick={(e) => e.stopPropagation()}>
                      <Link href={`/sessions?scraper=${scraper.appId}`}
                        className="flex-1 rounded-[6px] py-[6px] text-center text-[11px] font-medium"
                        style={{ border: '1px solid var(--dq-border-3)', color: 'var(--dq-text-3)' }}>
                        Sessions
                      </Link>
                      <Link href={`/sessions/new?scraper=${scraper.appId}`}
                        className="flex-1 rounded-[6px] py-[6px] text-center text-[11px] font-semibold"
                        style={{ background: 'var(--dq-border-1)', border: '1px solid var(--dq-border-3)', color: 'var(--dq-text-1)' }}>
                        Run →
                      </Link>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
