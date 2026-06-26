import type { ScraperApiAdapter, PolygonBounds } from './scraper-adapter'
import type { EntityType, ScraperEntity } from '@/types'

export class MockScraperApiAdapter implements ScraperApiAdapter {
  appId: string
  private entities: ScraperEntity[]

  constructor(appId: string, entities: ScraperEntity[] = []) {
    this.appId = appId
    this.entities = entities
  }

  async fetchEntities(_polygon: PolygonBounds, _entityType: EntityType): Promise<ScraperEntity[]> {
    return this.entities
  }
}
