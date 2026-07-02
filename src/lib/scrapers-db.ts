import { Pool } from 'pg'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host:     process.env.SCRAPERS_DB_HOST     ?? 'localhost',
      port:     parseInt(process.env.SCRAPERS_DB_PORT ?? '5434', 10),
      database: process.env.SCRAPERS_DB_NAME,
      user:     process.env.SCRAPERS_DB_USER,
      password: process.env.SCRAPERS_DB_PASSWORD,
      ssl: false,
    })
  }
  return pool
}

export async function pingScrapersDb(): Promise<void> {
  const client = await getPool().connect()
  client.release()
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
  appId: string,
  sessionId: number,
  entityType: EntityType,
): Promise<number> {
  const { table, idCol } = ENTITY_TABLE_MAP[entityType]
  const rows = await scrapersQuery<{ count: string }>(
    `SELECT COUNT(DISTINCT e.${idCol}) AS count
     FROM ${table} e
     JOIN collection_tasks ct ON ct.id = e.collection_task_id
     WHERE ct.session_id = $1
       AND e.provider = $2`,
    [sessionId, appId],
  )
  return parseInt(rows[0]?.count ?? '0', 10)
}

export async function findPreviousScrapersSession(
  currentSessionId: number,
): Promise<number | null> {
  const rows = await scrapersQuery<{ session_id: string }>(
    `SELECT MAX(session_id) AS session_id
     FROM collection_tasks
     WHERE session_id < $1`,
    [currentSessionId],
  )
  const id = rows[0]?.session_id
  return id ? parseInt(id, 10) : null
}

export async function findEntitiesByIds(
  entityIds: string[],
  entityType: EntityType,
  appId?: string,
  sessionId?: number,
  cityPolygonId?: string,
): Promise<Map<string, Record<string, unknown>>> {
  if (entityIds.length === 0) return new Map()
  const { table, idCol } = ENTITY_TABLE_MAP[entityType]

  let sql: string
  let params: unknown[]

  if (sessionId !== undefined && appId !== undefined) {
    // Filter to a specific scraper session so the snapshot reflects the correct collection run.
    // DISTINCT ON picks one row per entity when multiple collection tasks in the same session collected it.
    // cityPolygonId narrows to the same city, preventing non-unique IDs (e.g. 'scooter_ride')
    // from matching rows collected for a different city within the same session.
    if (cityPolygonId !== undefined) {
      sql = `SELECT DISTINCT ON (e.${idCol}) e.*
             FROM ${table} e
             JOIN collection_tasks ct ON ct.id = e.collection_task_id
             WHERE e.${idCol} = ANY($1::text[])
               AND e.provider = $2
               AND ct.session_id = $3
               AND ct.city_polygon_id IN (
                 SELECT id FROM city_polygons
                 WHERE city_id = (SELECT city_id FROM city_polygons WHERE id = $4::int)
               )`
      params = [entityIds, appId, sessionId, cityPolygonId]
    } else {
      sql = `SELECT DISTINCT ON (e.${idCol}) e.*
             FROM ${table} e
             JOIN collection_tasks ct ON ct.id = e.collection_task_id
             WHERE e.${idCol} = ANY($1::text[])
               AND e.provider = $2
               AND ct.session_id = $3`
      params = [entityIds, appId, sessionId]
    }
  } else if (appId !== undefined) {
    sql = `SELECT * FROM ${table} WHERE ${idCol} = ANY($1::text[]) AND provider = $2`
    params = [entityIds, appId]
  } else {
    sql = `SELECT * FROM ${table} WHERE ${idCol} = ANY($1::text[])`
    params = [entityIds]
  }

  const rows = await scrapersQuery<Record<string, unknown>>(sql, params)
  return new Map(rows.map((r) => [r[idCol] as string, r]))
}

export interface PolygonBounds {
  polygonId:   string
  boundBox:    unknown
  polygonType: Record<string, unknown> | null // PostgreSQL JSONB, already parsed
  city:        string | null
}

interface RawPolygonRow {
  id:           unknown // pg returns integer columns as number
  bound_box:    unknown
  polygon_type: Record<string, unknown> | null
  city:         string | null
}

