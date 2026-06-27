import { ApiDbResultsTab } from './ApiDbResultsTab'
import { AiResultsTab }    from './AiResultsTab'
import type {
  CheckSession, EntityCheckSummary, PolygonCheck,
  SessionDeltaCheck, AiComparison,
} from '@/generated/prisma/client'

interface SessionWithResults extends CheckSession {
  entityCheckSummaries: EntityCheckSummary[]
  polygonChecks:        PolygonCheck[]
  sessionDeltaChecks:   SessionDeltaCheck[]
  aiComparisons:        AiComparison[]
}

interface Props { session: SessionWithResults }

const ENTITY_ORDER = ['dockless', 'docked', 'pricings', 'zones'] as const

function pctColor(p: number) {
  return p >= 98 ? '#3fb950' : p >= 94 ? '#d29922' : '#f85149'
}

export function SessionResultsTabs({ session }: Props) {
  const checks   = new Set(session.checksEnabled)
  const sections = ENTITY_ORDER.filter((et) => session.entityTypes.includes(et))

  const showApiDb = checks.has('api_db')
  const showAi    = checks.has('ai') || checks.has('api_db')

  const hasSummaryData =
    (showApiDb && session.entityCheckSummaries.length > 0) ||
    (showAi    && session.aiComparisons.length > 0)

  return (
    <div className="flex flex-col">
      {/* ── Summary card ─────────────────────────────────────────── */}
      {hasSummaryData && (
        <div className="mx-[22px] my-[18px] overflow-hidden rounded-[10px]"
          style={{
            border:              '1px solid rgba(255,255,255,0.08)',
            display:             'grid',
            gridTemplateColumns: showApiDb && showAi && session.aiComparisons.length > 0 ? '1fr 1fr' : '1fr',
          }}>

          {/* API → DB panel */}
          {showApiDb && session.entityCheckSummaries.length > 0 && (
            <div className="p-[16px_18px]"
              style={{ borderRight: showAi && session.aiComparisons.length > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
              <div className="mb-[12px] font-mono text-[11px] font-semibold"
                style={{ color: '#8a8a8a', letterSpacing: '0.06em' }}>
                API → DB
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {['ENTITY', 'CHECKED', 'FOUND', 'MISS', 'COV'].map((h) => (
                      <th key={h}
                        className={`pb-[8px] font-mono text-[10px] font-medium ${h !== 'ENTITY' ? 'text-right' : 'text-left'}`}
                        style={{ color: '#5e5e5e', letterSpacing: '0.04em' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sections.map((et) => {
                    const s = session.entityCheckSummaries.find((x) => x.entityType === et)
                    if (!s || s.totalUniqueInApi === 0) return null
                    const pct = Math.round((s.totalFoundInDb / s.totalUniqueInApi) * 100)
                    return (
                      <tr key={et} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td className="py-[5px] pr-[12px] text-[12px] capitalize" style={{ color: '#cfcfcf' }}>{et}</td>
                        <td className="py-[5px] pr-[8px] text-right font-mono text-[12px]" style={{ color: '#9a9a9a' }}>{s.totalUniqueInApi}</td>
                        <td className="py-[5px] pr-[8px] text-right font-mono text-[12px]" style={{ color: '#9a9a9a' }}>{s.totalFoundInDb}</td>
                        <td className="py-[5px] pr-[8px] text-right font-mono text-[12px]"
                          style={{ color: s.totalNotFoundInDb > 0 ? '#f85149' : '#5e5e5e' }}>
                          {s.totalNotFoundInDb > 0 ? `(−${s.totalNotFoundInDb})` : '—'}
                        </td>
                        <td className="py-[5px] text-right font-mono text-[12px] font-medium"
                          style={{ color: pctColor(pct) }}>
                          {pct}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* AI Comparison panel */}
          {showAi && session.aiComparisons.length > 0 && (
            <div className="p-[16px_18px]">
              <div className="mb-[12px] font-mono text-[11px] font-semibold"
                style={{ color: '#8a8a8a', letterSpacing: '0.06em' }}>
                AI COMPARISON
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {['ENTITY', 'SAME', 'SOMEWHAT', 'DIFF'].map((h) => (
                      <th key={h}
                        className={`pb-[8px] font-mono text-[10px] font-medium ${h !== 'ENTITY' ? 'text-right' : 'text-left'}`}
                        style={{ color: '#5e5e5e', letterSpacing: '0.04em' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sections.map((et) => {
                    const cts = session.aiComparisons.filter((a) => a.entityType === et)
                    if (cts.length === 0) return null
                    const cnt = cts.reduce<Record<string, number>>((acc, c) => {
                      acc[c.verdict] = (acc[c.verdict] ?? 0) + 1; return acc
                    }, {})
                    const dash = <span style={{ color: '#5e5e5e' }}>—</span>
                    return (
                      <tr key={et} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td className="py-[5px] pr-[12px] text-[12px] capitalize" style={{ color: '#cfcfcf' }}>{et}</td>
                        <td className="py-[5px] pr-[8px] text-right font-mono text-[12px]" style={{ color: '#3fb950' }}>
                          {cnt.Same ?? dash}
                        </td>
                        <td className="py-[5px] pr-[8px] text-right font-mono text-[12px]" style={{ color: '#d29922' }}>
                          {cnt.SomewhatSame ?? dash}
                        </td>
                        <td className="py-[5px] text-right font-mono text-[12px]" style={{ color: '#f85149' }}>
                          {cnt.Different ?? dash}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Sticky nav pills ─────────────────────────────────────── */}
      <nav className="sticky top-0 z-10 flex flex-wrap items-center gap-[8px] px-[22px] py-[12px]"
        style={{ background: '#0a0a0a', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {sections.map((et) => {
          const summary = session.entityCheckSummaries.find((s) => s.entityType === et)
          const aiCount = session.aiComparisons.filter((a) => a.entityType === et).length
          const pct = summary && summary.totalUniqueInApi > 0
            ? Math.round((summary.totalFoundInDb / summary.totalUniqueInApi) * 100)
            : null
          const dot  = pct === null ? 'rgba(255,255,255,0.2)' : pctColor(pct)
          const ptxt = pct === null ? '#6b6b6b'               : pctColor(pct)

          return (
            <a
              key={et}
              href={`#section-${et}`}
              className="flex items-center gap-[7px] rounded-[8px] px-[11px] py-[7px] text-[12.5px] font-medium no-underline transition-colors"
              style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.1)', color: '#cfcfcf' }}
            >
              <span className="shrink-0 rounded-full"
                style={{ width: '7px', height: '7px', background: dot }} />
              <span className="capitalize">{et}</span>
              {pct !== null && (
                <span className="font-mono text-[11px]" style={{ color: ptxt }}>{pct}%</span>
              )}
              {aiCount > 0 && (
                <span className="font-mono text-[11px]" style={{ color: '#6b6b6b' }}>· {aiCount} AI</span>
              )}
            </a>
          )
        })}
      </nav>

      {/* ── Entity sections ──────────────────────────────────────── */}
      <div className="flex flex-col gap-[14px] px-[22px] py-[18px]">
        {sections.map((et) => {
          const summary       = session.entityCheckSummaries.find((s) => s.entityType === et)
          const polygonChecks = session.polygonChecks.filter((p) => p.entityType === et)
          const aiComparisons = session.aiComparisons.filter((a) => a.entityType === et)
          const aiDiff        = aiComparisons.filter((a) => a.verdict === 'Different').length

          const pct = summary && summary.totalUniqueInApi > 0
            ? Math.round((summary.totalFoundInDb / summary.totalUniqueInApi) * 100)
            : null

          return (
            <section
              key={et}
              id={`section-${et}`}
              className="overflow-hidden rounded-[10px] scroll-mt-[60px]"
              style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {/* Section header */}
              <div className="flex items-center gap-[10px] px-[18px] py-[14px]"
                style={{ background: '#101010', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-[14px] font-semibold capitalize">{et}</span>
                {pct !== null && (
                  <span className="font-mono text-[13px] font-medium" style={{ color: pctColor(pct) }}>
                    {pct}%
                  </span>
                )}
                {aiComparisons.length > 0 && (
                  <span className="font-mono text-[12px]" style={{ color: '#6b6b6b' }}>
                    · {aiComparisons.length} AI
                  </span>
                )}
                {aiDiff > 0 && (
                  <span className="text-[12px]" style={{ color: '#f85149' }}>
                    + {aiDiff} different
                  </span>
                )}
              </div>

              {/* API → DB sub-section */}
              {showApiDb && (
                <div className="px-[18px] py-[14px]"
                  style={{
                    borderBottom: showAi && aiComparisons.length > 0
                      ? '1px solid rgba(255,255,255,0.07)'
                      : 'none',
                  }}>
                  <div className="mb-[10px] font-mono text-[10.5px] font-semibold"
                    style={{ color: '#7a7a7a', letterSpacing: '0.06em' }}>
                    API → DB · COMPLETENESS
                  </div>
                  {summary
                    ? <ApiDbResultsTab summary={summary} polygonChecks={polygonChecks} />
                    : <p className="text-[12px]" style={{ color: '#6b6b6b' }}>No data</p>}
                </div>
              )}

              {/* AI sub-section */}
              {showAi && aiComparisons.length > 0 && (
                <div className="px-[18px] py-[14px]">
                  <div className="mb-[10px] font-mono text-[10.5px] font-semibold"
                    style={{ color: '#7a7a7a', letterSpacing: '0.06em' }}>
                    AI COMPARISON
                  </div>
                  <AiResultsTab comparisons={aiComparisons} appId={session.appId} />
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
