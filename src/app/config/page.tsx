'use client'
import { useState, useEffect, useCallback } from 'react'
import { AutoCheckConfigForm }    from '@/components/config/AutoCheckConfigForm'
import { ScraperThresholdEditor } from '@/components/config/ScraperThresholdEditor'
import type { AlertThreshold, AutoCheckConfig, Scraper } from '@/generated/prisma/client'

type OpenPanel = { appId: string; panel: 'autocheck' | 'thresholds' } | null

// ── Custom Switch ────────────────────────────────────────────────────────────

function CustomSwitch({ checked, disabled, onChange }: {
  checked: boolean; disabled?: boolean; onChange: () => void
}) {
  return (
    <div
      onClick={disabled ? undefined : onChange}
      style={{
        position:     'relative',
        width:        '34px',
        height:       '19px',
        borderRadius: '10px',
        background:   checked ? 'var(--dq-green)' : 'var(--dq-border-4)',
        cursor:       disabled ? 'not-allowed' : 'pointer',
        opacity:      disabled ? 0.6 : 1,
        transition:   'background 0.15s',
        flexShrink:   0,
      }}
    >
      <div style={{
        position:     'absolute',
        top:          '2px',
        left:         checked ? '17px' : '2px',
        width:        '15px',
        height:       '15px',
        borderRadius: '50%',
        background:   '#ffffff',
        transition:   'left 0.15s',
      }} />
    </div>
  )
}

// ── Icon button ──────────────────────────────────────────────────────────────

function IconBtn({ onClick, active, amber, title, children }: {
  onClick: () => void; active: boolean; amber?: boolean; title?: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex items-center justify-center rounded-[6px] transition-colors"
      style={{
        width:      '28px',
        height:     '28px',
        border:     active && amber
          ? '1px solid color-mix(in srgb, var(--dq-amber) 40%, transparent)'
          : '1px solid var(--dq-border-3)',
        background: active && amber
          ? 'var(--dq-amber-bg)'
          : active
          ? 'var(--dq-border-1)'
          : 'transparent',
        color:      active && amber ? 'var(--dq-amber)' : 'var(--dq-text-4)',
        cursor:     'pointer',
      }}
    >
      {children}
    </button>
  )
}

// ── SVG icons ────────────────────────────────────────────────────────────────

const PencilSVG = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M8.5 1.5L10.5 3.5L3.5 10.5H1.5V8.5L8.5 1.5Z"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M7 3L9 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)

const BellSVG = () => (
  <svg width="12" height="13" viewBox="0 0 12 13" fill="none">
    <path d="M6 2C4 2 2.5 3.5 2.5 5.5V8.5L1.5 9.5H10.5L9.5 8.5V5.5C9.5 3.5 8 2 6 2Z"
      stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4.5 9.5C4.5 10.3 5.2 11 6 11C6.8 11 7.5 10.3 7.5 9.5"
      stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
)

