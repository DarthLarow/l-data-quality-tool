'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, List, Play, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const navItems = [
  { href: '/',             label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sessions',     label: 'Sessions',  icon: List             },
  { href: '/sessions/new', label: 'Run Check', icon: Play             },
  { href: '/config',       label: 'Config',    icon: Settings         },
]

export function Sidebar() {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-background px-3 py-4">
      <div className="mb-6 px-2 text-sm font-semibold tracking-tight text-foreground">
        Data Quality
      </div>
      <nav className="flex flex-col gap-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}>
            <Button
              variant={isActive(href) ? 'secondary' : 'ghost'}
              className={cn('w-full justify-start gap-2 text-sm')}
            >
              <Icon size={15} />
              {label}
            </Button>
          </Link>
        ))}
      </nav>
    </aside>
  )
}
