'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EntityType, CheckType, Environment, PolygonStrategy, CheckSessionInput } from '@/types'
import { ENTITY_TYPES } from '@/types'
import { SessionProgressBar } from '@/components/sessions/SessionProgressBar'

interface ScraperOption {
  appId:  string
  name:   string
  cities: string[]
}

const CHECK_DEFS: { ct: CheckType; title: string; desc: string }[] = [
  { ct: 'api_db', title: 'API → DB',       desc: 'Each API entity searched in scrapers_db by ID' },
  { ct: 'ai',     title: 'Field Check',      desc: 'Compares all matched entities field-by-field using mapping rules' },
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
    <div className="mb-[8px] text-[12px] font-medium" style={{ color: 'var(--dq-text-4)' }}>
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
      className="rounded-[7px] px-[11px] py-[6px] outline-none"
      style={{
        fontSize:   '12.5px',
        lineHeight: '1',
        fontWeight: 400,
        whiteSpace: 'nowrap',
        border:     active ? '1px solid var(--dq-border-strong)' : '1px solid var(--dq-border-3)',
        background: active ? 'var(--dq-border-2)' : 'transparent',
        color:      active ? 'var(--dq-text-1)' : disabled ? 'var(--dq-text-8)' : 'var(--dq-text-5)',
        cursor:     disabled ? 'not-allowed' : 'pointer',
        opacity:    disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function MonoInput({ value, onChange, placeholder, required, disabled }: {
  value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; disabled?: boolean
}) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-[7px]"
      style={{ border: '1px solid var(--dq-border-3)', maxWidth: '240px', opacity: disabled ? 0.5 : 1 }}>
      <span className="flex items-center px-[10px] font-mono text-[13px]"
        style={{
          color:       'var(--dq-text-8)',
          background:  'var(--dq-border-1)',
          borderRight: '1px solid var(--dq-border-2)',
        }}>
        #
      </span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => { if (/^\d*$/.test(e.target.value)) onChange(e.target.value) }}
        placeholder={placeholder ?? 'e.g. 1234'}
        required={required}
        disabled={disabled}
        className="flex-1 bg-transparent px-[10px] py-[8px] font-mono text-[13px] outline-none"
        style={{ color: 'var(--dq-text-1)', cursor: disabled ? 'not-allowed' : 'text' }}
      />
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function CheckForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [scrapers, setScrapers] = useState<ScraperOption[]>([])
  const [loading,            setLoading]          = useState(false)
  const [error,              setError]            = useState<string | null>(null)
  const [launchedSessionId,  setLaunchedSessionId] = useState<string | null>(null)

  const [environment,               setEnvironment]     = useState<Environment>('staging')
  const [appId,                     setAppId]           = useState(searchParams.get('scraper') ?? '')
  const [scrapersSessionId,         setSessionId]       = useState('')
  const [previousScrapersSessionId, setPrevSessionId]   = useState('')
  const [polygonStrategy,           setPolygonStrategy] = useState<PolygonStrategy>('random')
  const [polygonId,                 setPolygonId]       = useState('')
  const [polygonCity,               setPolygonCity]     = useState('')
  const [selectedEntityTypes,       setEntityTypes]     = useState<EntityType[]>([])
  const [checksEnabled,             setChecksEnabled]   = useState<CheckType[]>(['api_db', 'delta'])
  const [prefilledFrom,             setPrefilledFrom]   = useState<'auto-check' | null>(null)
  const selectedScraper = scrapers.find((s) => s.appId === appId)

  // Progressive form: fields stay locked until a scraper is chosen. Picking one
  // prefills from its saved AutoCheckConfig (if any), otherwise reveals defaults.
  const locked = !appId

  useEffect(() => {
    fetch('/api/scrapers').then((r) => r.json()).then(setScrapers).catch(console.error)
  }, [])

  // If the scraper arrived via ?scraper= (deep link), run the prefill once
  // the scraper list is loaded so behaviour matches a manual pick.
  useEffect(() => {
    if (appId && prefilledFrom === null && scrapers.some((s) => s.appId === appId)) {
      void applyScraperPrefill(appId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrapers])

  async function applyScraperPrefill(newAppId: string) {
    try {
      const cfg = await fetch(`/api/config/auto-check?appId=${encodeURIComponent(newAppId)}`)
        .then((r) => (r.ok ? r.json() : null))
      if (cfg) {
        setEnvironment(cfg.environment as Environment)
        setEntityTypes(cfg.entityTypes as EntityType[])
        setChecksEnabled(cfg.checksEnabled as CheckType[])
        setPolygonStrategy(cfg.polygonStrategy as PolygonStrategy)
        if (cfg.polygonCity) setPolygonCity(cfg.polygonCity as string)
        setPrefilledFrom('auto-check')
      } else {
        setPrefilledFrom(null)
      }
    } catch {
      setPrefilledFrom(null)
    }
  }

  function onScraperChange(newAppId: string) {
    setAppId(newAppId)
    setEntityTypes([])
    setPrefilledFrom(null)
    if (newAppId) void applyScraperPrefill(newAppId)
  }

  function resetToDefaults() {
    setEnvironment('staging')
    setEntityTypes([])
    setChecksEnabled(['api_db', 'delta'])
    setPolygonStrategy('random')
    setPolygonId('')
    setPolygonCity('')
    setPrefilledFrom(null)
  }

  function toggleEntityType(et: EntityType) {
    if (locked) return
    setEntityTypes((prev) => prev.includes(et) ? prev.filter((x) => x !== et) : [...prev, et])
  }

  function toggleCheckType(ct: CheckType) {
    if (locked) return
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
      setLaunchedSessionId(data.sessionId ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const canSubmit = !loading && !!appId && !!scrapersSessionId &&
                    selectedEntityTypes.length > 0 && checksEnabled.length > 0

  return (
    <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: '20px', maxWidth: '560px' }}>

      {/* ── Scraper ─────────────────────────────────────────────── */}
      <div>
        <FieldLabel>Scraper</FieldLabel>
        <div className="relative" style={{ maxWidth: '340px' }}>
          <div className="pointer-events-none flex items-center justify-between rounded-[7px] px-[12px] py-[9px]"
            style={{ border: '1px solid var(--dq-border-3)' }}>
            <span className="text-[13px] font-medium"
              style={{ color: appId ? 'var(--dq-text-1)' : 'var(--dq-text-7)' }}>
              {selectedScraper?.name ?? 'Select scraper'}
            </span>
            <span className="font-mono text-[12px]" style={{ color: 'var(--dq-text-7)' }}>
              {appId ? `${appId} ▾` : '▾'}
            </span>
          </div>
          <select
            value={appId}
            onChange={(e) => onScraperChange(e.target.value)}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
            required
          >
            <option value="">Select scraper</option>
            {scrapers.map((s) => (
              <option key={s.appId} value={s.appId}>{s.name} ({s.appId})</option>
            ))}
          </select>
        </div>

        {locked && (
          <p className="mt-[8px] text-[11.5px]" style={{ color: 'var(--dq-text-7)' }}>
            Select a scraper to unlock the rest of the form.
          </p>
        )}
        {prefilledFrom === 'auto-check' && (
          <div className="mt-[8px] flex items-center gap-[10px]">
            <span className="rounded-[5px] px-[8px] py-[3px] font-mono text-[11px]"
              style={{ background: 'var(--dq-border-1)', color: 'var(--dq-text-4)' }}>
              Prefilled from auto-check config
            </span>
            <button
              type="button"
              onClick={resetToDefaults}
              className="text-[11.5px] underline"
              style={{ color: 'var(--dq-text-6)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Reset to defaults
            </button>
          </div>
        )}
      </div>

      {/* ── Environment ─────────────────────────────────────────── */}
      <div style={{ opacity: locked ? 0.5 : 1 }}>
        <FieldLabel>Environment</FieldLabel>
        <div className="flex w-fit overflow-hidden rounded-[7px]"
          style={{ border: '1px solid var(--dq-border-3)' }}>
          {(['staging', 'production'] as Environment[]).map((env, i) => (
            <button
              key={env}
              type="button"
              disabled={locked}
              onClick={() => setEnvironment(env)}
              className="px-[16px] py-[8px] text-[13px] capitalize transition-colors"
              style={{
                background: environment === env ? 'var(--dq-border-2)' : 'transparent',
                color:      environment === env ? 'var(--dq-text-1)' : 'var(--dq-text-5)',
                fontWeight: environment === env ? 500 : 400,
                borderLeft: i > 0 ? '1px solid var(--dq-border-2)' : 'none',
                cursor:     locked ? 'not-allowed' : 'pointer',
              }}
            >
              {env}
            </button>
          ))}
        </div>
      </div>

      {/* ── Session ID ──────────────────────────────────────────── */}
      <div style={{ opacity: locked ? 0.5 : 1 }}>
        <FieldLabel>Scrapers Session ID</FieldLabel>
        <MonoInput value={scrapersSessionId} onChange={setSessionId} required disabled={locked} />
      </div>

      {/* ── Check types ─────────────────────────────────────────── */}
      <div style={{ opacity: locked ? 0.5 : 1 }}>
        <FieldLabel>Check Types</FieldLabel>
        <div className="flex flex-col gap-[6px]">
          {CHECK_DEFS.map(({ ct, title, desc }) => {
            const active = checksEnabled.includes(ct)
            return (
              <div
                key={ct}
                onClick={() => toggleCheckType(ct)}
                className="flex items-center gap-[12px] rounded-[8px] px-[14px] py-[11px] transition-all"
                style={{
                  border:     active ? '1px solid var(--dq-border-4)' : '1px solid var(--dq-border-2)',
                  background: active ? 'var(--dq-border-1)' : 'transparent',
                  cursor:     locked ? 'not-allowed' : 'pointer',
                }}
              >
                {/* Custom checkbox */}
                <div className="flex shrink-0 items-center justify-center rounded-[5px]"
                  style={{
                    width:      '18px',
                    height:     '18px',
                    background: active ? 'var(--dq-btn-bg)' : 'var(--dq-border-1)',
                    border:     active ? 'none' : '1px solid var(--dq-border-4)',
                  }}>
                  {active && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1.5" stroke="var(--dq-btn-fg)" strokeWidth="1.7"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div>
                  <div className="text-[13px] font-medium"
                    style={{ color: active ? 'var(--dq-text-1)' : 'var(--dq-text-3)' }}>
                    {title}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--dq-text-6)' }}>{desc}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Polygon strategy ────────────────────────────────────── */}
      <div style={{ opacity: locked ? 0.5 : 1 }}>
        <FieldLabel>Polygon</FieldLabel>
        <div className="flex flex-wrap gap-[6px]">
          {POLYGON_OPTIONS.map((opt) => (
            <PillToggle
              key={opt.value}
              active={polygonStrategy === opt.value}
              disabled={locked}
              onClick={() => setPolygonStrategy(opt.value)}
            >
              {opt.label}
            </PillToggle>
          ))}
        </div>

        {polygonStrategy === 'by_id' && (
          <div className="mt-[10px] flex items-stretch overflow-hidden rounded-[7px]"
            style={{ border: '1px solid var(--dq-border-3)', maxWidth: '240px' }}>
            <input
              type="text"
              value={polygonId}
              onChange={(e) => setPolygonId(e.target.value)}
              placeholder="Polygon ID"
              disabled={locked}
              className="flex-1 bg-transparent px-[12px] py-[8px] font-mono text-[13px] outline-none"
              style={{ color: 'var(--dq-text-1)' }}
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
                    disabled={locked}
                    onClick={() => setPolygonCity(city)}
                  >
                    {city}
                  </PillToggle>
                ))}
              </div>
            ) : (
              <div className="flex items-stretch overflow-hidden rounded-[7px]"
                style={{ border: '1px solid var(--dq-border-3)', maxWidth: '240px' }}>
                <input
                  type="text"
                  value={polygonCity}
                  onChange={(e) => setPolygonCity(e.target.value)}
                  placeholder="City name"
                  disabled={locked}
                  className="flex-1 bg-transparent px-[12px] py-[8px] text-[13px] outline-none"
                  style={{ color: 'var(--dq-text-1)' }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Entity types ────────────────────────────────────────── */}
      <div style={{ opacity: locked ? 0.5 : 1 }}>
        <FieldLabel>Entity Types</FieldLabel>
        <div className="flex gap-[6px]">
          {ENTITY_TYPES.map((et) => (
            <PillToggle
              key={et}
              active={selectedEntityTypes.includes(et)}
              disabled={locked}
              onClick={() => toggleEntityType(et)}
            >
              {et}
            </PillToggle>
          ))}
        </div>
      </div>

      {/* ── Previous Session ID ─────────────────────────────────── */}
      {checksEnabled.includes('delta') && (
        <div style={{ opacity: locked ? 0.5 : 1 }}>
          <FieldLabel>
            Previous Session ID{' '}
            <span style={{ color: 'var(--dq-text-7)', fontWeight: 400 }}>for Delta</span>
          </FieldLabel>
          <MonoInput
            value={previousScrapersSessionId}
            onChange={setPrevSessionId}
            placeholder="e.g. 1233"
            disabled={locked}
          />
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────── */}
      {error && (
        <p className="rounded-[6px] px-[12px] py-[8px] text-[12px]"
          style={{
            background: 'var(--dq-red-bg)',
            border:     'color-mix(in srgb, var(--dq-red) 25%, transparent) 1px solid',
            color:      'var(--dq-red)',
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
            background: 'var(--dq-btn-bg)',
            color:      'var(--dq-btn-fg)',
            cursor:     canSubmit ? 'pointer' : 'not-allowed',
            opacity:    canSubmit ? 1 : 0.45,
            border:     'none',
          }}
        >
          {loading ? 'Running…' : 'Run Check →'}
        </button>
        {launchedSessionId ? (
          <>
            {/* Session launched — show progress bar */}
            <div className="mt-[4px]">
              <SessionProgressBar sessionId={launchedSessionId} />
            </div>
            {/* Link to session page */}
            <button
              type="button"
              onClick={() => router.push(`/sessions/${launchedSessionId}`)}
              className="mt-[10px] text-[12.5px] font-medium underline-offset-2"
              style={{ color: 'var(--dq-blue)', textDecoration: 'underline' }}
            >
              Open session →
            </button>
          </>
        ) : (
        <span className="font-mono text-[11.5px]"
          style={{
            color:      'var(--dq-text-7)',
            visibility: selectedEntityTypes.length > 0 && !loading ? 'visible' : 'hidden',
          }}>
          · {selectedEntityTypes.length} entity type{selectedEntityTypes.length !== 1 ? 's' : ''}
        </span>
        )}
      </div>

    </form>
  )
}
