import { describe, it, expect } from 'vitest'
import { uuidv5 } from '@/lib/uuid5'

// Reference values cross-verified against Python:
//   import uuid; str(uuid.uuid5(uuid.NAMESPACE_OID, name))
describe('uuidv5', () => {
  it('generates correct UUID for ario_unlock_Cairns', () => {
    expect(uuidv5('ario_unlock_Cairns')).toBe('5f3328fc-02ec-562a-8adb-a7bad32fa689')
  })

  it('generates correct UUID for ario_per_minute_Singapore', () => {
    expect(uuidv5('ario_per_minute_Singapore')).toBe('26ed3504-c223-5452-967e-91a110bb27ea')
  })

  it('generates correct UUID for ario_ride_pass_42', () => {
    expect(uuidv5('ario_ride_pass_42')).toBe('537de294-207b-54ae-81a2-05ee6e3b91e0')
  })

  it('output is a valid UUID v5 string', () => {
    const result = uuidv5('test')
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('is deterministic — same input produces same output', () => {
    expect(uuidv5('ario_unlock_Cairns')).toBe(uuidv5('ario_unlock_Cairns'))
  })

  it('different names produce different UUIDs', () => {
    expect(uuidv5('ario_unlock_Cairns')).not.toBe(uuidv5('ario_per_minute_Cairns'))
  })
})
