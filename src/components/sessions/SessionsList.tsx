'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'

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

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function covSummary(s: EntitySummary[]) {
  if (!s.length) return null
  return s.reduce((a, r) => ({ found: a.found + r.totalFoundInDb, total: a.total + r.totalUniqueInApi }), { found: 0, total: 0 })
}

function aiSummary(c: { verdict: string }[]) {
  return c.reduce<Record<string, number>>((a, r) => { a[r.verdict] = (a[r.verdict] ?? 0) + 1; return a }, {})
}

function dotColor(s: SessionRow) {
  if (s.status === 'running') return '#4493f8'
  if (s.status === 'failed')  return '#f85149'
  const ai = aiSummary(s.aiComparisons)
  if (ai.Different) return '#f85149'
  const cov = covSummary(s.entityCheckSummaries)
  if (cov && cov.found < cov.total) return '#d29922'
  return '#3fb950'
}

function pctColor(p: number) {
  return p >= 98 ? '#3fb950' : p >= 94 ? '#d29922' : '#f85149'
}

const COLS = '100px 110px 80px 1fr 90px 150px 130px'

const STATUS_SEGMENTS = [
  { value: 'all',       label: 'All'         },
  { value: 'running',   label: 'In progress' },
  { value: 'completed', label: 'Completed'   },
  { value: 'failed',    label: 'Failed'      },
]

const DAYS_OPTIONS = [
  { value: '7',  label: 'Last 7 days'  },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '0',  label: 'All time'     },
]

