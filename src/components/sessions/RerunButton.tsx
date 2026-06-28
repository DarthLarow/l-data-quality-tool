'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RerunButton({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleRerun() {
    if (!confirm('Delete current results and re-run with the same parameters?')) return
    setLoading(true)
    try {
      const res  = await fetch(`/api/sessions/${sessionId}/rerun`, { method: 'POST' })
      const data = await res.json() as { sessionId?: string; error?: string }
      if (data.sessionId) router.push(`/sessions/${data.sessionId}`)
      else { alert(data.error ?? 'Failed to re-run'); setLoading(false) }
    } catch {
      alert('Network error'); setLoading(false)
    }
  }

  return (
    <button
      onClick={handleRerun}
      disabled={loading}
      className="rounded-[7px] px-[11px] py-[7px] text-[12px] font-medium transition-colors"
      style={{
        border:     '1px solid var(--dq-border-4)',
        color:      loading ? 'var(--dq-text-6)' : 'var(--dq-text-2)',
        background: 'transparent',
        cursor:     loading ? 'not-allowed' : 'pointer',
      }}
    >
      {loading ? 'Running…' : 'Re-run'}
    </button>
  )
}
