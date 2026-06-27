import { Suspense } from 'react'
import { CheckForm } from '@/components/sessions/CheckForm'

export default function NewSessionPage() {
  return (
    <div className="flex flex-col">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between border-b px-[22px] py-[16px]"
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div>
          <div className="text-[16px] font-semibold" style={{ letterSpacing: '-0.015em' }}>
            New Check
          </div>
          <div className="mt-[3px] text-[12px]" style={{ color: '#8a8a8a' }}>
            Configure and launch a verification run
          </div>
        </div>
      </div>

      {/* ── Form area ───────────────────────────────────────────── */}
      <div style={{ background: '#080808', padding: '20px 24px' }}>
        <Suspense fallback={null}>
          <CheckForm />
        </Suspense>
      </div>
    </div>
  )
}
