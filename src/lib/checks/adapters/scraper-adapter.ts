import type { EntityType, ScraperEntity } from '@/types'
import { ArioScraperApiAdapter } from './ario-adapter'
import { HumanForestScraperApiAdapter } from './human-forest-adapter'

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
//
// Lazy factory avoids circular-import issues: ario-adapter.ts and
// human-forest-adapter.ts both import from this file, so instantiating their
// classes at module-evaluation time would see undefined constructors in some
// module systems (e.g. Vitest). The factory defers instantiation until first
// call, by which point all modules are fully evaluated.
let _registry: AdapterRegistry | null = null

export function getAdapterRegistry(): AdapterRegistry {
  if (!_registry) {
    _registry = new Map<string, ScraperApiAdapter>([
      ['ario', new ArioScraperApiAdapter()],
      ['human_forest', new HumanForestScraperApiAdapter()],
    ])
  }
  return _registry
}
