export type EntityType = 'dockless' | 'docked' | 'pricings' | 'zones'
export type CheckType = 'api_db' | 'ai' | 'delta'
export type Environment = 'staging' | 'production'
export type DeltaFlag = 'ok' | 'warning' | 'critical'
export type AiVerdict = 'Same' | 'Different' | 'Skipped'
export type PolygonStrategy = 'random' | 'by_id' | 'by_city_all' | 'by_city_random'
export type CheckStatus = 'running' | 'completed' | 'failed'

export const ENTITY_TYPES: EntityType[] = ['dockless', 'docked', 'pricings', 'zones']
export const CHECK_TYPES: CheckType[] = ['api_db', 'ai', 'delta']

export interface ScraperEntity {
  id: string
  /** Snapshot completeness for two-step (list → detail) adapters.
   *  Absent = 'detailed'. 'list_only' entities have fields only from the list
   *  response (detail cap exceeded) and must skip field comparison. */
  _snapshot?: 'detailed' | 'list_only'
  [key: string]: unknown
}

export interface ApiDbCheckResult {
  entityType: EntityType
  totalUniqueInApi: number
  totalFoundInDb: number
  totalNotFoundInDb: number
  notFoundIds: string[]
  polygonResults: PolygonCheckResult[]
  /** Full API response objects keyed by entity ID — used as apiSnapshot in AI comparison */
  apiEntityMap: Map<string, Record<string, unknown>>
  suspectedBlock: boolean    // true if any polygon in any polygonResult has suspectedBlock=true
}

export interface PolygonCheckResult {
  polygonId: string
  entityType: EntityType
  apiEntityIds: string[]
  foundInDb: string[]
  notFoundInDb: string[]
  failedPolygons: string[]   // polygon IDs that failed after retry
  suspectedBlock: boolean     // true if failedPolygons.length > 0
}

export interface DeltaCheckResult {
  entityType: EntityType
  currentCount: number
  previousCount: number
  deltaPercent: number
  deltaFlag: DeltaFlag
}

export interface AiComparisonResult {
  entityId: string
  entityType: EntityType
  apiSnapshot: Record<string, unknown>
  dbSnapshot: Record<string, unknown>
  verdict: AiVerdict
  explanation: string
}

export interface CheckSessionInput {
  environment: Environment
  appId: string
  scrapersSessionId: number
  polygonIds: string[]
  entityTypes: EntityType[]
  checksEnabled: CheckType[]
  previousScrapersSessionId?: number
}
