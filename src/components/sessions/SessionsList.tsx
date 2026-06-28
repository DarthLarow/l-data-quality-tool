'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import type { DateRange } from 'react-day-picker'

interface EntitySummary {
  entityType:        string
  totalUniqueInApi:  number
  totalFoundInDb:    number
  totalNotFoundInDb: number
}
interface SessionRow {
  id:                  string
  createdAt:           string
  appId:               string
  scrapersSessionId:   number
  entityTypes:         string[]
  checksEnabled:       string[]
  status:              string
  scraper:             { name: string }
  entityCheckSummaries: EntitySummary[]
  aiComparisons:       { verdict: string }[]
}
interface ScraperOption { appId: string; name: string }

// ── Helpers ──────────────────────────────────────────────────────

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function lostCount(s: EntitySummary[]) {
  return s.reduce((a, r) => a + r.totalNotFoundInDb, 0)
}

function mismatchedCount(c: { verdict: string }[]) {
  return c.filter((r) => r.verdict !== 'Same').length
}

function dotColor(s: SessionRow) {
  if (s.status === 'running') return 'var(--dq-blue)'
  if (s.status === 'failed')  return 'var(--dq-red)'
  if (s.aiComparisons.some((c) => c.verdict === 'Different')) return 'var(--dq-red)'
  if (lostCount(s.entityCheckSummaries) > 0)                  return 'var(--dq-amber)'
  return 'var(--dq-green)'
}

function toIso(d: Date) { return d.toISOString().slice(0, 10) }

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

function fmtRange(from: string, to: string) {
  const fmt = (s: string) =>
    new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
  if (from === to) return fmt(from)
  return `${fmt(from)} — ${fmt(to)}`
}

// ── Constants ────────────────────────────────────────────────────

const COLS = '100px 110px 80px 1fr 120px 140px 130px'

const STATUS_SEGMENTS = [
  { value: 'all',       label: 'All'         },
  { value: 'running',   label: 'In progress' },
  { value: 'completed', label: 'Completed'   },
  { value: 'failed',    label: 'Failed'      },
]

// ── DateRangePicker ──────────────────────────────────────────────

const PRESETS = [
  { label: 'Today',       days: 0  },
  { label: 'Last 7 days', days: 6  },
  { label: 'Last 30 days', days: 29 },
]

