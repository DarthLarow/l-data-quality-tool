'use client'
import { useState } from 'react'
import { ENTITY_TYPES } from '@/types'
import type { CheckType, Environment } from '@/types'
import type { AutoCheckConfig } from '@/generated/prisma/client'

interface ScraperInfo {
  appId:                string
  supportedEntityTypes: string[]
  cities:               string[]
}

interface Props {
  scraper:        ScraperInfo
  existingConfig: AutoCheckConfig | null
  onSaved:        () => void
  onCancel:       () => void
}

function PillToggle({ active, onClick, children, disabled }: {
  active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className="rounded-[6px] px-[10px] py-[5px] text-[12px] transition-colors"
      style={{
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

function FieldLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="mb-[7px] text-[12px] font-medium"
      style={{ color: 'var(--dq-text-4)', ...style }}>
      {children}
    </div>
  )
}

export function AutoCheckConfigForm({ scraper, existingConfig, onSaved, onCancel }: Props) {
  const [environment,     setEnvironment]     = useState<Environment>(
    (existingConfig?.environment as Environment) ?? 'staging',
  )
  const [entityTypes,     setEntityTypes]     = useState<string[]>(
    existingConfig !== null ? existingConfig.entityTypes : ENTITY_TYPES,
  )
  const [checks,          setChecks]          = useState<CheckType[]>(
    existingConfig !== null
      ? (existingConfig.checksEnabled as CheckType[])
      : ['api_db', 'delta'],
  )
  const [polygonStrategy, setPolygonStrategy] = useState(existingConfig?.polygonStrategy ?? 'random')
  const [polygonCity,     setPolygonCity]     = useState(existingConfig?.polygonCity ?? '')
  const [isActive,        setIsActive]        = useState(existingConfig?.isActive ?? true)
  const [saving,          setSaving]          = useState(false)

  const checksError = isActive && checks.length === 0

  function toggleEntity(et: string) {
    setEntityTypes((p) => p.includes(et) ? p.filter((x) => x !== et) : [...p, et])
  }
  function toggleCheck(ct: CheckType) {
    setChecks((p) => p.includes(ct) ? p.filter((x) => x !== ct) : [...p, ct])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/config/auto-check', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        appId: scraper.appId,
        environment,
        entityTypes,
        checksEnabled: checks,
        polygonStrategy,
        polygonCity: polygonCity || null,
        isActive,
      }),
    })
    setSaving(false)
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit}
      className="rounded-[9px] p-[16px_18px]"
      style={{ background: 'var(--dq-bg-4)', border: '1px solid var(--dq-border-2)' }}>

      {/* Panel header */}
      <div className="mb-[14px] font-mono text-[11px] font-semibold"
        style={{ color: 'var(--dq-text-4)', letterSpacing: '0.05em' }}>
        AUTO-CHECK CONFIG · {scraper.appId.toUpperCase()}
      </div>

      <div className="flex flex-col gap-[14px]">

        {/* Environment */}
        <div>
          <FieldLabel>Environment</FieldLabel>
          <div className="flex w-fit overflow-hidden rounded-[7px]"
            style={{ border: '1px solid var(--dq-border-3)' }}>
            {(['staging', 'production'] as Environment[]).map((env, i) => (
              <button
                key={env}
                type="button"
                onClick={() => setEnvironment(env)}
                className="px-[14px] py-[6px] text-[12px] capitalize transition-colors"
                style={{
                  background: environment === env ? 'var(--dq-border-2)' : 'transparent',
                  color:      environment === env ? 'var(--dq-text-1)' : 'var(--dq-text-5)',
                  fontWeight: environment === env ? 500 : 400,
                  borderLeft: i > 0 ? '1px solid var(--dq-border-2)' : 'none',
                  cursor:     'pointer',
                }}
              >
                {env}
              </button>
            ))}
          </div>
        </div>

        {/* Polygon strategy */}
        <div>
          <FieldLabel>Polygon</FieldLabel>
          <div className="flex flex-wrap gap-[6px]">
            {[
              { value: 'random',         label: 'Random'        },
              { value: 'by_city_all',    label: 'City — all'    },
              { value: 'by_city_random', label: 'City — random' },
            ].map((opt) => (
              <PillToggle
                key={opt.value}
                active={polygonStrategy === opt.value}
                onClick={() => setPolygonStrategy(opt.value)}
              >
                {opt.label}
              </PillToggle>
            ))}
          </div>

          {(polygonStrategy === 'by_city_all' || polygonStrategy === 'by_city_random') && (
            <div className="mt-[8px]">
              {scraper.cities.length > 0 ? (
                <div className="flex flex-wrap gap-[6px]">
                  {scraper.cities.map((city) => (
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
                <input
                  type="text"
                  value={polygonCity}
                  onChange={(e) => setPolygonCity(e.target.value)}
                  placeholder="City name"
                  className="rounded-[6px] bg-transparent px-[10px] py-[6px] text-[12px] outline-none"
                  style={{ border: '1px solid var(--dq-border-3)', color: 'var(--dq-text-1)', maxWidth: '200px' }}
                />
              )}
            </div>
          )}
        </div>

        {/* Entity types */}
        <div>
          <FieldLabel>Entity Types</FieldLabel>
          <div className="flex flex-wrap gap-[6px]">
            {ENTITY_TYPES.map((et) => (
              <PillToggle
                key={et}
                active={entityTypes.includes(et)}
                onClick={() => toggleEntity(et)}
              >
                {et}
              </PillToggle>
            ))}
          </div>
        </div>

        {/* Check types */}
        <div>
          <FieldLabel style={checksError ? { color: 'var(--dq-red)' } : undefined}>
            Check Types{checksError ? ' — enable at least one' : ''}
          </FieldLabel>
          <div className="flex flex-wrap gap-[6px]">
            {([
              ['api_db', 'API→DB']      as const,
              ['ai',     'Field Check'] as const,
              ['delta',  'Delta']       as const,
            ]).map(([ct, label]) => (
              <PillToggle
                key={ct}
                active={checks.includes(ct)}
                onClick={() => toggleCheck(ct)}
              >
                {label}
              </PillToggle>
            ))}
          </div>
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-[10px]">
          <div
            onClick={() => setIsActive((v) => !v)}
            style={{
              position:     'relative',
              width:        '34px',
              height:       '19px',
              borderRadius: '10px',
              background:   isActive ? 'var(--dq-green)' : 'var(--dq-border-4)',
              cursor:       'pointer',
              transition:   'background 0.15s',
              flexShrink:   0,
            }}
          >
            <div style={{
              position:     'absolute',
              top:          '2px',
              left:         isActive ? '17px' : '2px',
              width:        '15px',
              height:       '15px',
              borderRadius: '50%',
              background:   '#ffffff',
              transition:   'left 0.15s',
            }} />
          </div>
          <span className="text-[12px]" style={{ color: isActive ? 'var(--dq-text-2)' : 'var(--dq-text-7)' }}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-[8px] pt-[2px]">
          <button
            type="submit"
            disabled={saving || checksError}
            className="rounded-[7px] px-[14px] py-[7px] text-[12px] font-semibold transition-opacity"
            style={{
              background: 'var(--dq-btn-bg)',
              color:      'var(--dq-btn-fg)',
              cursor:     saving || checksError ? 'not-allowed' : 'pointer',
              opacity:    saving || checksError ? 0.5 : 1,
              border:     'none',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[7px] px-[14px] py-[7px] text-[12px] font-medium transition-colors"
            style={{
              background: 'transparent',
              border:     '1px solid var(--dq-border-3)',
              color:      'var(--dq-text-5)',
              cursor:     'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}
