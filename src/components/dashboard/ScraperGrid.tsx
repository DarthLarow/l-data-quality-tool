'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Play, List } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AiVerdict { verdict: string }
interface EntitySummary {
  entityType: string
  totalUniqueInApi: number
  totalFoundInDb: number
  totalNotFoundInDb: number
}
interface Session {
  id: string
  createdAt: string
  scrapersSessionId: number
  environment: string
  status: string
  checksEnabled: string[]
  entityTypes: string[]
  entityCheckSummaries: EntitySummary[]
  aiComparisons: AiVerdict[]
}
interface ScraperItem {
  id: string
  appId: string
  name: string
  checkSessions: Session[]
}

type Health = 'healthy' | 'warning' | 'critical' | 'running' | 'unknown'

function computeHealth(s: Session | undefined): Health {
  if (!s) return 'unknown'
  if (s.status === 'running')  return 'running'
  if (s.status === 'failed')   return 'critical'
  if (s.aiComparisons.some((c) => c.verdict === 'Different'))         return 'critical'
  if (s.entityCheckSummaries.some((e) => e.totalNotFoundInDb > 0))   return 'warning'
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

const DOT: Record<Health, string> = {
  healthy:  'bg-[var(--status-ok)]',
  warning:  'bg-[var(--status-warning)]',
  critical: 'bg-[var(--status-critical)]',
  running:  'bg-blue-500 animate-pulse',
  unknown:  'bg-muted-foreground/30',
}

const HEALTH_RING: Record<Health, string> = {
  healthy:  '',
  warning:  'border-[var(--status-warning)]/40',
  critical: 'border-[var(--status-critical)]/40',
  running:  'border-blue-500/30',
  unknown:  '',
}

export function ScraperGrid() {
  const [scrapers, setScrapers] = useState<ScraperItem[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => { setScrapers(d as ScraperItem[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-52 animate-pulse rounded-lg border bg-muted/30" />
        ))}
      </div>
    )
  }

  if (scrapers.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        No active scrapers. Go to Config → Sync from scrapers_db.
      </p>
    )
  }

  const router = useRouter()

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {scrapers.map((scraper) => {
        const last   = scraper.checkSessions[0]
        const health = computeHealth(last)

        const verdicts = (last?.aiComparisons ?? []).reduce<Record<string, number>>((acc, c) => {
          acc[c.verdict] = (acc[c.verdict] ?? 0) + 1
          return acc
        }, {})

        const envLabel = last?.environment === 'production' ? 'live' : 'stage'

        return (
          <div
            key={scraper.id}
            onClick={() => last && router.push(`/sessions/${last.id}`)}
            className={`flex flex-col rounded-lg border bg-card transition-colors ${HEALTH_RING[health]} ${last ? 'cursor-pointer hover:bg-muted/20' : ''}`}
          >
            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex items-start justify-between px-4 pt-4 pb-3">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[health]}`} />
                  <span className="font-medium truncate">{scraper.name}</span>
                </div>
                <span className="data-value pl-4 text-xs text-muted-foreground">{scraper.appId}</span>
              </div>
              {last && (
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <div>{relTime(last.createdAt)}</div>
                  <div className="data-value">
                    <span className="rounded bg-muted px-1 py-px text-[9px] uppercase tracking-wide">{envLabel}</span>
                    {' '}
                    <span>#{last.scrapersSessionId}</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Entity coverage ────────────────────────────────────── */}
            <div className="px-4 pb-2 flex-1">
              {last?.entityCheckSummaries.length ? (
                <table className="w-full border-collapse text-xs">
                  <tbody className="divide-y divide-border/20">
                    {last.entityCheckSummaries.map((e) => {
                      const pct = e.totalUniqueInApi > 0
                        ? Math.round((e.totalFoundInDb / e.totalUniqueInApi) * 100)
                        : 100
                      return (
                        <tr key={e.entityType}>
                          <td className="py-0.5 capitalize text-muted-foreground">{e.entityType}</td>
                          <td className="py-0.5 text-right tabular-nums text-muted-foreground">
                            {e.totalFoundInDb}/{e.totalUniqueInApi}
                          </td>
                          <td className="py-0.5 pl-2 text-right tabular-nums font-mono">
                            <span className={pct === 100 ? 'text-[var(--status-ok)]' : 'text-[var(--status-critical)]'}>
                              {pct}%
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="py-2 text-xs text-muted-foreground">No sessions yet</p>
              )}
            </div>

            {/* ── AI summary ─────────────────────────────────────────── */}
            {Object.keys(verdicts).length > 0 && (
              <div className="px-4 pb-3 flex flex-wrap gap-3 text-xs">
                {verdicts.Same        && <span className="text-[var(--status-ok)]">{verdicts.Same} Same</span>}
                {verdicts.SomewhatSame && <span className="text-[var(--status-warning)]">{verdicts.SomewhatSame} Somewhat</span>}
                {verdicts.Different   && <span className="text-[var(--status-critical)]">{verdicts.Different} Different</span>}
              </div>
            )}

            {/* ── Actions ────────────────────────────────────────────── */}
            <div className="flex gap-2 border-t px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
              <Link href={`/sessions?scraper=${scraper.appId}`} className="flex-1">
                <Button variant="outline" size="sm" className="w-full gap-1.5">
                  <List size={12} />
                  Sessions
                </Button>
              </Link>
              <Link href={`/sessions/new?scraper=${scraper.appId}`}>
                <Button size="sm" className="gap-1.5">
                  <Play size={12} />
                  Run
                </Button>
              </Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}