function DateRangePicker({ from, to, onChange }: {
  from: string
  to:   string
  onChange: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)

  const selected: DateRange = {
    from: from ? new Date(from + 'T12:00:00') : undefined,
    to:   to   ? new Date(to   + 'T12:00:00') : undefined,
  }

  function handleSelect(range: DateRange | undefined) {
    const f = range?.from ? toIso(range.from) : ''
    const t = range?.to   ? toIso(range.to)   : ''
    onChange(f, t)
    if (f && t) setOpen(false)
  }

  function applyPreset(days: number) {
    const today = new Date()
    const f = toIso(addDays(today, -days))
    const t = toIso(today)
    onChange(f, t)
    setOpen(false)
  }

  function isPresetActive(days: number) {
    const today = new Date()
    return from === toIso(addDays(today, -days)) && to === toIso(today)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-[7px] rounded-[7px] px-[11px] py-[6px] text-[12px]"
          style={{
            border:     '1px solid var(--dq-border-3)',
            color:      'var(--dq-text-2)',
            background: 'transparent',
            cursor:     'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: 'var(--dq-text-5)' }}>
            <rect x="1" y="2" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M1 5h10" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4 1v2M8 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          {fmtRange(from, to)}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex" style={{ borderBottom: '1px solid var(--dq-border-2)' }}>
          {/* Presets sidebar */}
          <div className="flex flex-col gap-[4px] p-[10px]"
            style={{ borderRight: '1px solid var(--dq-border-2)', minWidth: '120px' }}>
            <div className="mb-[6px] px-[8px] font-mono text-[10px] font-medium"
              style={{ color: 'var(--dq-text-7)', letterSpacing: '0.06em' }}>
              PRESETS
            </div>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.days)}
                className="rounded-[6px] px-[8px] py-[5px] text-left text-[12px] transition-colors"
                style={{
                  background: isPresetActive(p.days) ? 'var(--dq-border-2)' : 'transparent',
                  color:      isPresetActive(p.days) ? 'var(--dq-text-1)' : 'var(--dq-text-4)',
                  border:     isPresetActive(p.days) ? '1px solid var(--dq-border-3)' : '1px solid transparent',
                  cursor:     'pointer',
                  fontWeight: isPresetActive(p.days) ? 500 : 400,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <Calendar
            mode="range"
            selected={selected}
            onSelect={handleSelect}
            numberOfMonths={2}
            disabled={{ after: new Date() }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Scraper pill dropdown ────────────────────────────────────────

function PillSelect({
  value, onChange, options, prefix,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  prefix?: string
}) {
  const current     = options.find((o) => o.value === value)?.label ?? value
  const longestLabel = options.reduce((a, o) => o.label.length > a.length ? o.label : a, '')

  return (
    <div className="relative" style={{ whiteSpace: 'nowrap' }}>
      {/* Invisible sizer — fixes width to longest option */}
      <div className="flex items-center gap-[7px] rounded-[7px] px-[11px] py-[6px] text-[12px] invisible select-none pointer-events-none"
        style={{ border: '1px solid transparent' }} aria-hidden>
        {prefix && <span>{prefix}</span>}
        <span>{longestLabel}</span>
        <span>▾</span>
      </div>
      {/* Visible label — absolutely overlays the sizer */}
      <div className="absolute inset-0 flex items-center gap-[7px] rounded-[7px] px-[11px] text-[12px] pointer-events-none select-none"
        style={{ border: '1px solid var(--dq-border-3)', color: 'var(--dq-text-3)' }}>
        {prefix && <span>{prefix}</span>}
        <span>{current}</span>
        <span style={{ color: 'var(--dq-text-7)' }}>▾</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full"
        style={{ fontSize: '12px' }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────

export function SessionsList() {
  const searchParams = useSearchParams()
  const router       = useRouter()

  const scraperParam = searchParams.get('scraper') ?? 'all'
  const statusParam  = searchParams.get('status')  ?? 'all'
  const fromParam    = searchParams.get('from')    ?? ''
  const toParam      = searchParams.get('to')      ?? ''

  // Default: last 7 days
  const today        = useMemo(() => toIso(new Date()), [])
  const defaultFrom  = useMemo(() => toIso(addDays(new Date(), -6)), [])
  const effectiveFrom = fromParam || defaultFrom
  const effectiveTo   = toParam   || today

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [scrapers, setScrapers] = useState<ScraperOption[]>([])
  const [loading,  setLoading]  = useState(true)

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value === 'all') p.delete(key)
    else p.set(key, value)
    router.push(`/sessions?${p.toString()}`)
  }

  function setDates(from: string, to: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (from) p.set('from', from) ; else p.delete('from')
    if (to)   p.set('to',   to)   ; else p.delete('to')
    router.push(`/sessions?${p.toString()}`)
  }

  useEffect(() => {
    fetch('/api/scrapers').then((r) => r.json()).then((d) => setScrapers(d as ScraperOption[])).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (scraperParam !== 'all') p.set('scraper', scraperParam)
    if (statusParam  !== 'all') p.set('status',  statusParam)
    p.set('from', effectiveFrom)
    p.set('to',   effectiveTo)
    fetch(`/api/sessions?${p.toString()}`)
      .then((r) => r.json())
      .then((d) => { setSessions(d as SessionRow[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [scraperParam, statusParam, effectiveFrom, effectiveTo])

  const scraperOptions: { value: string; label: string }[] = [
    { value: 'all', label: 'All scrapers' },
    ...scrapers.map((s) => ({ value: s.appId, label: s.name })),
  ]

  return (
    <div className="flex flex-col">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b px-[22px] py-[16px]"
        style={{ borderColor: 'var(--dq-border-1)' }}>
        <div className="text-[16px] font-semibold" style={{ letterSpacing: '-0.015em' }}>Sessions</div>
        <Link href="/sessions/new"
          className="rounded-[7px] px-[13px] py-[8px] text-[12px] font-semibold"
          style={{ background: 'var(--dq-btn-bg)', color: 'var(--dq-btn-fg)' }}>
          ＋ New Check
        </Link>
      </div>

      {/* ── Filters bar ─────────────────────────────────────────── */}
      <div className="flex items-center gap-[10px] border-b px-[22px] py-[13px]"
        style={{ background: 'var(--dq-bg-3)', borderColor: 'var(--dq-border-1)' }}>
        <PillSelect
          value={scraperParam}
          onChange={(v) => setParam('scraper', v)}
          options={scraperOptions}
          prefix="Scraper"
        />

        <div className="flex overflow-hidden rounded-[7px]"
          style={{ border: '1px solid var(--dq-border-3)' }}>
          {STATUS_SEGMENTS.map((seg, i) => (
            <button
              key={seg.value}
              onClick={() => setParam('status', seg.value)}
              className="px-[11px] py-[6px] text-[12px] transition-colors"
              style={{
                font:       statusParam === seg.value ? '500 12px inherit' : '400 12px inherit',
                background: statusParam === seg.value ? 'var(--dq-border-2)' : 'transparent',
                color:      statusParam === seg.value ? 'var(--dq-text-1)' : 'var(--dq-text-5)',
                borderLeft: i > 0 ? '1px solid var(--dq-border-2)' : 'none',
                cursor:     'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {seg.label}
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <DateRangePicker
            from={effectiveFrom}
            to={effectiveTo}
            onChange={setDates}
          />
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div style={{ background: 'var(--dq-bg-2)', padding: '4px 22px 18px' }}>
        <div className="grid items-center gap-[12px] border-b px-[4px] py-[11px] font-mono text-[10.5px] font-medium"
          style={{
            gridTemplateColumns: COLS,
            color:         'var(--dq-text-7)',
            letterSpacing: '0.06em',
            borderColor:   'var(--dq-border-1)',
          }}>
          <span>DATE</span>
          <span>SCRAPER</span>
          <span>SESSION</span>
          <span>ENTITIES</span>
          <span>LOST ENTITIES</span>
          <span>MISMATCHED</span>
          <span>STATUS</span>
        </div>

        {loading && (
          <div className="py-8 text-center text-[12px]" style={{ color: 'var(--dq-text-7)' }}>Loading…</div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="py-8 text-center text-[12px]" style={{ color: 'var(--dq-text-7)' }}>No sessions found.</div>
        )}

        {!loading && sessions.map((s) => {
          const lost       = lostCount(s.entityCheckSummaries)
          const mismatched = mismatchedCount(s.aiComparisons)
          const dot        = dotColor(s)
          const isRun      = s.status === 'running'

          return (
            <div
              key={s.id}
              className="grid cursor-pointer items-center gap-[12px] px-[4px] py-[11px]"
              style={{
                gridTemplateColumns: COLS,
                fontSize:     '12.5px',
                borderBottom: '1px solid var(--dq-border-1)',
              }}
              onClick={() => router.push(`/sessions/${s.id}`)}
            >
              <span className="font-mono text-[12px]"
                style={{ color: isRun ? 'var(--dq-blue)' : 'var(--dq-text-5)' }}
                title={new Date(s.createdAt).toLocaleString()}>
                {relTime(s.createdAt)}
              </span>

              <span className="flex items-center gap-[7px] text-[12.5px] font-medium">
                <span className="shrink-0 rounded-full"
                  style={{ width: '7px', height: '7px', background: dot }} />
                {s.scraper?.name ?? s.appId}
              </span>

              <span className="font-mono text-[12px]" style={{ color: 'var(--dq-text-3)' }}>
                #{s.scrapersSessionId}
              </span>

              <span className="text-[12px]" style={{ color: 'var(--dq-text-4)' }}>
                {s.entityTypes.join(' · ')}
              </span>

              <span className="font-mono text-[12px] font-semibold"
                style={{ color: lost > 0 ? 'var(--dq-red)' : 'var(--dq-text-7)' }}>
                {s.entityCheckSummaries.length > 0 ? lost : '—'}
              </span>

              <span className="font-mono text-[12px] font-semibold"
                style={{ color: mismatched > 0 ? 'var(--dq-amber)' : 'var(--dq-text-7)' }}>
                {s.aiComparisons.length > 0 ? mismatched : '—'}
              </span>

              {isRun ? (
                <span className="flex items-center gap-[6px] text-[12px] font-medium"
                  style={{ color: 'var(--dq-blue)' }}>
                  <span className="rounded-full"
                    style={{ width: '6px', height: '6px', background: 'var(--dq-blue)', flexShrink: 0,
                             animation: 'dqpulse 1.4s ease-out infinite' }} />
                  In progress
                </span>
              ) : s.status === 'failed' ? (
                <span className="text-[12px] font-medium" style={{ color: 'var(--dq-red)' }}>Failed</span>
              ) : (
                <span className="text-[12px] font-medium" style={{ color: 'var(--dq-green)' }}>Completed</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
