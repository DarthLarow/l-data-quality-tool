'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface EntitySummary {
  entityType: string
  totalUniqueInApi: number
  totalFoundInDb: number
  totalNotFoundInDb: number
}
interface SessionRow {
  id: string
  createdAt: string
  appId: string
  scrapersSessionId: number
  entityTypes: string[]
  checksEnabled: string[]
  status: string
  scraper: { name: string }
  entityCheckSummaries: EntitySummary[]
  aiComparisons: { verdict: string }[]
}
interface ScraperOption { appId: string; name: string }

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function coverageSummary(summaries: EntitySummary[]): { found: number; total: number } | null {
  if (!summaries.length) return null
  return summaries.reduce(
    (acc, s) => ({ found: acc.found + s.totalFoundInDb, total: acc.total + s.totalUniqueInApi }),
    { found: 0, total: 0 },
  )
}

function aiSummary(comparisons: { verdict: string }[]) {
  return comparisons.reduce<Record<string, number>>((acc, c) => {
    acc[c.verdict] = (acc[c.verdict] ?? 0) + 1
    return acc
  }, {})
}

const STATUS_STYLE: Record<string, string> = {
  completed: 'text-[var(--status-ok)]',
  failed:    'text-[var(--status-critical)]',
  running:   'text-blue-500',
}

const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  failed:    'Failed',
  running:   'In progress',
}

export function SessionsList() {
  const searchParams = useSearchParams()
  const router       = useRouter()

  const scraperParam = searchParams.get('scraper') ?? 'all'
  const statusParam  = searchParams.get('status')  ?? 'all'
  const daysParam    = searchParams.get('days')    ?? '30'

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [scrapers, setScrapers] = useState<ScraperOption[]>([])
  const [loading, setLoading]   = useState(true)

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value === 'all' || value === '0') p.delete(key)
    else p.set(key, value)
    router.push(`/sessions?${p.toString()}`)
  }

  // fetch scrapers for filter dropdown
  useEffect(() => {
    fetch('/api/scrapers').then((r) => r.json()).then((d) => setScrapers(d as ScraperOption[])).catch(() => {})
  }, [])

  // fetch sessions on filter change
  useEffect(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (scraperParam !== 'all') p.set('scraper', scraperParam)
    if (statusParam  !== 'all') p.set('status',  statusParam)
    if (daysParam    !== '0')   p.set('days',     daysParam)
    fetch(`/api/sessions?${p.toString()}`)
      .then((r) => r.json())
      .then((d) => { setSessions(d as SessionRow[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [scraperParam, statusParam, daysParam])

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sessions</h1>
        <Link href="/sessions/new">
          <Button size="sm" className="gap-1.5">
            <Play size={13} />
            New Check
          </Button>
        </Link>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <Select value={scraperParam} onValueChange={(v) => setParam('scraper', v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All scrapers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scrapers</SelectItem>
            {scrapers.map((s) => (
              <SelectItem key={s.appId} value={s.appId}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusParam} onValueChange={(v) => setParam('status', v)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="running">In progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={daysParam} onValueChange={(v) => setParam('days', v)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="0">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">Scraper</th>
              <th className="px-4 py-3 text-left font-medium">Session</th>
              <th className="px-4 py-3 text-left font-medium">Entities</th>
              <th className="px-4 py-3 text-left font-medium">Coverage</th>
              <th className="px-4 py-3 text-left font-medium">AI</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  Loading…
                </td>
              </tr>
            )}

            {!loading && sessions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  No sessions found.
                </td>
              </tr>
            )}

            {!loading && sessions.map((s) => {
              const cov     = s.checksEnabled.includes('api_db') ? coverageSummary(s.entityCheckSummaries) : null
              const ai      = (s.checksEnabled.includes('ai') || s.checksEnabled.includes('api_db'))
                ? aiSummary(s.aiComparisons)
                : null
              const covPct  = cov && cov.total > 0 ? Math.round((cov.found / cov.total) * 100) : null
              const hasMiss = cov && cov.found < cov.total

              return (
                <tr
                  key={s.id}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => router.push(`/sessions/${s.id}`)}
                >
                  <td className="px-4 py-3 text-muted-foreground">
                    <span title={new Date(s.createdAt).toLocaleString()}>{relTime(s.createdAt)}</span>
                  </td>

                  <td className="px-4 py-3">
                    <span className="data-value text-xs">{s.scraper?.name ?? s.appId}</span>
                  </td>

                  <td className="px-4 py-3 data-value text-muted-foreground">
                    #{s.scrapersSessionId}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.entityTypes.map((et) => (
                        <Badge key={et} variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                          {et}
                        </Badge>
                      ))}
                    </div>
                  </td>

                  <td className="px-4 py-3 data-value">
                    {cov && covPct !== null ? (
                      <span className={hasMiss ? 'text-[var(--status-critical)]' : 'text-[var(--status-ok)]'}>
                        {covPct}%
                        {hasMiss && <span className="text-muted-foreground ml-1">({cov.total - cov.found} miss)</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 data-value">
                    {ai && Object.keys(ai).length > 0 ? (
                      <span className="flex gap-2 text-xs">
                        {ai.Same        && <span className="text-[var(--status-ok)]">{ai.Same}S</span>}
                        {ai.SomewhatSame && <span className="text-[var(--status-warning)]">{ai.SomewhatSame}~</span>}
                        {ai.Different   && <span className="text-[var(--status-critical)]">{ai.Different}✗</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${STATUS_STYLE[s.status] ?? 'text-muted-foreground'}`}>
                      {s.status === 'running' && (
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                      )}
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && sessions.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">{sessions.length} sessions</p>
      )}
    </div>
  )
}
