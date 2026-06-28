// @deprecated — replaced by src/lib/checks/field-compare.ts (deterministic comparison).
// Kept for reference; may be reintroduced for deep AI analysis in future.
import fs from 'fs'
import path from 'path'
import { aiClient } from './client'
import { getFieldMapping } from '@/lib/field-mappings'
import type { FieldMapping } from '@/lib/field-mappings'
import type { EntityType, AiVerdict } from '@/types'

type Obj = Record<string, unknown>

const VALID_VERDICTS: AiVerdict[] = ['Same', 'Different']

const GENERIC_PROMPT = `You are comparing two snapshots of the same entity from a mobility scraper system.
One is from the live API, one is from the database (captured at a different time).

Entity type: {entityType}

Dynamic fields (minor changes are normal): GPS coordinates, battery level, timestamps.
Static fields (must match): IDs, names, model info, pricing, zone boundaries.

{fieldRulesTable}

{comparisonTable}

Respond ONLY with valid JSON:
{"verdict": "Same|Different", "explanation": "<one sentence>"}`

function loadPromptTemplate(entityType: string): string {
  const filePath = path.join(process.cwd(), 'docs/ai-comparison-prompts', `${entityType}.md`)
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return GENERIC_PROMPT
  }
}

function buildFieldRulesTable(mapping: FieldMapping): string {
  const staticRows = mapping.filter((r) => !r.dynamic)
  const dynamicRows = mapping.filter((r) => r.dynamic)

  const header = ['| DB field | API source | Transformation |', '|---|---|---|']

  const formatRow = (r: FieldMapping[number]) => {
    const source = r.apiKey ?? '—'
    const rule = r.constant !== undefined
      ? `constant "${String(r.constant)}"`
      : (r.note ?? 'copy')
    const subtype = r.onlyWhen ? ' *(sub-type filtered)*' : ''
    return `| ${r.dbKey} | ${source} | ${rule}${subtype} |`
  }

  const parts: string[] = []

  if (staticRows.length > 0) {
    parts.push('**Static fields** (must match exactly)')
    parts.push(...header)
    parts.push(...staticRows.map(formatRow))
  }

  if (dynamicRows.length > 0) {
    parts.push('')
    parts.push('**Dynamic fields** (differences are expected)')
    parts.push(...header)
    parts.push(...dynamicRows.map(formatRow))
  }

  return parts.join('\n')
}

function buildComparisonTable(mapping: FieldMapping, api: Obj, db: Obj): string {
  const toRow = (r: FieldMapping[number]) => {
    if (r.constant !== undefined) return null
    if (!r.apiKey || !(r.apiKey in api)) return null
    if (r.onlyWhen && !r.onlyWhen(api)) return null

    const rawVal      = api[r.apiKey]
    const transformed = r.transform ? r.transform(rawVal) : rawVal
    const dbVal       = db[r.dbKey]
    return `| ${r.dbKey} | ${JSON.stringify(transformed)} | ${JSON.stringify(dbVal)} |`
  }

  const header = ['| DB field | API (transformed) | DB value |', '|---|---|---|']

  const staticRows  = mapping.filter((r) => !r.dynamic).map(toRow).filter(Boolean) as string[]
  const dynamicRows = mapping.filter((r) =>  r.dynamic).map(toRow).filter(Boolean) as string[]

  const parts: string[] = []

  if (staticRows.length > 0) {
    parts.push('**Static fields**')
    parts.push(...header)
    parts.push(...staticRows)
  }

  if (dynamicRows.length > 0) {
    parts.push('')
    parts.push('**Dynamic fields**')
    parts.push(...header)
    parts.push(...dynamicRows)
  }

  return parts.join('\n')
}

export function parseAiResponse(raw: string): { verdict: AiVerdict; explanation: string } {
  try {
    const parsed = JSON.parse(raw) as { verdict: AiVerdict; explanation: string }
    if (!VALID_VERDICTS.includes(parsed.verdict)) {
      return { verdict: 'Different', explanation: 'Unexpected verdict value from AI' }
    }
    return parsed
  } catch {
    return { verdict: 'Different', explanation: `Failed to parse AI response: ${raw.slice(0, 100)}` }
  }
}

export async function compareEntities(
  api: Obj,
  db: Obj,
  entityType: EntityType,
  appId: string,
): Promise<{ verdict: AiVerdict; explanation: string }> {
  const mapping          = getFieldMapping(appId, entityType)
  const fieldRulesTable  = buildFieldRulesTable(mapping)
  const comparisonTable  = buildComparisonTable(mapping, api, db)
  const template         = loadPromptTemplate(entityType)

  const prompt = template
    .replace('{entityType}', entityType)
    .replace('{fieldRulesTable}', fieldRulesTable)
    .replace('{comparisonTable}', comparisonTable)

  const response = await aiClient.chat.completions.create({
    model: process.env.AI_MODEL ?? 'minimax/MiniMax-M3',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  })

  const content = response.choices[0]?.message?.content ?? ''
  return parseAiResponse(content)
}
