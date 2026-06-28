'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from '@/lib/theme'

const navItems = [
  {
    href:  '/',
    label: 'Dashboard',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
        <rect x="1"   y="1"   width="5.2" height="5.2" rx="1.2" fill="currentColor" />
        <rect x="8.8" y="1"   width="5.2" height="5.2" rx="1.2" fill="currentColor" />
        <rect x="1"   y="8.8" width="5.2" height="5.2" rx="1.2" fill="currentColor" />
        <rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.2" fill="currentColor" />
      </svg>
    ),
  },
  {
    href:  '/sessions',
    label: 'Sessions',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
        <rect x="1" y="2"   width="13" height="2" rx="1" fill="currentColor" />
        <rect x="1" y="6.5" width="13" height="2" rx="1" fill="currentColor" />
        <rect x="1" y="11"  width="13" height="2" rx="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href:  '/sessions/new',
    label: 'New Check',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
        <rect x="6.5" y="1"   width="2"  height="13" rx="1" fill="currentColor" />
        <rect x="1"   y="6.5" width="13" height="2"  rx="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href:  '/config',
    label: 'Config',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
        <rect x="1" y="3.7" width="13" height="1.7" rx="0.8" fill="currentColor" />
        <circle cx="5"  cy="4.55"  r="2.3" fill="currentColor" />
        <rect x="1" y="9.6" width="13" height="1.7" rx="0.8" fill="currentColor" />
        <circle cx="10" cy="10.45" r="2.3" fill="currentColor" />
      </svg>
    ),
  },
]

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 1v1.5M7 11.5V13M13 7h-1.5M2.5 7H1M11.24 2.76l-1.06 1.06M3.82 10.18l-1.06 1.06M11.24 11.24l-1.06-1.06M3.82 3.82l-1.06-1.06"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M11.5 8A5 5 0 1 1 6 2.5c-.3 1.2-.2 4 2.8 5.8 1 .6 2 .8 2.7.7z"
        stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Sidebar() {
  const pathname  = usePathname()
  const { theme, setTheme } = useTheme()

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    if (href === '/sessions') {
      return pathname === '/sessions' ||
        (pathname.startsWith('/sessions/') && !pathname.startsWith('/sessions/new'))
    }
    return pathname.startsWith(href)
  }

  return (
    <aside
      className="flex h-full w-[212px] shrink-0 flex-col gap-[3px] border-r px-[13px] py-[18px]"
      style={{ background: 'var(--dq-bg-5)', borderColor: 'var(--dq-border-1)' }}
    >
      {/* ── Logo ──────────────────────────────────────────────── */}
      <div className="mb-0 flex items-center gap-[9px] px-[7px] pb-[18px] pt-[2px]">
        <div
          className="flex size-6 shrink-0 items-center justify-center rounded-[6px]"
          style={{ background: 'var(--dq-logo-bg)' }}
        >
          <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--dq-logo-fg)' }}>DQ</span>
        </div>
        <div className="flex flex-col" style={{ lineHeight: 1.15 }}>
          <span className="text-[13px] font-semibold" style={{ letterSpacing: '-0.01em', color: 'var(--dq-text-1)' }}>
            Data Quality
          </span>
          <span className="font-mono text-[10px]" style={{ color: 'var(--dq-text-8)' }}>v2.4 · internal</span>
        </div>
      </div>

      {/* ── Section label ─────────────────────────────────────── */}
      <div
        className="px-[8px] pb-[4px] pt-[6px] font-mono text-[10px] font-medium"
        style={{ letterSpacing: '0.08em', color: 'var(--dq-text-8)' }}
      >
        CHECKS
      </div>

      {/* ── Nav ───────────────────────────────────────────────── */}
      {navItems.map(({ href, label, icon }) => {
        const active = isActive(href)
        return (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-[10px] rounded-[7px] px-[9px] py-[7px] text-[13px] font-medium transition-colors"
            style={{
              background: active ? 'var(--dq-border-1)' : 'transparent',
              color:      active ? 'var(--dq-text-1)'   : 'var(--dq-text-5)',
            }}
          >
            {icon}
            {label}
          </Link>
        )
      })}

      {/* ── Theme toggle ──────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="mt-[6px] flex w-full items-center gap-[10px] rounded-[7px] px-[9px] py-[7px] text-[13px] font-medium transition-colors"
        style={{
          color:      'var(--dq-text-7)',
          background: 'transparent',
          border:     'none',
          cursor:     'pointer',
        }}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>

      {/* ── Bottom user block ─────────────────────────────────── */}
      <div
        className="mt-auto flex items-center gap-[9px] px-[8px] py-[9px]"
        style={{ borderTop: '1px solid var(--dq-border-1)' }}
      >
        <div
          className="flex size-[26px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold"
          style={{
            background: 'var(--dq-bg-4)',
            border:     '1px solid var(--dq-border-2)',
            color:      'var(--dq-text-4)',
          }}
        >
          QA
        </div>
        <div className="flex min-w-0 flex-1 flex-col" style={{ lineHeight: 1.2 }}>
          <span className="text-[12px] font-medium" style={{ color: 'var(--dq-text-2)' }}>qa-runner</span>
          <span className="font-mono text-[10px]"    style={{ color: 'var(--dq-text-8)' }}>scrapers_db</span>
        </div>
      </div>
    </aside>
  )
}
