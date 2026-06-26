import { createHash } from 'crypto'

// uuid.NAMESPACE_OID — same namespace used by the Ario Python scraper
const NAMESPACE_OID = '6ba7b812-9dad-11d1-80b4-00c04fd430c8'

/**
 * UUID v5 (SHA-1 name-based). Matches Python uuid.uuid5(namespace, name).
 * Default namespace is NAMESPACE_OID, the same one the Ario scraper uses
 * to generate pricing_plan_id values.
 */
export function uuidv5(name: string, namespace = NAMESPACE_OID): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const nameBytes = Buffer.from(name, 'utf8')
  const hash = createHash('sha1').update(Buffer.concat([nsBytes, nameBytes])).digest()
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50 // version 5
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80 // RFC 4122 variant
  return [
    hash.slice(0, 4).toString('hex'),
    hash.slice(4, 6).toString('hex'),
    hash.slice(6, 8).toString('hex'),
    hash.slice(8, 10).toString('hex'),
    hash.slice(10, 16).toString('hex'),
  ].join('-')
}
