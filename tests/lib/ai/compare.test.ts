import { describe, it, expect, vi } from 'vitest'
import type { AiVerdict } from '@/types'

vi.mock('@/lib/ai/client', () => ({
  aiClient: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: JSON.stringify({ verdict: 'Same', explanation: 'Objects match' })
            }
          }]
        })
      }
    }
  }
}))

describe('compareEntities', () => {
  it('returns Same verdict when objects match', async () => {
    const { compareEntities } = await import('@/lib/ai/compare')
    const api = { id: '123', name: 'Scooter A', lat: 50.1, lng: 30.2 }
    const db  = { id: '123', name: 'Scooter A', lat: 50.11, lng: 30.21 }
    const result = await compareEntities(api, db, 'dockless', 'ario')
    expect(result.verdict).toBe<AiVerdict>('Same')
    expect(typeof result.explanation).toBe('string')
  })
})

describe('parseAiResponse', () => {
  it('parses valid JSON response', async () => {
    const { parseAiResponse } = await import('@/lib/ai/compare')
    const result = parseAiResponse('{"verdict":"Different","explanation":"Name mismatch"}')
    expect(result.verdict).toBe('Different')
    expect(result.explanation).toBe('Name mismatch')
  })

  it('handles malformed response gracefully', async () => {
    const { parseAiResponse } = await import('@/lib/ai/compare')
    const result = parseAiResponse('not valid json')
    expect(result.verdict).toBe('Different')
    expect(result.explanation).toContain('parse')
  })

  it('rejects unknown verdict values', async () => {
    const { parseAiResponse } = await import('@/lib/ai/compare')
    const result = parseAiResponse('{"verdict":"Maybe","explanation":"hmm"}')
    expect(result.verdict).toBe('Different')
  })
})
