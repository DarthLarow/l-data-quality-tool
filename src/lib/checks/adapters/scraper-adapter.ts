import type { EntityType, ScraperEntity } from '@/types'

export interface PolygonBounds {
  polygonId: string
  boundBox: unknown // geometry from city_polygons.bound_box
}

export interface ScraperApiAdapter {
  appId: string
  fetchEntities(polygon: PolygonBounds, entityType: EntityType): Promise<ScraperEntity[]>
}

export type AdapterRegistry = Map<string, ScraperApiAdapter>

// Populated when each real scraper adapter is implemented
export const adapterRegistry: AdapterRegistry = new Map()
