import { describe, expect, it } from 'vitest'
import {
  buildEvacFilters,
  corridorFilterExpr,
  isEvacFiltersEmpty,
  trafficRoutePlanVisible,
  type EvacFilters,
} from './filters'

describe('isEvacFiltersEmpty', () => {
  it('is true with no filters set', () => {
    expect(isEvacFiltersEmpty({})).toBe(true)
  })

  it('is false once any filter is set', () => {
    expect(isEvacFiltersEmpty({ plan: 'Peak day' })).toBe(false)
    expect(isEvacFiltersEmpty({ direction: 'Entry' })).toBe(false)
    expect(isEvacFiltersEmpty({ corridors: ['sah_dir'] })).toBe(false)
    expect(isEvacFiltersEmpty({ corridors: [] })).toBe(true)
  })
})

describe('corridorFilterExpr', () => {
  it('returns null for an empty selection', () => {
    expect(corridorFilterExpr([])).toBeNull()
  })

  it('ORs the selected corridor flags', () => {
    expect(corridorFilterExpr(['sah_dir', 'meer_dir'])).toEqual([
      'any',
      ['==', ['get', 'sah_dir'], 1],
      ['==', ['get', 'meer_dir'], 1],
    ])
  })
})

describe('buildEvacFilters', () => {
  it('leaves every layer filter as its base (or null) when no filters are set', () => {
    const result = buildEvacFilters({})
    expect(result.traffic_route).toBeNull()
    expect(result.entry_exit_line).toBeNull()
    expect(result.direction_line).toBeNull()
    expect(result.entry_exit).toBeNull()
  })

  it('applies a direction filter using each layer\'s own field/casing', () => {
    const filters: EvacFilters = { direction: 'Entry' }
    const result = buildEvacFilters(filters)
    expect(result.traffic_route).toEqual(['==', ['get', 'entry_exit'], 'Entry'])
    expect(result.entry_exit_line).toEqual(['==', ['get', 'remark'], 'Entry'])
    // direction_line's remark is upper-cased ('ENTRY'/'EXIT'), so the filter upcases the field
    // and compares against the upper-cased value, not the title-case 'Entry'.
    expect(result.direction_line).toEqual(['==', ['upcase', ['get', 'remark']], 'ENTRY'])
  })

  it('scopes the corridor filter to traffic_route only', () => {
    const filters: EvacFilters = { corridors: ['sah_dir'] }
    const result = buildEvacFilters(filters)
    expect(result.traffic_route).toEqual(['any', ['==', ['get', 'sah_dir'], 1]])
    expect(result.entry_exit_line).toBeNull()
    expect(result.direction_line).toBeNull()
  })

  it('ANDs direction, corridor and a supplied base filter together', () => {
    const filters: EvacFilters = { direction: 'Exit', corridors: ['meer_dir'] }
    const base = ['==', ['get', 'plan'], 'Peak day']
    const result = buildEvacFilters(filters, { traffic_route: base as never })
    expect(result.traffic_route).toEqual([
      'all',
      base,
      ['==', ['get', 'entry_exit'], 'Exit'],
      ['any', ['==', ['get', 'meer_dir'], 1]],
    ])
  })

  it('keeps a supplied base filter untouched when no other filter is set', () => {
    const base = ['==', ['get', 'plan'], 'Peak day']
    const result = buildEvacFilters({}, { traffic_route: base as never })
    expect(result.traffic_route).toEqual(base)
  })
})

describe('trafficRoutePlanVisible', () => {
  it('shows both plan layers when no plan filter is set', () => {
    expect(trafficRoutePlanVisible('Peak day', {})).toBe(true)
    expect(trafficRoutePlanVisible('Normal day', {})).toBe(true)
  })

  it('shows only the matching plan layer once one is selected', () => {
    const filters: EvacFilters = { plan: 'Peak day' }
    expect(trafficRoutePlanVisible('Peak day', filters)).toBe(true)
    expect(trafficRoutePlanVisible('Normal day', filters)).toBe(false)
  })
})
