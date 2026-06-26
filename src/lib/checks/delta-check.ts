import { countEntitiesForSession } from '@/lib/scrapers-db'
import type { EntityType, DeltaCheckResult, DeltaFlag } from '@/types'

interface Thresholds {
  warning: number
  critical: number
}

const DEFAULT_THRESHOLDS: Thresholds = { warning: 20, critical: 50 }

export function calculateDeltaFlag(
  deltaPercent: number,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): DeltaFlag {
  const abs = Math.abs(deltaPercent)
  if (abs >= thresholds.critical) return 'critical'
  if (abs >= thresholds.warning)  return 'warning'
  return 'ok'
}

export async function runDeltaCheck(
  appId: string,
  currentSessionId: number,
  previousSessionId: number,
  entityType: EntityType,
  thresholds?: Thresholds,
): Promise<DeltaCheckResult> {
  const [currentCount, previousCount] = await Promise.all([
    countEntitiesForSession(appId, currentSessionId, entityType),
    countEntitiesForSession(appId, previousSessionId, entityType),
  ])

  const deltaPercent =
    previousCount === 0 ? 0 : ((currentCount - previousCount) / previousCount) * 100

  return {
    entityType,
    currentCount,
    previousCount,
    deltaPercent,
    deltaFlag: calculateDeltaFlag(deltaPercent, thresholds),
  }
}
