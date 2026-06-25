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

// ⚠️ PROTOTYPE: real table/column names to be confirmed with scrapers team
export async function countEntitiesForSession(
  appId: string,
  sessionId: number,
  entityType: string,
): Promise<number> {
  const rows = await scrapersQuery<{ count: string }>(
    `SELECT COUNT(*) as count FROM entities
     WHERE app_id = $1 AND session_id = $2 AND entity_type = $3`,
    [appId, sessionId, entityType],
  )
  return parseInt(rows[0]?.count ?? '0', 10)
}

// ⚠️ PROTOTYPE: real entity structure and table names to be confirmed
export async function findEntityById(
  entityId: string,
  entityType: string,
): Promise<Record<string, unknown> | null> {
  const rows = await scrapersQuery<Record<string, unknown>>(
    `SELECT * FROM entities WHERE id = $1 AND entity_type = $2 LIMIT 1`,
    [entityId, entityType],
  )
  return rows[0] ?? null
}

export async function findEntitiesByIds(
  entityIds: string[],
  entityType: string,
): Promise<Map<string, Record<string, unknown>>> {
  if (entityIds.length === 0) return new Map()
  const placeholders = entityIds.map((_, i) => `$${i + 2}`).join(', ')
  const rows = await scrapersQuery<Record<string, unknown> & { id: string }>(
    `SELECT * FROM entities WHERE entity_type = $1 AND id IN (${placeholders})`,
    [entityType, ...entityIds],
  )
  return new Map(rows.map((r) => [r.id, r]))
}
