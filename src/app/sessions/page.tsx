import { Suspense } from 'react'
import { SessionsList } from '@/components/sessions/SessionsList'

export default function SessionsPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm" style={{ color: '#6b6b6b' }}>Loading sessions…</div>}>
      <SessionsList />
    </Suspense>
  )
}
