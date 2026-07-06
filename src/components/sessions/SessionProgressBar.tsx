'use client'
import { useState, useEffect } from 'react'

interface SessionProgressBarProps {
  sessionId: string
  /** Initial data loaded server-side (optional — skips first fetch if provided) */
  initialProgress?: {
    totalPolygons:     number
    completedPolygons: number
    progressMessage:   string | null
  }
}

interface ProgressData {
  totalPolygons:     number
  completedPolygons: number
  progressMessage:   string | null
}

const POLL_INTERVAL_MS = 3000

function computePercent(completed: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((completed / total) * 100))
}

export function SessionProgressBar({ sessionId, initialProgress }: SessionProgressBarProps) {
  const [progress, setProgress] = useState<ProgressData>({
    totalPolygons:     initialProgress?.totalPolygons     ?? 0,
    completedPolygons: initialProgress?.completedPolygons ?? 0,
    progressMessage:   initialProgress?.progressMessage  ?? null,
  })

  useEffect(() => {
    if (!initialProgress) {
      // No server data — fetch immediately
      fetchProgress()
    }

    const id = setInterval(fetchProgress, POLL_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  async function fetchProgress() {
    try {
      const res  = await fetch(`/api/sessions/${sessionId}/progress`)
      if (!res.ok) return
      const data = (await res.json()) as ProgressData
      setProgress(data)
    } catch {
      // Silently ignore network errors during polling
    }
  }

  const pct = computePercent(progress.completedPolygons, progress.totalPolygons)

  return (
    <div className="px-[22px] py-[12px]" style={{ borderBottom: '1px solid var(--dq-border-1)' }}>
      {/* Progress bar */}
      <div className="mb-[6px] h-[5px] w-full overflow-hidden rounded-full"
        style={{ background: 'var(--dq-border-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width:        `${pct}%`,
            background:   'var(--dq-blue)',
            minWidth:     '4px',
          }}
        />
      </div>

      {/* Labels row */}
      <div className="flex items-center justify-between">
        {/* Left: animated dot + message */}
        <div className="flex items-center gap-[7px]">
          <span
            className="shrink-0 rounded-full"
            style={{
              width:  '7px',
              height: '7px',
              background: 'var(--dq-blue)',
              animation: 'dqpulse 1.4s ease-out infinite',
            }}
          />
          <span className="font-mono text-[12px]" style={{ color: 'var(--dq-text-5)' }}>
            {progress.progressMessage ?? 'Loading…'}
          </span>
        </div>

        {/* Right: count + percentage */}
        <div className="flex items-center gap-[10px] font-mono text-[11.5px]"
          style={{ color: 'var(--dq-text-6)' }}>
          <span>
            {progress.completedPolygons}
            <span style={{ color: 'var(--dq-text-7)' }}>/{progress.totalPolygons}</span>
            {' '}polygon{progress.totalPolygons !== 1 ? 's' : ''}
          </span>
          <span className="font-medium" style={{ color: 'var(--dq-blue)' }}>
            {pct}%
          </span>
        </div>
      </div>
    </div>
  )
}
