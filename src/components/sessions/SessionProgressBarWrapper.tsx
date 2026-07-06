'use client'
import { SessionProgressBar } from '@/components/sessions/SessionProgressBar'

interface SessionProgressBarWrapperProps {
  sessionId:         string
  initialProgress: {
    totalPolygons:     number
    completedPolygons: number
    progressMessage:   string | null
  }
}

export function SessionProgressBarWrapper(props: SessionProgressBarWrapperProps) {
  return <SessionProgressBar sessionId={props.sessionId} initialProgress={props.initialProgress} />
}
