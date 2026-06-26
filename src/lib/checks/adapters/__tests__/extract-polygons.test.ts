import { describe, it, expect } from 'vitest'
import { ArioScraperApiAdapter } from '@/lib/checks/adapters/ario-adapter'

// Access private method via cast — avoids extracting to a separate module just for tests
const adapter = new ArioScraperApiAdapter()
const extract = (raw: unknown) => (adapter as unknown as { extractPolygons(r: unknown): number[][][] }).extractPolygons(raw)

describe('ArioScraperApiAdapter.extractPolygons', () => {
  it('returns [] for empty array', () => {
    expect(extract([])).toEqual([])
  })

  it('returns [] for non-array input', () => {
    expect(extract(null)).toEqual([])
    expect(extract({})).toEqual([])
    expect(extract('string')).toEqual([])
  })

  // Shape 1: flat list of {latitude, longitude} → single polygon
  it('shape 1: flat {latitude, longitude} list → one polygon', () => {
    const raw = [
      { latitude: 1.0, longitude: 2.0 },
      { latitude: 3.0, longitude: 4.0 },
      { latitude: 5.0, longitude: 6.0 },
    ]
    expect(extract(raw)).toEqual([[[1, 2], [3, 4], [5, 6]]])
  })

  // Shape 2: nested arrays of polygons
  it('shape 2: list of polygon arrays → N polygons', () => {
    const raw = [
      [{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }],
      [{ latitude: 5, longitude: 6 }, { latitude: 7, longitude: 8 }],
    ]
    expect(extract(raw)).toEqual([
      [[1, 2], [3, 4]],
      [[5, 6], [7, 8]],
    ])
  })

  it('shape 2: skips empty inner arrays', () => {
    const raw = [
      [],
      [{ latitude: 1, longitude: 2 }],
    ]
    expect(extract(raw)).toEqual([[[1, 2]]])
  })

  // Shape 3: list of objects with coordinate_list
  it('shape 3: objects with coordinate_list → one polygon per object', () => {
    const raw = [
      { coordinate_list: [{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }] },
      { coordinate_list: [{ latitude: 5, longitude: 6 }] },
    ]
    expect(extract(raw)).toEqual([
      [[1, 2], [3, 4]],
      [[5, 6]],
    ])
  })

  it('shape 3: skips objects whose coordinate_list is empty', () => {
    const raw = [
      { coordinate_list: [] },
      { coordinate_list: [{ latitude: 9, longitude: 10 }] },
    ]
    expect(extract(raw)).toEqual([[[9, 10]]])
  })
})
