'use client'
import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ThresholdForm } from '@/components/config/ThresholdForm'
import { AutoCheckConfigForm } from '@/components/config/AutoCheckConfigForm'
import { RefreshCw, Settings2, Power } from 'lucide-react'
import type { AlertThreshold, AutoCheckConfig, Scraper } from '@/generated/prisma/client'

export default function ConfigPage() {
  const [scrapers, setScrapers]       = useState<Scraper[]>([])
  const [thresholds, setThresholds]   = useState<AlertThreshold[]>([])
  const [autoConfigs, setAutoConfigs] = useState<AutoCheckConfig[]>([])
  const [syncing, setSyncing]         = useState(false)
  const [editingAppId, setEditingAppId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [sc, th, ac] = await Promise.all([
      fetch('/api/scrapers').then((r) => r.json()) as Promise<Scraper[]>,
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

  async function toggleActive(config: AutoCheckConfig) {
    await fetch('/api/config/auto-check', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...config, isActive: !config.isActive }),
    })
    await load()
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Config</h1>

      {/* Scrapers */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle>Scrapers</CardTitle>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={13} className={syncing ? 'animate-spin mr-1.5' : 'mr-1.5'} />
            {syncing ? 'Syncing…' : 'Sync from scrapers_db'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {scrapers.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No scrapers yet — click "Sync from scrapers_db" to load.
            </p>
          ) : (
            scrapers.map((scraper) => {
              const config = autoConfigs.find((c) => c.appId === scraper.appId) ?? null
              const isEditing = editingAppId === scraper.appId

              return (
                <div key={scraper.appId} className="rounded-md border">
                  {/* Scraper row */}
                  <div className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{scraper.name}</span>
                        <span className="data-value text-xs text-muted-foreground">{scraper.appId}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {scraper.supportedEntityTypes.map((et) => (
                          <Badge key={et} variant="outline" className="text-xs">{et}</Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {config ? (
                        <>
                          <Badge
                            variant="outline"
                            className="text-xs"
                          >
                            {config.environment}
                          </Badge>
                          <Badge
                            variant={config.isActive ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {config.isActive ? 'active' : 'inactive'}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title={config.isActive ? 'Deactivate' : 'Activate'}
                            onClick={() => toggleActive(config)}
                          >
                            <Power size={13} />
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">not configured</span>
                      )}
                      <Button
                        variant={isEditing ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 w-7 p-0"
                        title="Configure auto-check"
                        onClick={() => setEditingAppId(isEditing ? null : scraper.appId)}
                      >
                        <Settings2 size={13} />
                      </Button>
                    </div>
                  </div>

                  {/* Inline form */}
                  {isEditing && (
                    <div className="border-t px-3 pb-3 pt-2">
                      <AutoCheckConfigForm
                        scraper={{ appId: scraper.appId, supportedEntityTypes: scraper.supportedEntityTypes }}
                        existingConfig={config}
                        onSaved={async () => { await load(); setEditingAppId(null) }}
                        onCancel={() => setEditingAppId(null)}
                      />
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Alert Thresholds */}
      <Card>
        <CardHeader><CardTitle>Alert Thresholds</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <ThresholdForm scrapers={scrapers.map((s) => ({ appId: s.appId, name: s.name }))} onSaved={load} />

          {thresholds.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left font-medium">Scraper</th>
                  <th className="py-2 text-left font-medium">Entity</th>
                  <th className="py-2 text-left font-medium">Warning</th>
                  <th className="py-2 text-left font-medium">Critical</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 data-value">{t.appId}</td>
                    <td className="py-2"><Badge variant="outline">{t.entityType}</Badge></td>
                    <td className="py-2 data-value text-[var(--status-warning)]">{t.warningThresholdPct}%</td>
                    <td className="py-2 data-value text-[var(--status-critical)]">{t.criticalThresholdPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
