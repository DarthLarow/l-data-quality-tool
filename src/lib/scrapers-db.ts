import { Pool } from 'pg'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.SCRAPERS_DATABASE_URL })
  }
  return pool
}

export async function scrapersQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

// Maps our EntityType to the scrapers_db table and its external ID column
const ENTITY_TABLE_MAP = {
  dockless: { table: 'dockless_fleets', idCol: 'vehicle_id' },
  docked:   { table: 'docked_fleets',   idCol: 'station_id' },
  pricings: { table: 'pricings',        idCol: 'pricing_plan_id' },
  zones:    { table: 'zones',           idCol: 'zone_id' },
} as const

type EntityType = keyof typeof ENTITY_TABLE_MAP

export async function countEntitiesForSession(
  _appId: string,
  sessionId: number,
  entityType: EntityType,
): Promise<number> {
  const { table, idCol } = ENTITY_TABLE_MAP[entityType]
  const rows = await scrapersQuery<{ count: string }>(
    `SELECT COUNT(DISTINCT e.${idCol}) AS count
     FROM ${table} e
     JOIN collection_tasks ct ON ct.id = e.collection_task_id
     WHERE ct.session_id = $1`,
    [sessionId],
  )
  return parseInt(rows[0]?.count ?? '0', 10)
}

export async function findEntitiesByIds(
  entityIds: string[],
  entityType: EntityType,
): Promise<Map<string, Record<string, unknown>>> {
  if (entityIds.length === 0) return new Map()
  const { table, idCol } = ENTITY_TABLE_MAP[entityType]
  const rows = await scrapersQuery<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE ${idCol} = ANY($1::text[])`,
    [entityIds],
  )
  return new Map(
    rows.map((r) => [r[idCol] as string, r]),
  )
}

export interface PolygonBounds {
  polygonId: string
  boundBox: unknown // GeoJSON or raw geometry from scrapers_db
}

export async function getPolygonBounds(polygonId: string): Promise<PolygonBounds | null> {
  const rows = await scrapersQuery<{ id: string; bound_box: unknown }>(
    `SELECT id, bound_box FROM city_polygons WHERE id = $1`,
    [polygonId],
  )
  const row = rows[0]
  if (!row) return null
  return { polygonId, boundBox: row.bound_box }
}

export interface AppRow {
  app_id: string
  name: string
  title: string
}

export async function getScrapersApps(): Promise<AppRow[]> {
  return scrapersQuery<AppRow>(
    `SELECT id AS app_id, name, title FROM apps ORDER BY name`,
  )
}
