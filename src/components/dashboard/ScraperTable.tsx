'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScraperChartRow } from './ScraperChartRow'
import type { CheckSession, EntityCheckSummary, SessionDeltaCheck, AiComparison, Scraper } from '@/generated/prisma/client'

interface SessionData extends CheckSession {
  entityCheckSummaries: EntityCheckSummary[]
  sessionDeltaChecks:   SessionDeltaCheck[]
  aiComparisons:        AiComparison[]
}

interface ScraperWithSessions extends Scraper {
  checkSessions: SessionData[]
}

const flagVariant = {
  ok:       'default',
  warning:  'secondary',
  critical: 'destructive',
  '—':      'outline',
} as const

export function ScraperDashboard() {
  const [scrapers, setScrapers] = useState<ScraperWithSessions[]>([])
  const [days, setDays]         = useState('7')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const res = await fetch(`/api/dashboard?days=${days}`)
    setScrapers(await res.json() as ScraperWithSessions[])
  }, [days])

  useEffect(() => { void load() }, [load])

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {scrapers.map((scraper) => {
          const lastSession = scraper.checkSessions.at(-1)
          const lastDelta   = lastSession?.sessionDeltaChecks?.[0]
          const lastSummary = lastSession?.entityCheckSummaries?.[0]
          const apiStatus   = lastSummary
            ? (lastSummary.totalNotFoundInDb === 0 ? 'ok' : 'warning')
            : '—'
          const deltaStatus = lastDelta?.deltaFlag ?? '—'
          const isExpanded  = expanded.has(scraper.id)

          return (
            <div key={scraper.id} className="rounded-lg border">
              <div
                className="flex cursor-pointer items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                onClick={() => toggleExpand(scraper.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{scraper.name}</span>
                  <span className="data-value text-xs text-muted-foreground">{scraper.appId}</span>
                  {lastSession && (
                    <Link href={`/sessions/${lastSession.id}`} onClick={(e) => e.stopPropagation()}>
                      <Badge variant="outline" className="data-value text-xs">
                        #{lastSession.scrapersSessionId}
                      </Badge>
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={flagVariant[apiStatus as keyof typeof flagVariant]}>
                    API→DB: {apiStatus}
                  </Badge>
                  <Badge variant={flagVariant[deltaStatus as keyof typeof flagVariant]}>
                    Delta: {deltaStatus}
                  </Badge>
                  {lastSession && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(lastSession.createdAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t px-4 pb-4 pt-3">
                  {scraper.checkSessions.length > 0
                    ? <ScraperChartRow sessions={scraper.checkSessions} />
                    : <p className="text-sm text-muted-foreground py-2">No sessions in selected period.</p>
                  }
                </div>
              )}
            </div>
          )
        })}

        {scrapers.length === 0 && (
          <p className="py-12 text-center text-muted-foreground">
            No scrapers found. Click "Sync Scrapers" to load from the external database.
          </p>
        )}
      </div>
    </div>
  )
}