function toPolygonBounds(row: RawPolygonRow): PolygonBounds {
  return {
    polygonId:   String(row.id),
    boundBox:    row.bound_box,
    polygonType: row.polygon_type ?? null,
    city:        row.city ?? null,
  }
}

export async function getPolygonBounds(polygonId: string): Promise<PolygonBounds | null> {
  const rows = await scrapersQuery<RawPolygonRow>(
    `SELECT cp.id, cp.bound_box, cp.polygon_type, c.name AS city
     FROM city_polygons cp
     LEFT JOIN cities c ON c.id = cp.city_id
     WHERE cp.id = $1`,
    [polygonId],
  )
  return rows[0] ? toPolygonBounds(rows[0]) : null
}

export async function resolvePolygons(
  appId: string,
  polygonIds: string[],
): Promise<PolygonBounds[]> {
  const results: PolygonBounds[] = []

  for (const pid of polygonIds) {
    if (pid === '__random__') {
      const rows = await scrapersQuery<RawPolygonRow>(
        `SELECT cp.id, cp.bound_box, cp.polygon_type, c.name AS city
         FROM city_polygons cp
         JOIN cities c ON c.id = cp.city_id
         WHERE c.app_id = (SELECT id FROM apps WHERE name = $1 LIMIT 1)
         ORDER BY RANDOM() LIMIT 1`,
        [appId],
      )
      results.push(...rows.map(toPolygonBounds))
    } else if (pid.startsWith('__city_by_city_all__:')) {
      const cityName = pid.slice('__city_by_city_all__:'.length)
      const rows = await scrapersQuery<RawPolygonRow>(
        `SELECT cp.id, cp.bound_box, cp.polygon_type, c.name AS city
         FROM city_polygons cp
         JOIN cities c ON c.id = cp.city_id
         WHERE c.app_id = (SELECT id FROM apps WHERE name = $1 LIMIT 1)
           AND c.name ILIKE $2`,
        [appId, cityName],
      )
      results.push(...rows.map(toPolygonBounds))
    } else if (pid.startsWith('__city_by_city_random__:')) {
      const cityName = pid.slice('__city_by_city_random__:'.length)
      const rows = await scrapersQuery<RawPolygonRow>(
        `SELECT cp.id, cp.bound_box, cp.polygon_type, c.name AS city
         FROM city_polygons cp
         JOIN cities c ON c.id = cp.city_id
         WHERE c.app_id = (SELECT id FROM apps WHERE name = $1 LIMIT 1)
           AND c.name ILIKE $2
         ORDER BY RANDOM() LIMIT 1`,
        [appId, cityName],
      )
      results.push(...rows.map(toPolygonBounds))
    } else {
      const bounds = await getPolygonBounds(pid)
      if (bounds) results.push(bounds)
    }
  }

  return results
}

export interface ArioAccountRow {
  id:           string
  access_token: string | null
  refresh_token: string
  email:        string
  device_id:    string
  android_id:   string
  name:         string | null
  gms_version:  string | null
  locale:       string | null
}

