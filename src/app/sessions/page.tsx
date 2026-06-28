import { Suspense } from 'react'
import { SessionsList } from '@/components/sessions/SessionsList'

export default function SessionsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm" style={{ color: 'var(--dq-text-7)' }}>Loading sessions…</div>}>
      <SessionsList />
    </Suspense>
  )
}
