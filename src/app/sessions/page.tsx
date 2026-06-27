import { Suspense } from 'react'
import { SessionsList } from '@/components/sessions/SessionsList'

export default function SessionsPage() {
  return (
    <div className="p-6">
      <Suspense fallback={<div className="py-12 text-center text-muted-foreground text-sm">Loading sessions…</div>}>
        <SessionsList />
      </Suspense>
    </div>
  )
}
