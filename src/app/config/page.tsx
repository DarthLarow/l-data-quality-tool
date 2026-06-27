'use client'
import { useState, useEffect, useCallback } from 'react'
import { Bell, Pencil, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { AutoCheckConfigForm } from '@/components/config/AutoCheckConfigForm'
import { ScraperThresholdEditor } from '@/components/config/ScraperThresholdEditor'
import type { AlertThreshold, AutoCheckConfig, Scraper } from '@/generated/prisma/client'

type OpenPanel = { appId: string; panel: 'autocheck' | 'thresholds' } | null

export default function ConfigPage() {
  const [scrapers,    setScrapers]    = useState<Scraper[]>([])
  const [thresholds,  setThresholds]  = useState<AlertThreshold[]>([])
  const [autoConfigs, setAutoConfigs] = useState<AutoCheckConfig[]>([])
  const [syncing,     setSyncing]     = useState(false)
  const [open,        setOpen]        = useState<OpenPanel>(null)
  const [toggling,    setToggling]    = useState<string | null>(null)

  const load = useCallback(async () => {
    const [sc, th, ac] = await Promise.all([
      fetch('/api/scrapers').then((r) => r.json())          as Promise<Scraper[]>,
      fetch('/api/config/thresholds').then((r) => r.json()) as Promise<AlertThreshold[]>,
      fetch('/api/config/auto-check').then((r) => r.json()) as Promise<AutoCheckConfig[]>,
    ])
    setScrapers(sc)
    setThresholds(th)
    setAutoConfigs(ac)
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleSync() {
    setSyncing(true)
    await fetch('/api/scrapers/sync', { method: 'POST' })
    await load()
    setSyncing(false)
  }

  async function toggleAutoCheck(config: AutoCheckConfig) {
    setToggling(config.appId)
    await fetch('/api/config/auto-check', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...config, isActive: !config.isActive }),
    })
    await load()
    setToggling(null)
  }

  function togglePanel(appId: string, panel: 'autocheck' | 'thresholds') {
    setOpen((prev) =>
      prev?.appId === appId && prev.panel === panel ? null : { appId, panel },
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Config</h1>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          <RefreshCw size={13} className={syncing ? 'mr-1.5 animate-spin' : 'mr-1.5'} />
          {syncing ? 'Syncing…' : 'Sync from scrapers_db'}
        </Button>
      </div>

      {scrapers.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No active scrapers — click "Sync from scrapers_db" to load.
        </p>
      ) : (
        <div className="rounded-lg border divide-y divide-border">
          {/* ── Table header ──────────────────────────────────────────── */}
          <div className="grid grid-cols-[1fr_1.6fr_1fr_auto] gap-4 px-4 py-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            <span>Scraper</span>
            <span>Auto-check</span>
            <span>Thresholds</span>
            <span className="w-28" />
          </div>

          {scrapers.map((scraper) => {
            const config     = autoConfigs.find((c) => c.appId === scraper.appId) ?? null
            const scraperThr = thresholds.filter((t) => t.appId === scraper.appId)
            const isAutoOpen = open?.appId === scraper.appId && open.panel === 'autocheck'
            const isThrOpen  = open?.appId === scraper.appId && open.panel === 'thresholds'

            return (
              <div key={scraper.appId}>
                {/* ── Scraper row ─────────────────────────────────────── */}
                <div className="grid grid-cols-[1fr_1.6fr_1fr_auto] gap-4 items-start px-4 py-3">

                  {/* Scraper name */}
                  <div>
                    <p className="text-sm font-medium">{scraper.name}</p>
                    <p className="data-value text-xs text-muted-foreground">{scraper.appId}</p>
                  </div>

                  {/* Auto-check summary */}
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {config ? (
                      <>
                        <p className="text-foreground">
                          {config.environment}
                          {' · '}
                          {config.checksEnabled.map((c) => c === 'api_db' ? 'API→DB' : c).join(', ')}
                        </p>
                        <p>{config.entityTypes.join(', ')}</p>
                      </>
                    ) : (
                      <span className="italic">not configured</span>
                    )}
                  </div>

                  {/* Thresholds summary */}
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {scraperThr.length > 0 ? (
                      scraperThr.map((t) => {
                        const tags = [
                          t.missingCountWarning  != null || t.missingCountCritical  != null ? 'miss' : '',
                          t.mismatchCountWarning != null || t.mismatchCountCritical != null ? 'mm'   : '',
                          'δ',
                        ].filter(Boolean)
                        return (
                          <p key={t.entityType} className="flex items-center gap-1.5">
                            <span className="capitalize">{t.entityType}</span>
                            {tags.map((tag) => (
                              <span key={tag} className="rounded bg-muted px-1 py-px font-mono text-[9px] text-muted-foreground/70">{tag}</span>
                            ))}
                          </p>
                        )
                      })
                    ) : (
                      <span className="italic">—</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {/* Toggle auto-check on/off */}
                    {config && (
                      <Switch
                        checked={config.isActive}
                        disabled={toggling === scraper.appId}
                        onCheckedChange={() => toggleAutoCheck(config)}
                        title={config.isActive ? 'Disable auto-check' : 'Enable auto-check'}
                      />
                    )}

                    {/* Edit auto-check */}
                    <Button
                      variant={isAutoOpen ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 w-7 p-0"
                      title="Configure auto-check"
                      onClick={() => togglePanel(scraper.appId, 'autocheck')}
                    >
                      <Pencil size={13} />
                    </Button>

                    {/* Edit thresholds */}
                    <Button
                      variant={isThrOpen ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 w-7 p-0"
                      title="Alert thresholds"
                      onClick={() => togglePanel(scraper.appId, 'thresholds')}
                    >
                      <Bell size={13} />
                    </Button>
                  </div>
                </div>

                {/* ── Inline panels ───────────────────────────────────── */}
                {isAutoOpen && (
                  <div className="border-t px-4 pb-4 pt-3">
                    <AutoCheckConfigForm
                      scraper={{
                        appId:                scraper.appId,
                        supportedEntityTypes: scraper.supportedEntityTypes,
                        cities:               scraper.cities,
                      }}
                      existingConfig={config}
                      onSaved={async () => { await load(); setOpen(null) }}
                      onCancel={() => setOpen(null)}
                    />
                  </div>
                )}

                {isThrOpen && (
                  <div className="border-t px-4 pb-4 pt-3">
                    <ScraperThresholdEditor
                      appId={scraper.appId}
                      thresholds={scraperThr}
                      onSaved={load}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
