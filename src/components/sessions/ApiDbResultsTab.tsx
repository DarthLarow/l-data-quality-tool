'use client'
import { useState } from 'react'
import type { EntityCheckSummary, PolygonCheck } from '@/generated/prisma/client'

interface Props {
  summary: EntityCheckSummary
  polygonChecks: PolygonCheck[]
}

function pctColor(p: number) {
  return p >= 98 ? '#3fb950' : p >= 94 ? '#d29922' : '#f85149'
}

export function ApiDbResultsTab({ summary, polygonChecks }: Props) {
  const [missOpen, setMissOpen] = useState(false)

  const pct = summary.totalUniqueInApi > 0
    ? Math.round((summary.totalFoundInDb / summary.totalUniqueInApi) * 100)
    : 0
  const notFoundIds = [...new Set(polygonChecks.flatMap((p) => p.notFoundInDb as string[]))]

  return (
    <div>
      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-[18px] font-mono text-[12px]"
        style={{ color: '#bdbdbd' }}>
        <span>
          <span style={{ color: '#ededed' }}>{summary.totalUniqueInApi}</span>
          {' '}checked
        </span>
        <span>
          <span style={{ color: '#3fb950' }}>{summary.totalFoundInDb}</span>
          {' '}found
        </span>
        {summary.totalNotFoundInDb > 0 && (
          <span>
            <span style={{ color: '#f85149' }}>{summary.totalNotFoundInDb}</span>
            {' '}missing
          </span>
        )}
        <span style={{ color: pctColor(pct), fontWeight: 500 }}>{pct}%</span>
      </div>

      {/* Missing IDs toggle */}
      {notFoundIds.length > 0 && (
        <div className="mt-[10px]">
          <button
            onClick={() => setMissOpen((o) => !o)}
            className="rounded-[6px] px-[10px] py-[5px] font-mono text-[11.5px] transition-colors"
            style={{
              background: 'rgba(248,81,73,0.08)',
              border:     '1px solid rgba(248,81,73,0.2)',
              color:      '#f4a59f',
              cursor:     'pointer',
            }}
          >
            {missOpen ? '▾' : '▶'} {notFoundIds.length} missing ID{notFoundIds.length !== 1 ? 's' : ''}
          </button>

          {missOpen && (
            <div className="mt-[8px] flex flex-wrap gap-[5px]">
              {notFoundIds.map((entityId) => (
                <span
                  key={entityId}
                  className="rounded-[5px] px-[8px] py-[2px] font-mono text-[11px]"
                  style={{
                    background: 'rgba(248,81,73,0.08)',
                    border:     '1px solid rgba(248,81,73,0.18)',
                    color:      '#f4a59f',
                  }}
                >
                  {entityId}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