export async function getArioAccount(): Promise<ArioAccountRow | null> {
  const rows = await scrapersQuery<ArioAccountRow>(
    `SELECT a.id,
            a.access_token,
            a.refresh_token,
            a.email,
            a.extra_context->>'device_id'   AS device_id,
            a.extra_context->>'android_id'  AS android_id,
            a.extra_context->>'name'        AS name,
            a.extra_context->>'gms_version' AS gms_version,
            a.extra_context->>'locale'      AS locale
     FROM accounts a
     JOIN apps ap ON ap.id = a.app_id
     WHERE ap.name = 'ario'
       AND a.is_active = true
     LIMIT 1`,
  )
  return rows[0] ?? null
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

export interface CityRow {
  name:    string
  code:    string
  country: string
}

export async function getCitiesForApps(
  appIds: string[],
): Promise<Map<string, CityRow[]>> {
  if (appIds.length === 0) return new Map()
  const rows = await scrapersQuery<{ app_id: string; name: string; code: string; country: string }>(
    `SELECT app_id::text, name, code, country
     FROM cities
     WHERE app_id::text = ANY($1::text[])
       AND is_active = true
     ORDER BY name`,
    [appIds],
  )
  const map = new Map<string, CityRow[]>()
  for (const row of rows) {
    const list = map.get(row.app_id) ?? []
    list.push({ name: row.name, code: row.code, country: row.country })
    map.set(row.app_id, list)
  }
  return map
}

export interface HumanForestAccountRow {
  email:         string
  password:      string
  access_token:  string | null
  refresh_token: string
}

export async function getHumanForestAccount(): Promise<HumanForestAccountRow | null> {
  const rows = await scrapersQuery<HumanForestAccountRow>(
    `SELECT a.email,
            a.password,
            a.access_token,
            a.refresh_token
     FROM accounts a
     JOIN apps ap ON ap.id = a.app_id
     WHERE ap.name = 'human_forest'
       AND a.is_active = true
     LIMIT 1`,
  )
  return rows[0] ?? null
}

export interface BoltAccountRow {
  access_token:  string | null
  refresh_token: string
  device_id:     string
  user_id:       string
  session_id:    string
  distinct_id:   string
  rh_session_id: string
  cookie:        string
}

export async function getBoltAccount(): Promise<BoltAccountRow | null> {
  const rows = await scrapersQuery<BoltAccountRow>(
    `SELECT a.access_token,
            a.refresh_token,
            a.extra_context->>'device_id'     AS device_id,
            a.extra_context->>'user_id'       AS user_id,
            a.extra_context->>'session_id'    AS session_id,
            a.extra_context->>'distinct_id'   AS distinct_id,
            a.extra_context->>'rh_session_id' AS rh_session_id,
            a.extra_context->>'cookie'        AS cookie
     FROM accounts a
     JOIN apps ap ON ap.id = a.app_id
     WHERE ap.name = 'bolt'
       AND a.is_active = true
     LIMIT 1`,
  )
  return rows[0] ?? null
}

export interface BoltCityContextRow {
  country: string  // ISO code e.g. "es"
  tile_id: string  // e.g. "24,460"
}

export async function getBoltCityContext(
  polygonId: string,
): Promise<BoltCityContextRow | null> {
  const rows = await scrapersQuery<BoltCityContextRow>(
    `SELECT cc.extra_context->>'country' AS country,
            cc.extra_context->>'tile_id'  AS tile_id
     FROM city_polygons cp
     JOIN cities c        ON c.id  = cp.city_id
     JOIN city_configs cc ON cc.city_id = c.id
     JOIN apps a          ON a.id  = c.app_id
     WHERE a.name = 'bolt'
       AND cp.id::text = $1
     LIMIT 1`,
    [polygonId],
  )
  return rows[0] ?? null
}

export interface HumanForestZoneContextRow {
  location_id: string   // pg returns as string; parse to int in adapter
  types:       number[] // parsed JSONB array
}

export async function getHumanForestZoneContext(
  polygonId: string,
): Promise<HumanForestZoneContextRow | null> {
  // Looks up location_id and types from the most recent collection_task
  // that belongs to the same city as the given polygon.
  // This allows the adapter to work for any future city Human Forest may expand to.
  const rows = await scrapersQuery<HumanForestZoneContextRow>(
    `SELECT ct.payload::jsonb->'extra_context'->>'location_id' AS location_id,
            ARRAY(
              SELECT jsonb_array_elements_text(ct.payload::jsonb->'extra_context'->'types')::int
            ) AS types
     FROM collection_tasks ct
     JOIN city_polygons cp ON cp.id = ct.city_polygon_id
     JOIN cities c ON c.id = cp.city_id
     JOIN apps a ON a.id = c.app_id
     WHERE a.name = 'human_forest'
       AND ct.payload::jsonb->'extra_context'->>'location_id' IS NOT NULL
       AND cp.city_id = (
             SELECT city_id FROM city_polygons WHERE id::text = $1 LIMIT 1
           )
     ORDER BY ct.id DESC
     LIMIT 1`,
    [polygonId],
  )
  return rows[0] ?? null
}
