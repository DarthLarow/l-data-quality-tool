import type { SessionDeltaCheck } from '@/generated/prisma/client'

const FLAG_COLOR: Record<string, string> = {
  ok:       '#3fb950',
  warning:  '#d29922',
  critical: '#f85149',
}

const FLAG_BG: Record<string, string> = {
  ok:       'rgba(63,185,80,0.12)',
  warning:  'rgba(210,153,34,0.12)',
  critical: 'rgba(248,81,73,0.12)',
}

interface Props { deltaCheck: SessionDeltaCheck }

export function DeltaResultsTab({ deltaCheck }: Props) {
  const flag   = deltaCheck.deltaFlag as string
  const color  = FLAG_COLOR[flag] ?? '#9a9a9a'
  const bgCol  = FLAG_BG[flag]    ?? 'rgba(255,255,255,0.07)'
  const sign   = deltaCheck.deltaPercent >= 0 ? '+' : ''

  return (
    <div className="flex flex-wrap items-center gap-[18px] font-mono text-[13px]"
      style={{ color: '#bdbdbd' }}>
      <span>
        <span style={{ color: '#ededed' }}>{deltaCheck.currentCount.toLocaleString()}</span>
        {' '}current
      </span>
      <span style={{ color: '#5e5e5e' }}>·</span>
      <span>
        <span style={{ color: '#9a9a9a' }}>{deltaCheck.previousCount.toLocaleString()}</span>
        {' '}previous
      </span>
      <span style={{ color: '#5e5e5e' }}>·</span>
      <span style={{ color, fontWeight: 500 }}>
        {sign}{deltaCheck.deltaPercent.toFixed(1)}%
      </span>
      <span
        className="rounded-[5px] px-[8px] py-[2px] font-mono text-[11px] font-medium"
        style={{ background: bgCol, color, border: `1px solid ${color}33` }}>
        {deltaCheck.deltaFlag}
      </span>
    </div>
  )
}
