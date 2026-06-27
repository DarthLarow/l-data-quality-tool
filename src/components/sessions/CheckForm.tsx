'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EntityType, CheckType, Environment, PolygonStrategy, CheckSessionInput } from '@/types'
import { ENTITY_TYPES } from '@/types'

interface ScraperOption {
  appId:  string
  name:   string
  cities: string[]
}

const CHECK_DEFS: { ct: CheckType; title: string; desc: string }[] = [
  { ct: 'api_db', title: 'API → DB',       desc: 'Each API entity searched in scrapers_db by ID' },
  { ct: 'ai',     title: 'AI Comparison',   desc: 'AI evaluates data quality between API and DB snapshots' },
  { ct: 'delta',  title: 'Delta',           desc: 'Detects anomalous count changes vs. previous session' },
]

const POLYGON_OPTIONS: { value: PolygonStrategy; label: string }[] = [
  { value: 'random',         label: 'Random'        },
  { value: 'by_id',          label: 'By ID'         },
  { value: 'by_city_all',    label: 'City — all'    },
  { value: 'by_city_random', label: 'City — random' },
]

// ── Shared primitives ────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-[8px] text-[12px] font-medium" style={{ color: '#9a9a9a' }}>
      {children}
    </div>
  )
}

function PillToggle({ active, onClick, children, disabled }: {
  active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className="rounded-[7px] px-[11px] py-[6px] text-[12.5px] transition-colors"
      style={{
        border:     active ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.1)',
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color:      active ? '#ededed' : disabled ? '#4a4a4a' : '#8a8a8a',
        cursor:     disabled ? 'not-allowed' : 'pointer',
        opacity:    disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function MonoInput({ value, onChange, placeholder, required }: {
  value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean
}) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-[7px]"
      style={{ border: '1px solid rgba(255,255,255,0.1)', maxWidth: '240px' }}>
      <span className="flex items-center px-[10px] font-mono text-[13px]"
        style={{
          color:       '#5e5e5e',
          background:  'rgba(255,255,255,0.04)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}>
        #
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'e.g. 1234'}
        required={required}
        className="flex-1 bg-transparent px-[10px] py-[8px] font-mono text-[13px] outline-none"
        style={{ color: '#ededed' }}
      />
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function CheckForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [scrapers, setScrapers] = useState<ScraperOption[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const [environment,               setEnvironment]     = useState<Environment>('staging')
  const [appId,                     setAppId]           = useState(searchParams.get('scraper') ?? '')
  const [scrapersSessionId,         setSessionId]       = useState('')
  const [previousScrapersSessionId, setPrevSessionId]   = useState('')
  const [polygonStrategy,           setPolygonStrategy] = useState<PolygonStrategy>('random')
  const [polygonId,                 setPolygonId]       = useState('')
  const [polygonCity,               setPolygonCity]     = useState('')
  const [selectedEntityTypes,       setEntityTypes]     = useState<EntityType[]>([])
  const [checksEnabled,             setChecksEnabled]   = useState<CheckType[]>(['api_db', 'delta'])
  const [aiSampleSize,              setAiSampleSize]    = useState(5)

  const selectedScraper = scrapers.find((s) => s.appId === appId)

  useEffect(() => {
    fetch('/api/scrapers').then((r) => r.json()).then(setScrapers).catch(console.error)
  }, [])

  function toggleEntityType(et: EntityType) {
    setEntityTypes((prev) => prev.includes(et) ? prev.filter((x) => x !== et) : [...prev, et])
  }

  function toggleCheckType(ct: CheckType) {
    setChecksEnabled((prev) => prev.includes(ct) ? prev.filter((x) => x !== ct) : [...prev, ct])
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
      const res  = await fetch('/api/checks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      const data = await res.json() as { sessionId?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Unknown error')
      router.push(`/sessions/${data.sessionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const canSubmit = !loading && !!appId && !!scrapersSessionId &&
                    selectedEntityTypes.length > 0 && checksEnabled.length > 0

  return (
    <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: '20px', maxWidth: '560px' }}>

      {/* ── Environment ─────────────────────────────────────────── */}
      <div>
        <FieldLabel>Environment</FieldLabel>
        <div className="flex w-fit overflow-hidden rounded-[7px]"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
          {(['staging', 'production'] as Environment[]).map((env, i) => (
            <button
              key={env}
              type="button"
              onClick={() => setEnvironment(env)}
              className="px-[16px] py-[8px] text-[13px] capitalize transition-colors"
              style={{
                background: environment === env ? 'rgba(255,255,255,0.09)' : 'transparent',
                color:      environment === env ? '#ededed' : '#8a8a8a',
                fontWeight: environment === env ? 500 : 400,
                borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                cursor:     'pointer',
              }}
            >
              {env}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scraper ─────────────────────────────────────────────── */}
      <div>
        <FieldLabel>Scraper</FieldLabel>
        <div className="relative" style={{ maxWidth: '340px' }}>
          <div className="pointer-events-none flex items-center justify-between rounded-[7px] px-[12px] py-[9px]"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
            <span className="text-[13px] font-medium"
              style={{ color: appId ? '#ededed' : '#6b6b6b' }}>
              {selectedScraper?.name ?? 'Select scraper'}
            </span>
            <span className="font-mono text-[12px]" style={{ color: '#6b6b6b' }}>
              {appId ? `${appId} ▾` : '▾'}
            </span>
          </div>
          <select
            value={appId}
            onChange={(e) => { setAppId(e.target.value); setEntityTypes([]) }}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
            required
          >
            <option value="">Select scraper</option>
            {scrapers.map((s) => (
              <option key={s.appId} value={s.appId}>{s.name} ({s.appId})</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Session ID ──────────────────────────────────────────── */}
      <div>
        <FieldLabel>Scrapers Session ID</FieldLabel>
        <MonoInput value={scrapersSessionId} onChange={setSessionId} required />
      </div>

      {/* ── Check types ─────────────────────────────────────────── */}
      <div>
        <FieldLabel>Check Types</FieldLabel>
        <div className="flex flex-col gap-[6px]">
          {CHECK_DEFS.map(({ ct, title, desc }) => {
            const active = checksEnabled.includes(ct)
            return (
              <div
                key={ct}
                onClick={() => toggleCheckType(ct)}
                className="flex cursor-pointer items-center gap-[12px] rounded-[8px] px-[14px] py-[11px] transition-all"
                style={{
                  border:     active ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(255,255,255,0.08)',
                  background: active ? 'rgba(255,255,255,0.03)' : 'transparent',
                }}
              >
                {/* Custom checkbox */}
                <div className="flex shrink-0 items-center justify-center rounded-[5px]"
                  style={{
                    width:      '18px',
                    height:     '18px',
                    background: active ? '#ededed' : 'rgba(255,255,255,0.06)',
                    border:     active ? 'none'    : '1px solid rgba(255,255,255,0.15)',
                  }}>
                  {active && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1.5" stroke="#0a0a0a" strokeWidth="1.7"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div>
                  <div className="text-[13px] font-medium"
                    style={{ color: active ? '#ededed' : '#bdbdbd' }}>
                    {title}
                  </div>
                  <div className="text-[11px]" style={{ color: '#7a7a7a' }}>{desc}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Polygon strategy ────────────────────────────────────── */}
      <div>
        <FieldLabel>Polygon</FieldLabel>
        <div className="flex flex-wrap gap-[6px]">
          {POLYGON_OPTIONS.map((opt) => (
            <PillToggle
              key={opt.value}
              active={polygonStrategy === opt.value}
              onClick={() => setPolygonStrategy(opt.value)}
            >
              {opt.label}
            </PillToggle>
          ))}
        </div>

        {polygonStrategy === 'by_id' && (
          <div className="mt-[10px] flex items-stretch overflow-hidden rounded-[7px]"
            style={{ border: '1px solid rgba(255,255,255,0.1)', maxWidth: '240px' }}>
            <input
              type="text"
              value={polygonId}
              onChange={(e) => setPolygonId(e.target.value)}
              placeholder="Polygon ID"
              className="flex-1 bg-transparent px-[12px] py-[8px] font-mono text-[13px] outline-none"
              style={{ color: '#ededed' }}
            />
          </div>
        )}

        {(polygonStrategy === 'by_city_all' || polygonStrategy === 'by_city_random') && (
          <div className="mt-[10px]">
            {selectedScraper && selectedScraper.cities.length > 0 ? (
              <div className="flex flex-wrap gap-[6px]">
                {selectedScraper.cities.map((city) => (
                  <PillToggle
                    key={city}
                    active={polygonCity === city}
                    onClick={() => setPolygonCity(city)}
                  >
                    {city}
                  </PillToggle>
                ))}
              </div>
            ) : (
              <div className="flex items-stretch overflow-hidden rounded-[7px]"
                style={{ border: '1px solid rgba(255,255,255,0.1)', maxWidth: '240px' }}>
                <input
                  type="text"
                  value={polygonCity}
                  onChange={(e) => setPolygonCity(e.target.value)}
                  placeholder="City name"
                  className="flex-1 bg-transparent px-[12px] py-[8px] text-[13px] outline-none"
                  style={{ color: '#ededed' }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Entity types ────────────────────────────────────────── */}
      <div>
        <FieldLabel>Entity Types</FieldLabel>
        <div className="flex flex-wrap gap-[6px]">
          {ENTITY_TYPES.map((et) => (
            <PillToggle
              key={et}
              active={selectedEntityTypes.includes(et)}
              onClick={() => toggleEntityType(et)}
              disabled={!appId}
            >
              {et}
            </PillToggle>
          ))}
        </div>
        {!appId && (
          <p className="mt-[6px] text-[11px]" style={{ color: '#6b6b6b' }}>
            Select a scraper first
          </p>
        )}
      </div>

      {/* ── AI Sample Size ──────────────────────────────────────── */}
      {checksEnabled.includes('ai') && (
        <div>
          <FieldLabel>AI Sample Size</FieldLabel>
          <div className="rounded-[8px] p-[14px_16px]"
            style={{
              background: '#0d0d0d',
              border:     '1px solid rgba(255,255,255,0.08)',
              maxWidth:   '280px',
            }}>
            <div className="flex items-center gap-[14px]">
              <button
                type="button"
                onClick={() => setAiSampleSize((n) => Math.max(1, n - 1))}
                className="flex shrink-0 items-center justify-center rounded-[6px] text-[16px] leading-none"
                style={{
                  width:      '26px',
                  height:     '26px',
                  border:     '1px solid rgba(255,255,255,0.12)',
                  color:      '#bdbdbd',
                  cursor:     'pointer',
                  background: 'transparent',
                }}>
                −
              </button>
              <span className="min-w-[28px] text-center font-mono text-[15px] font-semibold"
                style={{ color: '#ededed' }}>
                {aiSampleSize}
              </span>
              <button
                type="button"
                onClick={() => setAiSampleSize((n) => Math.min(20, n + 1))}
                className="flex shrink-0 items-center justify-center rounded-[6px] text-[14px] leading-none"
                style={{
                  width:      '26px',
                  height:     '26px',
                  border:     '1px solid rgba(255,255,255,0.12)',
                  color:      '#bdbdbd',
                  cursor:     'pointer',
                  background: 'transparent',
                }}>
                +
              </button>
            </div>

            {/* Progress bar */}
            <div className="mt-[10px] overflow-hidden rounded-full"
              style={{ height: '4px', background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full transition-all duration-150"
                style={{ width: `${(aiSampleSize / 20) * 100}%`, background: '#ededed' }} />
            </div>

            {/* Range labels */}
            <div className="mt-[5px] flex justify-between font-mono text-[10px]"
              style={{ color: '#5e5e5e' }}>
              <span>1</span>
              <span>20</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Previous Session ID ─────────────────────────────────── */}
      {checksEnabled.includes('delta') && (
        <div>
          <FieldLabel>
            Previous Session ID{' '}
            <span style={{ color: '#6b6b6b', fontWeight: 400 }}>for Delta</span>
          </FieldLabel>
          <MonoInput
            value={previousScrapersSessionId}
            onChange={setPrevSessionId}
            placeholder="e.g. 1233"
          />
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────── */}
      {error && (
        <p className="rounded-[6px] px-[12px] py-[8px] text-[12px]"
          style={{
            background: 'rgba(248,81,73,0.1)',
            border:     '1px solid rgba(248,81,73,0.2)',
            color:      '#f4a59f',
          }}>
          {error}
        </p>
      )}

      {/* ── Submit ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-[14px] pt-[2px]">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-[8px] px-[20px] py-[10px] text-[13px] font-semibold transition-opacity"
          style={{
            background: '#ededed',
            color:      '#0a0a0a',
            cursor:     canSubmit ? 'pointer' : 'not-allowed',
            opacity:    canSubmit ? 1 : 0.45,
          }}
        >
          {loading ? 'Running…' : 'Run Check →'}
        </button>
        {selectedEntityTypes.length > 0 && !loading && (
          <span className="font-mono text-[11.5px]" style={{ color: '#6b6b6b' }}>
            · {selectedEntityTypes.length} entity type{selectedEntityTypes.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

    </form>
  )
}
