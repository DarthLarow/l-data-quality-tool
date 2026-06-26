import { aiClient } from './client'
import type { EntityType, AiVerdict } from '@/types'

const VALID_VERDICTS: AiVerdict[] = ['Same', 'SomewhatSame', 'Different']

const PROMPT = `You are comparing two objects of the same entity type from a mobility scraper system.
One is from the live API, one is from the database snapshot.

Entity type: {entityType}

Dynamic fields (minor changes are NORMAL and expected):
- GPS coordinates: small movement within a city is OK. Different country/continent = anomaly.
- Battery level, availability status: always changing, ignore differences.
- Timestamps: ignore.

Static fields (should match):
- IDs, names, pricing details, zone boundaries, model/brand info.

API object:
{apiObject}

DB object:
{dbObject}

Respond ONLY with valid JSON in this exact format:
{"verdict": "Same|SomewhatSame|Different", "explanation": "one sentence reason"}`

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
  api: Record<string, unknown>,
  db: Record<string, unknown>,
  entityType: EntityType,
): Promise<{ verdict: AiVerdict; explanation: string }> {
  const prompt = PROMPT
    .replace('{entityType}', entityType)
    .replace('{apiObject}', JSON.stringify(api, null, 2))
    .replace('{dbObject}', JSON.stringify(db, null, 2))

  const response = await aiClient.chat.completions.create({
    model: process.env.AI_MODEL ?? 'minimax/MiniMax-M3',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  })

  const content = response.choices[0]?.message?.content ?? ''
  return parseAiResponse(content)
}
