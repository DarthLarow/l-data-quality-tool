import type { SessionDeltaCheck } from '@/generated/prisma/client'

const FLAG_COLOR: Record<string, string> = {
  ok:       'var(--dq-green)',
  warning:  'var(--dq-amber)',
  critical: 'var(--dq-red)',
}

const FLAG_BG: Record<string, string> = {
  ok:       'var(--dq-green-bg)',
  warning:  'var(--dq-amber-bg)',
  critical: 'var(--dq-red-bg)',
}

interface Props { deltaCheck: SessionDeltaCheck }

export function DeltaResultsTab({ deltaCheck }: Props) {
  const flag   = deltaCheck.deltaFlag as string
  const color  = FLAG_COLOR[flag] ?? 'var(--dq-text-4)'
  const bgCol  = FLAG_BG[flag]    ?? 'var(--dq-border-1)'
  const sign   = deltaCheck.deltaPercent >= 0 ? '+' : ''

  return (
    <div className="flex flex-wrap items-center gap-[18px] font-mono text-[13px]"
      style={{ color: 'var(--dq-text-3)' }}>
      <span>
        <span style={{ color: 'var(--dq-text-1)' }}>{deltaCheck.currentCount.toLocaleString()}</span>
        {' '}current
      </span>
      <span style={{ color: 'var(--dq-text-8)' }}>·</span>
      <span>
        <span style={{ color: 'var(--dq-text-4)' }}>{deltaCheck.previousCount.toLocaleString()}</span>
        {' '}previous
      </span>
      <span style={{ color: 'var(--dq-text-8)' }}>·</span>
      <span style={{ color, fontWeight: 500 }}>
        {sign}{deltaCheck.deltaPercent.toFixed(1)}%
      </span>
      <span
        className="rounded-[5px] px-[8px] py-[2px] font-mono text-[11px] font-medium"
        style={{ background: bgCol, color, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}>
        {deltaCheck.deltaFlag}
      </span>
    </div>
  )
}
