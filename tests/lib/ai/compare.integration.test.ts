import { describe, it, expect } from 'vitest'

// Runs only when AI_AUTH_TOKEN is set (skips in CI without credentials)
const runIfConfigured = process.env.AI_AUTH_TOKEN ? it : it.skip

describe('compareEntities — real AI gateway', () => {
  runIfConfigured('returns a valid verdict for two similar dockless vehicles', async () => {
    const { compareEntities } = await import('@/lib/ai/compare')
    const api = { vehicle_id: 'LIM-001', battery: 82, location_lat: 50.45, location_lng: 30.52, name: 'Lime-S' }
    const db  = { vehicle_id: 'LIM-001', battery: 79, location_lat: 50.451, location_lng: 30.521, name: 'Lime-S' }
    const result = await compareEntities(api, db, 'dockless', 'ario')
    expect(['Same', 'Different']).toContain(result.verdict)
    expect(result.explanation.length).toBeGreaterThan(5)
    console.log('AI verdict:', result.verdict, '|', result.explanation)
  }, 30_000)
})
