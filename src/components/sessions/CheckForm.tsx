'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { EntityType, CheckType, Environment, PolygonStrategy, CheckSessionInput } from '@/types'
import { ENTITY_TYPES } from '@/types'

interface ScraperOption {
  appId: string
  name: string
  supportedEntityTypes: string[]
}

export function CheckForm() {
  const router = useRouter()
  const [scrapers, setScrapers]   = useState<ScraperOption[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const [environment, setEnvironment]                       = useState<Environment>('staging')
  const [appId, setAppId]                                   = useState('')
  const [scrapersSessionId, setScrapersSessionId]           = useState('')
  const [previousScrapersSessionId, setPreviousSessionId]   = useState('')
  const [polygonStrategy, setPolygonStrategy]               = useState<PolygonStrategy>('random')
  const [polygonId, setPolygonId]                           = useState('')
  const [polygonCity, setPolygonCity]                       = useState('')
  const [selectedEntityTypes, setSelectedEntityTypes]       = useState<EntityType[]>([])
  const [checksEnabled, setChecksEnabled]                   = useState<CheckType[]>(['api_db', 'delta'])
  const [aiSampleSize, setAiSampleSize]                     = useState(5)

  useEffect(() => {
    fetch('/api/scrapers').then((r) => r.json()).then(setScrapers).catch(console.error)
  }, [])

  function toggleEntityType(et: EntityType) {
    setSelectedEntityTypes((prev) =>
      prev.includes(et) ? prev.filter((x) => x !== et) : [...prev, et],
    )
  }

  function toggleCheckType(ct: CheckType) {
    setChecksEnabled((prev) =>
      prev.includes(ct) ? prev.filter((x) => x !== ct) : [...prev, ct],
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const polygonIds =
      polygonStrategy === 'by_id'          ? [polygonId] :
      polygonStrategy === 'random'         ? ['__random__'] :
      [`__city_${polygonStrategy}__:${polygonCity}`]

    const input: CheckSessionInput = {
      environment,
      appId,
      scrapersSessionId:         parseInt(scrapersSessionId, 10),
      polygonIds,
      entityTypes:               selectedEntityTypes,
      checksEnabled,
      aiSampleSize,
      previousScrapersSessionId: previousScrapersSessionId
        ? parseInt(previousScrapersSessionId, 10)
        : undefined,
    }

    try {
      const res = await fetch('/api/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const data = await res.json() as { sessionId?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Unknown error')
      router.push(`/sessions/${data.sessionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const canSubmit = !loading && appId && scrapersSessionId && selectedEntityTypes.length > 0 && checksEnabled.length > 0

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      <Card>
        <CardHeader><CardTitle>Run Check</CardTitle></CardHeader>
        <CardContent className="space-y-5">

          {/* Environment */}
          <div className="space-y-1.5">
            <Label>Environment</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as Environment)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Scraper */}
          <div className="space-y-1.5">
            <Label>Scraper</Label>
            <Select value={appId} onValueChange={(v) => { setAppId(v); setSelectedEntityTypes([]) }}>
              <SelectTrigger><SelectValue placeholder="Select scraper" /></SelectTrigger>
              <SelectContent>
                {scrapers.length === 0
                  ? <SelectItem value="__empty__" disabled>No scrapers — run Sync first</SelectItem>
                  : scrapers.map((s) => (
                    <SelectItem key={s.appId} value={s.appId}>{s.name}</SelectItem>
                  ))
                }
              </SelectContent>
            </Select>
          </div>

          {/* Session ID */}
          <div className="space-y-1.5">
            <Label>Scrapers Session ID</Label>
            <Input
              type="number"
              value={scrapersSessionId}
              onChange={(e) => setScrapersSessionId(e.target.value)}
              placeholder="e.g. 1234"
              className="font-mono"
              required
            />
          </div>

          {/* Check types */}
          <div className="space-y-1.5">
            <Label>Check Types</Label>
            <div className="flex gap-5">
              {(['api_db', 'delta'] as CheckType[]).map((ct) => (
                <label key={ct} className="flex items-center gap-2 cursor-pointer text-sm">
                  <Checkbox
                    checked={checksEnabled.includes(ct)}
                    onCheckedChange={() => toggleCheckType(ct)}
                  />
                  {ct === 'api_db' ? 'API→DB' : 'Delta'}
                </label>
              ))}
            </div>
          </div>

          {/* Polygon */}
          <div className="space-y-1.5">
            <Label>Polygon</Label>
            <Select value={polygonStrategy} onValueChange={(v) => setPolygonStrategy(v as PolygonStrategy)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="random">Random polygon</SelectItem>
                <SelectItem value="by_id">By polygon ID</SelectItem>
                <SelectItem value="by_city_all">By city — all polygons</SelectItem>
                <SelectItem value="by_city_random">By city — random polygon</SelectItem>
              </SelectContent>
            </Select>
            {polygonStrategy === 'by_id' && (
              <Input
                className="mt-2 font-mono"
                placeholder="Polygon ID"
                value={polygonId}
                onChange={(e) => setPolygonId(e.target.value)}
              />
            )}
            {(polygonStrategy === 'by_city_all' || polygonStrategy === 'by_city_random') && (
              <Input
                className="mt-2"
                placeholder="City name"
                value={polygonCity}
                onChange={(e) => setPolygonCity(e.target.value)}
              />
            )}
          </div>

          {/* Entity types */}
          <div className="space-y-1.5">
            <Label>Entity Types</Label>
            <div className="flex flex-wrap gap-4">
              {ENTITY_TYPES.map((et) => (
                <label
                  key={et}
                  className={`flex items-center gap-2 text-sm ${!appId ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Checkbox
                    checked={selectedEntityTypes.includes(et)}
                    onCheckedChange={() => toggleEntityType(et)}
                    disabled={!appId}
                  />
                  {et}
                </label>
              ))}
            </div>
          </div>

          {/* AI sample size */}
          <div className="space-y-1.5">
            <Label>AI Sample Size <span className="text-muted-foreground">(max 20)</span></Label>
            <Input
              type="number"
              min={0}
              max={20}
              value={aiSampleSize}
              onChange={(e) => setAiSampleSize(Number(e.target.value))}
              className="w-24 font-mono"
            />
            {aiSampleSize > 10 && (
              <p className="text-xs text-amber-600">
                Large sample may significantly increase response time.
              </p>
            )}
          </div>

          {/* Previous session (delta) */}
          {checksEnabled.includes('delta') && (
            <div className="space-y-1.5">
              <Label>Previous Session ID <span className="text-muted-foreground">(for Delta)</span></Label>
              <Input
                type="number"
                value={previousScrapersSessionId}
                onChange={(e) => setPreviousSessionId(e.target.value)}
                placeholder="e.g. 1233"
                className="font-mono"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" disabled={!canSubmit} className="w-full">
            {loading ? 'Running…' : 'Run Check'}
          </Button>

        </CardContent>
      </Card>
    </form>
  )
}
