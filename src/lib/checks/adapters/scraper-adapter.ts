import type { EntityType, ScraperEntity } from '@/types'
import { ArioScraperApiAdapter } from './ario-adapter'

export interface PolygonBounds {
  polygonId:   string
  boundBox:    unknown
  polygonType: Record<string, unknown> | null // PostgreSQL JSONB object, already parsed
  city:        string | null
}

export interface ScraperApiAdapter {
  appId: string
  fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]>
  /** Per-entity strategy. Default (when omitted): 'all'. */
  polygonStrategy?(entityType: EntityType): 'all' | 'center_only'
  /** Delay in ms between polygon requests (base; jitter applied externally). Default: 500. */
  interPolygonDelayMs?: number
}

/** Thrown by an adapter when the API returns a structurally unexpected response
 *  (e.g. null oa_list for zones, null data for pricings) that may indicate
 *  rate-limiting or a block. */
export class ApiUnexpectedResponseError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly polygonId: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiUnexpectedResponseError'
  }
}

export type AdapterRegistry = Map<string, ScraperApiAdapter>

// Registry key = scrapers_db.apps.name (synced into quality_db.Scraper.appId).
// Confirmed: Ario app name is 'ario' (id=7 in stage scrapers_db).
export const adapterRegistry: AdapterRegistry = new Map([
  ['ario', new ArioScraperApiAdapter()],
])