const SyncSVG = ({ spin }: { spin: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
    style={{ flexShrink: 0, animation: spin ? 'spin 1s linear infinite' : 'none' }}>
    <path d="M10 6A4 4 0 1 1 8.5 2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <polyline points="10 1 10 4 7 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// ── Page ─────────────────────────────────────────────────────────────────────

const COLS = '150px 1.4fr 1.3fr 130px'

export default function ConfigPage() {
  const [scrapers,    setScrapers]    = useState<Scraper[]>([])
  const [thresholds,  setThresholds]  = useState<AlertThreshold[]>([])
  const [autoConfigs, setAutoConfigs] = useState<AutoCheckConfig[]>([])
  const [syncing,     setSyncing]     = useState(false)
  const [open,        setOpen]        = useState<OpenPanel>(null)
  const [toggling,    setToggling]    = useState<string | null>(null)

  const load = useCallback(async () => {
    const [sc, th, ac] = await Promise.all([
      fetch('/api/scrapers').then((r) => r.json())          as Promise<Scraper[]>,
      fetch('/api/config/thresholds').then((r) => r.json()) as Promise<AlertThreshold[]>,
      fetch('/api/config/auto-check').then((r) => r.json()) as Promise<AutoCheckConfig[]>,
    ])
    setScrapers(sc)
    setThresholds(th)
    setAutoConfigs(ac)
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleSync() {
    setSyncing(true)
    await fetch('/api/scrapers/sync', { method: 'POST' })
    await load()
    setSyncing(false)
  }

  async function toggleAutoCheck(config: AutoCheckConfig) {
    setToggling(config.appId)
    await fetch('/api/config/auto-check', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...config, isActive: !config.isActive }),
    })
    await load()
    setToggling(null)
  }

  function togglePanel(appId: string, panel: 'autocheck' | 'thresholds') {
    setOpen((prev) =>
      prev?.appId === appId && prev.panel === panel ? null : { appId, panel },
    )
  }

  return (
    <div className="flex flex-col">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b px-[22px] py-[16px]"
        style={{ borderColor: 'var(--dq-border-1)' }}>
        <div>
          <div className="text-[16px] font-semibold" style={{ letterSpacing: '-0.015em' }}>
            Scraper Config
          </div>
          <div className="mt-[3px] text-[12px]" style={{ color: 'var(--dq-text-5)' }}>
            Auto-check schedules and alert thresholds
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-[7px] rounded-[7px] px-[12px] py-[7px] text-[12px] font-medium transition-colors"
          style={{
            border:     '1px solid var(--dq-border-4)',
            color:      'var(--dq-text-1)',
            cursor:     syncing ? 'not-allowed' : 'pointer',
            background: 'transparent',
            opacity:    syncing ? 0.7 : 1,
          }}
        >
          <SyncSVG spin={syncing} />
          {syncing ? 'Syncing…' : 'Sync from scrapers_db'}
        </button>
      </div>

      {/* ── Content area ────────────────────────────────────────── */}
      <div style={{ background: 'var(--dq-bg-2)' }}>
        {scrapers.length === 0 ? (
          <p className="py-16 text-center text-[12px]" style={{ color: 'var(--dq-text-7)' }}>
            No scrapers — click "Sync from scrapers_db" to load.
          </p>
        ) : (
          <>
            {/* Table header */}
            <div className="grid items-center gap-[12px] px-[22px] py-[10px] font-mono text-[10.5px] font-medium"
              style={{
                gridTemplateColumns: COLS,
                color:        'var(--dq-text-7)',
                letterSpacing: '0.06em',
                borderBottom: '1px solid var(--dq-border-1)',
              }}>
              <span>SCRAPER</span>
              <span>AUTO-CHECK</span>
              <span>THRESHOLDS</span>
              <span className="text-right">ACTIONS</span>
            </div>

            {/* Rows */}
            {scrapers.map((scraper) => {
              const config     = autoConfigs.find((c) => c.appId === scraper.appId) ?? null
              const scraperThr = thresholds.filter((t) => t.appId === scraper.appId)
              const isAutoOpen = open?.appId === scraper.appId && open.panel === 'autocheck'
              const isThrOpen  = open?.appId === scraper.appId && open.panel === 'thresholds'

              const dotColor = config?.isActive
                ? 'var(--dq-green)'
                : config
                ? 'var(--dq-amber)'
                : 'var(--dq-border-4)'

              return (
                <div key={scraper.appId} style={{ borderBottom: '1px solid var(--dq-border-1)' }}>
                  {/* Main row */}
                  <div className="grid items-start gap-[12px] px-[22px] py-[13px]"
                    style={{ gridTemplateColumns: COLS }}>

                    {/* SCRAPER */}
                    <div className="flex items-center gap-[8px]">
                      <span className="shrink-0 rounded-full"
                        style={{ width: '7px', height: '7px', background: dotColor }} />
                      <div>
                        <div className="text-[13px] font-medium">{scraper.name}</div>
                        <div className="font-mono text-[10.5px]" style={{ color: 'var(--dq-text-8)' }}>
                          {scraper.appId}
                        </div>
                      </div>
                    </div>

                    {/* AUTO-CHECK */}
                    <div>
                      {config ? (
                        <>
                          <div className="text-[12.5px]" style={{ color: 'var(--dq-text-2)' }}>
                            ● {config.environment} · {config.checksEnabled.map((c) => c === 'api_db' ? 'API→DB' : c).join(', ')}
                          </div>
                          <div className="mt-[2px] font-mono text-[11px]" style={{ color: 'var(--dq-text-7)' }}>
                            {config.entityTypes.join(' · ')}
                          </div>
                        </>
                      ) : (
                        <span className="text-[12px] italic" style={{ color: 'var(--dq-text-7)' }}>
                          not configured
                        </span>
                      )}
                    </div>

                    {/* THRESHOLDS */}
                    <div className="font-mono text-[12px]"
                      style={{ color: scraperThr.length > 0 ? 'var(--dq-text-3)' : 'var(--dq-text-7)' }}>
                      {scraperThr.length > 0
                        ? `${scraperThr.length} set${scraperThr.length !== 1 ? 's' : ''} configured`
                        : '—'}
                    </div>

                    {/* ACTIONS */}
                    <div className="flex items-center justify-end gap-[10px]">
                      {config && (
                        <CustomSwitch
                          checked={config.isActive}
                          disabled={toggling === scraper.appId}
                          onChange={() => toggleAutoCheck(config)}
                        />
                      )}
                      <IconBtn
                        active={isAutoOpen}
                        title="Configure auto-check"
                        onClick={() => togglePanel(scraper.appId, 'autocheck')}
                      >
                        <PencilSVG />
                      </IconBtn>
                      <IconBtn
                        active={isThrOpen}
                        amber
                        title="Alert thresholds"
                        onClick={() => togglePanel(scraper.appId, 'thresholds')}
                      >
                        <BellSVG />
                      </IconBtn>
                    </div>
                  </div>

                  {/* Inline panels */}
                  {isAutoOpen && (
                    <div className="px-[18px] pb-[14px]">
                      <AutoCheckConfigForm
                        scraper={{
                          appId:                scraper.appId,
                          supportedEntityTypes: scraper.supportedEntityTypes,
                          cities:               scraper.cities,
                        }}
                        existingConfig={config}
                        onSaved={async () => { await load(); setOpen(null) }}
                        onCancel={() => setOpen(null)}
                      />
                    </div>
                  )}

                  {isThrOpen && (
                    <div className="pb-[2px]">
                      <ScraperThresholdEditor
                        appId={scraper.appId}
                        scraperName={scraper.name}
                        thresholds={scraperThr}
                        onSaved={load}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* CSS for spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
