'use client'
import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ThresholdForm } from '@/components/config/ThresholdForm'
import { AutoCheckConfigForm } from '@/components/config/AutoCheckConfigForm'
import type { AlertThreshold, AutoCheckConfig } from '@/generated/prisma/client'

interface ScraperOption { appId: string; name: string }

export default function ConfigPage() {
  const [scrapers, setScrapers]       = useState<ScraperOption[]>([])
  const [thresholds, setThresholds]   = useState<AlertThreshold[]>([])
  const [autoConfigs, setAutoConfigs] = useState<AutoCheckConfig[]>([])

  const load = useCallback(async () => {
    const [sc, th, ac] = await Promise.all([
      fetch('/api/scrapers').then((r) => r.json()) as Promise<ScraperOption[]>,
      fetch('/api/config/thresholds').then((r) => r.json()) as Promise<AlertThreshold[]>,
      fetch('/api/config/auto-check').then((r) => r.json()) as Promise<AutoCheckConfig[]>,
    ])
    setScrapers(sc)
    setThresholds(th)
    setAutoConfigs(ac)
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Config</h1>

      {/* Alert Thresholds */}
      <Card>
        <CardHeader><CardTitle>Alert Thresholds</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <ThresholdForm scrapers={scrapers} onSaved={load} />

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
                    <td className="py-2">
                      <Badge variant="outline">{t.entityType}</Badge>
                    </td>
                    <td className="py-2 data-value text-[var(--status-warning)]">
                      {t.warningThresholdPct}%
                    </td>
                    <td className="py-2 data-value text-[var(--status-critical)]">
                      {t.criticalThresholdPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Auto-check Config */}
      <Card>
        <CardHeader><CardTitle>Auto-check Config</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <AutoCheckConfigForm scrapers={scrapers} onSaved={load} />

          {autoConfigs.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left font-medium">Scraper</th>
                  <th className="py-2 text-left font-medium">Env</th>
                  <th className="py-2 text-left font-medium">Checks</th>
                  <th className="py-2 text-left font-medium">AI</th>
                  <th className="py-2 text-left font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {autoConfigs.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 data-value">{c.appId}</td>
                    <td className="py-2">
                      <Badge variant="outline">{c.environment}</Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {c.checksEnabled.join(', ')}
                    </td>
                    <td className="py-2 data-value">{c.aiSampleSize}</td>
                    <td className="py-2">
                      <Badge variant={c.isActive ? 'default' : 'secondary'}>
                        {c.isActive ? 'on' : 'off'}
                      </Badge>
                    </td>
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
