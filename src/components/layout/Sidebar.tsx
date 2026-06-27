'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

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

export function Sidebar() {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    if (href === '/sessions') {
      // session detail pages (/sessions/[id]) keep Sessions active; /sessions/new activates New Check
      return pathname === '/sessions' ||
        (pathname.startsWith('/sessions/') && !pathname.startsWith('/sessions/new'))
    }
    return pathname.startsWith(href)
  }

  return (
    <aside className="flex h-full w-[212px] shrink-0 flex-col gap-[3px] border-r px-[13px] py-[18px]"
      style={{ background: '#0c0c0c', borderColor: 'rgba(255,255,255,0.07)' }}>

      {/* ── Logo ──────────────────────────────────────────────── */}
      <div className="mb-0 flex items-center gap-[9px] px-[7px] pb-[18px] pt-[2px]">
        <div className="flex size-6 shrink-0 items-center justify-content-center rounded-[6px] bg-[#ededed]"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="font-mono text-[11px] font-bold text-[#0a0a0a]">DQ</span>
        </div>
        <div className="flex flex-col" style={{ lineHeight: 1.15 }}>
          <span className="text-[13px] font-semibold text-[#ededed]" style={{ letterSpacing: '-0.01em' }}>
            Data Quality
          </span>
          <span className="font-mono text-[10px] text-[#5e5e5e]">v2.4 · internal</span>
        </div>
      </div>

      {/* ── Section label ─────────────────────────────────────── */}
      <div className="px-[8px] pb-[4px] pt-[6px] font-mono text-[10px] font-medium text-[#5a5a5a]"
        style={{ letterSpacing: '0.08em' }}>
        CHECKS
      </div>

      {/* ── Nav ───────────────────────────────────────────────── */}
      {navItems.map(({ href, label, icon }) => {
        const active = isActive(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-[10px] rounded-[7px] px-[9px] py-[7px] text-[13px] font-medium transition-colors',
              active
                ? 'bg-white/[0.07] text-[#ededed]'
                : 'text-[#8a8a8a] hover:bg-white/[0.04] hover:text-[#cfcfcf]',
            )}
          >
            {icon}
            {label}
          </Link>
        )
      })}

      {/* ── Bottom user block ─────────────────────────────────── */}
      <div className="mt-auto flex items-center gap-[9px] px-[8px] py-[9px]"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex size-[26px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold text-[#9a9a9a]"
          style={{ background: '#1d1d1d', border: '1px solid rgba(255,255,255,0.08)' }}>
          QA
        </div>
        <div className="flex min-w-0 flex-col" style={{ lineHeight: 1.2 }}>
          <span className="text-[12px] font-medium text-[#cfcfcf]">qa-runner</span>
          <span className="font-mono text-[10px] text-[#5e5e5e]">scrapers_db</span>
        </div>
      </div>
    </aside>
  )
}
