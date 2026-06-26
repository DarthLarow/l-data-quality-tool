'use client'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { AiComparison, PolygonCheck } from '@/generated/prisma/client'

interface Props {
  polygonChecks:  PolygonCheck[]
  aiComparisons:  AiComparison[]
  entityType:     string
  appId:          string
}

export function ManualReviewPanel({ polygonChecks, aiComparisons, entityType, appId }: Props) {
  const [entityId, setEntityId]   = useState('')
  const [apiData, setApiData]     = useState<unknown>(null)
  const [dbData, setDbData]       = useState<unknown>(null)
  const [loading, setLoading]     = useState(false)

  async function handleLookup() {
    setLoading(true)
    const pc = polygonChecks.find((p) => p.apiEntityIds.includes(entityId))
    if (pc) {
      // Use full API snapshot from AI comparison if available; fall back to {id, polygonId}
      const ai = aiComparisons.find((a) => a.entityId === entityId)
      setApiData(ai?.apiSnapshot ?? { id: entityId, polygonId: pc.polygonId })
    } else {
      setApiData({ error: 'Not found in API results' })
    }

    const res = await fetch(`/api/entities/${entityId}?type=${entityType}&provider=${appId}`)
    setDbData(res.ok ? await res.json() : { error: 'Not found in DB' })
    setLoading(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Entity ID"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className="font-mono"
          onKeyDown={(e) => e.key === 'Enter' && entityId && handleLookup()}
        />
        <Button variant="outline" onClick={handleLookup} disabled={!entityId || loading}>
          {loading ? 'Loading…' : 'Lookup'}
        </Button>
      </div>

      {Boolean(apiData ?? dbData) && (
        <div className="grid grid-cols-2 gap-4">
          {([['API', apiData], ['DB', dbData]] as [string, unknown][]).map(([label, data]) => (
            <div key={label}>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">{label}</p>
              <pre className="data-value max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
