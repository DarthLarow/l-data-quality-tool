export type EntityType = 'dockless' | 'docked' | 'pricings' | 'zones'
export type CheckType = 'api_db' | 'delta'
export type Environment = 'staging' | 'production'
export type DeltaFlag = 'ok' | 'warning' | 'critical'
export type AiVerdict = 'Same' | 'SomewhatSame' | 'Different'
export type PolygonStrategy = 'random' | 'by_id' | 'by_city_all' | 'by_city_random'
export type CheckStatus = 'running' | 'completed' | 'failed'

export const ENTITY_TYPES: EntityType[] = ['dockless', 'docked', 'pricings', 'zones']
export const CHECK_TYPES: CheckType[] = ['api_db', 'delta']

export interface ScraperEntity {
  id: string
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
}

export interface PolygonCheckResult {
  polygonId: string
  entityType: EntityType
  apiEntityIds: string[]
  foundInDb: string[]
  notFoundInDb: string[]
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
  aiSampleSize: number
  previousScrapersSessionId?: number
}
