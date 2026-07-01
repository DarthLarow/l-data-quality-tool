import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

function getDepth(arr: unknown): number {
  let d = 0; let cur: unknown = arr
  while (Array.isArray(cur)) { d++; cur = (cur as unknown[])[0] }
  return d
}

function toRings(arr: unknown[]): unknown[][] {
  const d = getDepth(arr)
  if (d === 4) return (arr as unknown[][][]).flat(1)
  if (d === 3) return arr as unknown[][]
  if (d === 2) return [arr]
  return arr as unknown[][]
}

async function main() {
  const [sessionId, entityId] = process.argv.slice(2)
  const row = await prisma.aiComparison.findFirst({
    where: { checkSessionId: sessionId, entityId },
    select: { apiSnapshot: true, dbSnapshot: true }
  })

  if (!row) { console.log('NOT FOUND'); return }

  const api = row.apiSnapshot as Record<string, unknown>
  const db  = row.dbSnapshot  as Record<string, unknown>
  const apiRaw = api['geometryCoordinates']
  const dbRaw  = db['geometry_coordinates']

  console.log(`API depth: ${getDepth(apiRaw)}  DB depth: ${getDepth(dbRaw)}`)

  const apiNorm = Array.isArray(apiRaw) ? toRings(apiRaw) : apiRaw
  const dbNorm  = Array.isArray(dbRaw)  ? toRings(dbRaw)  : dbRaw

  if (JSON.stringify(apiNorm) === JSON.stringify(dbNorm)) {
    console.log('✅ Identical after normalization')
    return
  }

  const a = apiNorm as unknown[][][]
  const b = dbNorm  as unknown[][][]
  console.log(`Rings — API: ${a.length}  DB: ${b.length}`)

  for (let j = 0; j < Math.max(a.length, b.length); j++) {
    const ra = a[j], rb = b[j]
    if (!ra || !rb) { console.log(`Ring ${j}: missing on one side`); continue }
    if (ra.length !== rb.length) {
      console.log(`Ring ${j}: point count API=${ra.length} DB=${rb.length}`)
      continue
    }
    let diffs = 0
    for (let k = 0; k < ra.length; k++) {
      if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) {
        if (diffs < 5) console.log(`  Ring ${j} pt ${k}: API=${JSON.stringify(ra[k])}  DB=${JSON.stringify(rb[k])}`)
        diffs++
      }
    }
    console.log(`Ring ${j}: ${diffs === 0 ? `all ${ra.length} pts identical` : `${diffs}/${ra.length} pts differ`}`)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
