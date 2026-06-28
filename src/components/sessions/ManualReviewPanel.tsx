'use client'
import { useState } from 'react'
import type { AiComparison, PolygonCheck } from '@/generated/prisma/client'

interface Props {
  polygonChecks:  PolygonCheck[]
  aiComparisons:  AiComparison[]
  entityType:     string
  appId:          string
}

export function ManualReviewPanel({ polygonChecks, aiComparisons, entityType, appId }: Props) {
  const [entityId, setEntityId] = useState('')
  const [apiData, setApiData]   = useState<unknown>(null)
  const [dbData, setDbData]     = useState<unknown>(null)
  const [loading, setLoading]   = useState(false)

  async function handleLookup() {
    setLoading(true)
    const pc = polygonChecks.find((p) => p.apiEntityIds.includes(entityId))
    if (pc) {
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
    <div className="flex flex-col gap-[12px]">
      <div className="flex gap-[8px]">
        <input
          type="text"
          placeholder="Entity ID"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && entityId && handleLookup()}
          className="flex-1 rounded-[7px] px-[11px] py-[7px] font-mono text-[12.5px] outline-none"
          style={{
            background: 'var(--dq-bg-2)',
            border:     '1px solid var(--dq-border-3)',
            color:      'var(--dq-text-1)',
            maxWidth:   '280px',
          }}
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={!entityId || loading}
          className="rounded-[7px] px-[13px] py-[7px] text-[12px] font-medium transition-opacity"
          style={{
            border:     '1px solid var(--dq-border-3)',
            color:      'var(--dq-text-3)',
            cursor:     !entityId || loading ? 'not-allowed' : 'pointer',
            opacity:    !entityId || loading ? 0.5 : 1,
            background: 'transparent',
          }}
        >
          {loading ? 'Loading…' : 'Lookup'}
        </button>
      </div>

      {Boolean(apiData ?? dbData) && (
        <div className="grid grid-cols-2 gap-[12px]">
          {([['API', apiData], ['DB', dbData]] as [string, unknown][]).map(([label, data]) => (
            <div key={label}>
              <div className="mb-[5px] font-mono text-[10px] font-medium"
                style={{ color: 'var(--dq-text-7)', letterSpacing: '0.05em' }}>
                {label}
              </div>
              <pre
                className="max-h-96 overflow-auto rounded-[8px] p-[12px] font-mono text-[12px]"
                style={{ background: 'var(--dq-bg-1)', color: 'var(--dq-text-2)', border: '1px solid var(--dq-border-1)' }}
              >
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
