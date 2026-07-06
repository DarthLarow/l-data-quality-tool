'use client'
import { useState } from 'react'
import type { EntityCheckSummary, PolygonCheck } from '@/generated/prisma/client'

interface Props {
  summary: EntityCheckSummary
  polygonChecks: PolygonCheck[]
}

function pctColor(p: number) {
  return p >= 98 ? 'var(--dq-green)' : p >= 94 ? 'var(--dq-amber)' : 'var(--dq-red)'
}

export function ApiDbResultsTab({ summary, polygonChecks }: Props) {
  const [missOpen, setMissOpen] = useState(false)
  const [failedOpen, setFailedOpen] = useState(false)

  const pct = summary.totalUniqueInApi > 0
    ? Math.round((summary.totalFoundInDb / summary.totalUniqueInApi) * 100)
    : 0
  const notFoundIds = [...new Set(polygonChecks.flatMap((p) => p.notFoundInDb as string[]))]

  // Snapshot coverage: how many entities were enriched with full details vs
  // list-only (detail cap exceeded). Total is over collected entities, not the
  // unique-in-API set, so it reflects what field comparison actually saw.
  const collected     = summary.detailedCount + summary.listOnlyCount
  const enrichedPct    = collected > 0 ? Math.round((summary.detailedCount / collected) * 100) : 100
  const showCoverage   = summary.listOnlyCount > 0 || Boolean(summary.coverageNote)

  return (
    <div>
      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-[18px] font-mono text-[13px]"
        style={{ color: 'var(--dq-text-3)' }}>
        <span>
          <span style={{ color: 'var(--dq-text-1)' }}>{summary.totalUniqueInApi}</span>
          {' '}checked
        </span>
        <span style={{ color: 'var(--dq-text-8)' }}>·</span>
        <span>
          <span style={{ color: 'var(--dq-green)' }}>{summary.totalFoundInDb}</span>
          {' '}found
        </span>
        {summary.totalNotFoundInDb > 0 && (
          <>
            <span style={{ color: 'var(--dq-text-8)' }}>·</span>
            <span>
              <span style={{ color: 'var(--dq-red)' }}>{summary.totalNotFoundInDb}</span>
              {' '}missing
            </span>
          </>
        )}
        <span style={{ color: 'var(--dq-text-8)' }}>·</span>
        <span style={{ color: pctColor(pct), fontWeight: 500 }}>{pct}%</span>
      </div>

      {/* Snapshot coverage (two-step adapters): shown only when a cap kicked in */}
      {showCoverage && (
        <div
          className="mt-[10px] rounded-[6px] px-[10px] py-[6px] font-mono text-[12px]"
          style={{
            background: 'var(--dq-amber-bg)',
            border:     '1px solid color-mix(in srgb, var(--dq-amber) 25%, transparent)',
            color:      'var(--dq-amber)',
          }}
        >
          {summary.listOnlyCount > 0 && (
            <div>
              {collected} collected · {summary.detailedCount} enriched with details ({enrichedPct}%)
              {' · '}{summary.listOnlyCount} list-only (field compare skipped)
            </div>
          )}
          {summary.coverageNote && (
            <div style={{ marginTop: summary.listOnlyCount > 0 ? '4px' : 0 }}>
              ⚠ {summary.coverageNote}
            </div>
          )}
        </div>
      )}

      {/* Suspected block warning */}
      {summary.suspectedBlock && (
        <div
          className="mt-[10px] rounded-[6px] px-[10px] py-[6px] font-mono text-[12px]"
          style={{
            background: 'var(--dq-amber-bg)',
            border:     '1px solid color-mix(in srgb, var(--dq-amber) 25%, transparent)',
            color:      'var(--dq-amber)',
          }}
        >
          ⚠ {summary.failedPolygons.length} polygon{summary.failedPolygons.length !== 1 ? 's' : ''} failed after retry — results may be incomplete (suspected rate limit)
        </div>
      )}

      {/* Failed polygons toggle */}
      {summary.suspectedBlock && summary.failedPolygons.length > 0 && (
        <div className="mt-[10px]">
          <button
            onClick={() => setFailedOpen((o) => !o)}
            className="rounded-[6px] px-[10px] py-[5px] font-mono text-[11.5px] transition-colors"
            style={{
              background: 'var(--dq-amber-bg)',
              border:     '1px solid color-mix(in srgb, var(--dq-amber) 25%, transparent)',
              color:      'var(--dq-amber)',
              cursor:     'pointer',
            }}
          >
            {failedOpen ? '▾' : '▶'} {summary.failedPolygons.length} failed polygon{summary.failedPolygons.length !== 1 ? 's' : ''}
          </button>

          {failedOpen && (
            <div className="mt-[8px] flex flex-wrap gap-[5px]">
              {summary.failedPolygons.map((polygonId) => (
                <span
                  key={polygonId}
                  className="rounded-[5px] px-[8px] py-[2px] font-mono text-[11px]"
                  style={{
                    background: 'var(--dq-amber-bg)',
                    border:     '1px solid color-mix(in srgb, var(--dq-amber) 20%, transparent)',
                    color:      'var(--dq-amber)',
                  }}
                >
                  {polygonId}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Missing IDs toggle */}
      {notFoundIds.length > 0 && (
        <div className="mt-[10px]">
          <button
            onClick={() => setMissOpen((o) => !o)}
            className="rounded-[6px] px-[10px] py-[5px] font-mono text-[11.5px] transition-colors"
            style={{
              background: 'var(--dq-red-bg)',
              border:     '1px solid color-mix(in srgb, var(--dq-red) 25%, transparent)',
              color:      'var(--dq-red)',
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
                    background: 'var(--dq-red-bg)',
                    border:     '1px solid color-mix(in srgb, var(--dq-red) 20%, transparent)',
                    color:      'var(--dq-red)',
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