/* ── Pill dropdown (native select wrapped) ────────────────────── */
function PillSelect({
  value, onChange, options, prefix,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  prefix?: string
}) {
  const current = options.find((o) => o.value === value)?.label ?? value
  return (
    <div className="relative flex items-center">
      <div className="flex items-center gap-[7px] rounded-[7px] px-[11px] py-[6px] text-[12px] pointer-events-none select-none"
        style={{ border: '1px solid rgba(255,255,255,0.1)', color: '#bdbdbd', whiteSpace: 'nowrap' }}>
        {prefix && <span>{prefix}</span>}
        <span>{current}</span>
        <span style={{ color: '#6b6b6b' }}>▾</span>
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

export function SessionsList() {
  const searchParams = useSearchParams()
  const router       = useRouter()

  const scraperParam = searchParams.get('scraper') ?? 'all'
  const statusParam  = searchParams.get('status')  ?? 'all'
  const daysParam    = searchParams.get('days')    ?? '7'

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [scrapers, setScrapers] = useState<ScraperOption[]>([])
  const [loading,  setLoading]  = useState(true)

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value === 'all' || value === '0') p.delete(key)
    else p.set(key, value)
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
    if (daysParam    !== '0')   p.set('days',     daysParam)
    fetch(`/api/sessions?${p.toString()}`)
      .then((r) => r.json())
      .then((d) => { setSessions(d as SessionRow[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [scraperParam, statusParam, daysParam])

  const scraperOptions: { value: string; label: string }[] = [
    { value: 'all', label: 'All scrapers' },
    ...scrapers.map((s) => ({ value: s.appId, label: s.name })),
  ]

  return (
    <div className="flex flex-col">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b px-[22px] py-[16px]"
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="text-[16px] font-semibold" style={{ letterSpacing: '-0.015em' }}>Sessions</div>
        <Link href="/sessions/new"
          className="rounded-[7px] px-[13px] py-[8px] text-[12px] font-semibold"
          style={{ background: '#ededed', color: '#0a0a0a' }}>
          ＋ New Check
        </Link>
      </div>

      {/* ── Filters bar ─────────────────────────────────────────── */}
      <div className="flex items-center gap-[10px] border-b px-[22px] py-[13px]"
        style={{ background: '#0b0b0b', borderColor: 'rgba(255,255,255,0.07)' }}>
        {/* Scraper pill dropdown */}
        <PillSelect
          value={scraperParam}
          onChange={(v) => setParam('scraper', v)}
          options={scraperOptions}
          prefix="Scraper"
        />

        {/* Status segmented control */}
        <div className="flex overflow-hidden rounded-[7px]"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
          {STATUS_SEGMENTS.map((seg, i) => (
            <button
              key={seg.value}
              onClick={() => setParam('status', seg.value)}
              className="px-[11px] py-[6px] text-[12px] transition-colors"
              style={{
                font:        statusParam === seg.value ? '500 12px inherit' : '400 12px inherit',
                background:  statusParam === seg.value ? 'rgba(255,255,255,0.08)' : 'transparent',
                color:       statusParam === seg.value ? '#ededed' : '#8a8a8a',
                borderLeft:  i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                cursor:      'pointer',
                whiteSpace:  'nowrap',
              }}
            >
              {seg.label}
            </button>
          ))}
        </div>

        {/* Days pill dropdown — right side */}
        <div className="ml-auto">
          <PillSelect
            value={daysParam}
            onChange={(v) => setParam('days', v)}
            options={DAYS_OPTIONS}
          />
        </div>
      </div>

      {/* ── Table content ───────────────────────────────────────── */}
      <div style={{ background: '#080808', padding: '4px 22px 18px' }}>
        {/* Table header */}
        <div className="grid items-center gap-[12px] border-b px-[4px] py-[11px] font-mono text-[10.5px] font-medium"
          style={{
            gridTemplateColumns: COLS,
            color: '#6b6b6b',
            letterSpacing: '0.06em',
            borderColor: 'rgba(255,255,255,0.07)',
          }}>
          <span>DATE</span>
          <span>SCRAPER</span>
          <span>SESSION</span>
          <span>ENTITIES</span>
          <span className="text-right">COVERAGE</span>
          <span>AI</span>
          <span>STATUS</span>
        </div>

        {loading && (
          <div className="py-8 text-center text-[12px]" style={{ color: '#6b6b6b' }}>Loading…</div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="py-8 text-center text-[12px]" style={{ color: '#6b6b6b' }}>No sessions found.</div>
        )}

        {!loading && sessions.map((s) => {
          const cov    = covSummary(s.entityCheckSummaries)
          const ai     = aiSummary(s.aiComparisons)
          const pct    = cov && cov.total > 0 ? Math.round((cov.found / cov.total) * 100) : null
          const dot    = dotColor(s)
          const isRun  = s.status === 'running'

          const aiText = Object.keys(ai).length > 0
            ? [
                ai.Same         ? `${ai.Same}S`        : '',
                ai.SomewhatSame ? `${ai.SomewhatSame}~` : '',
                ai.Different    ? `${ai.Different}✗`   : '',
              ].filter(Boolean).join(' · ')
            : '—'

          return (
            <div
              key={s.id}
              className="grid cursor-pointer items-center gap-[12px] px-[4px] py-[11px]"
              style={{
                gridTemplateColumns: COLS,
                fontSize:    '12.5px',
                borderBottom: '1px solid rgba(255,255,255,0.045)',
              }}
              onClick={() => router.push(`/sessions/${s.id}`)}
            >
              {/* DATE */}
              <span className="font-mono text-[12px]"
                style={{ color: isRun ? '#4493f8' : '#8a8a8a' }}
                title={new Date(s.createdAt).toLocaleString()}>
                {relTime(s.createdAt)}
              </span>

              {/* SCRAPER */}
              <span className="flex items-center gap-[7px] text-[12.5px] font-medium">
                <span className="shrink-0 rounded-full"
                  style={{ width: '7px', height: '7px', background: dot }} />
                {s.scraper?.name ?? s.appId}
              </span>

              {/* SESSION */}
              <span className="font-mono text-[12px]" style={{ color: '#bdbdbd' }}>
                #{s.scrapersSessionId}
              </span>

              {/* ENTITIES */}
              <span className="text-[12px]" style={{ color: '#9a9a9a' }}>
                {s.entityTypes.join(' · ')}
              </span>

              {/* COVERAGE */}
              <span className="text-right font-mono text-[12px] font-medium"
                style={{ color: pct !== null ? pctColor(pct) : '#6b6b6b' }}>
                {pct !== null ? `${pct}%` : '—'}
              </span>

              {/* AI */}
              <span className="font-mono text-[12px]" style={{ color: '#9a9a9a' }}>
                {aiText}
              </span>

              {/* STATUS */}
              {isRun ? (
                <span className="flex items-center gap-[6px] text-[12px] font-medium"
                  style={{ color: '#4493f8' }}>
                  <span className="rounded-full"
                    style={{ width: '6px', height: '6px', background: '#4493f8', flexShrink: 0,
                             animation: 'dqpulse 1.4s ease-out infinite' }} />
                  In progress
                </span>
              ) : s.status === 'failed' ? (
                <span className="text-[12px] font-medium" style={{ color: '#f85149' }}>Failed</span>
              ) : (
                <span className="text-[12px] font-medium" style={{ color: '#3fb950' }}>Completed</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
