import { describe, expect, it } from 'vitest'
import {
  directionLineLabel,
  emergencyExitLabel,
  entryExitLabel,
  facilityLabel,
  genericLabel,
  hflAreaLabel,
  hflLineLabel,
  locationEntryLabel,
  trafficRouteLabel,
} from './labels'

describe('trafficRouteLabel', () => {
  it('builds a label entirely from structured columns, never the raw name', () => {
    expect(
      trafficRouteLabel({ entry_exit: 'Entry', plan: 'Peak day', sah_dir: 1, meer_dir: 0 }),
    ).toEqual({ label: 'Entry route', sublabel: 'Peak day · Saharanpur corridor' })
  })

  it('falls back to a plain label with no sublabel when nothing is set', () => {
    expect(trafficRouteLabel({})).toEqual({ label: 'Traffic route', sublabel: null })
  })

  it('joins multiple corridor flags', () => {
    expect(trafficRouteLabel({ entry_exit: 'Exit', sah_dir: 1, meer_dir: 1 })).toEqual({
      label: 'Exit route',
      sublabel: 'Saharanpur/Meerut corridor',
    })
  })
})

describe('directionLineLabel', () => {
  it('normalises shouting-case ENTRY/EXIT to title case', () => {
    expect(directionLineLabel({ remark: 'ENTRY', sector: 'BAIRAGI CAMP' })).toEqual({
      label: 'Entry signage',
      sublabel: 'BAIRAGI CAMP',
    })
  })

  it('title-cases a free-text destination sign', () => {
    expect(directionLineLabel({ remark: 'TO DELHI NH 334' })).toEqual({
      label: 'To Delhi Nh 334',
      sublabel: null,
    })
  })
})

describe('entryExitLabel', () => {
  it('labels a point vs a route differently', () => {
    expect(entryExitLabel({ remark: 'Exit' }, 'point')).toEqual({
      label: 'Exit point',
      sublabel: null,
    })
    expect(entryExitLabel({ remark: 'Entry' }, 'route')).toEqual({
      label: 'Entry route',
      sublabel: null,
    })
  })
})

describe('locationEntryLabel', () => {
  it('uses the name, falling back when blank', () => {
    expect(locationEntryLabel({ name: 'Pantdweep' })).toEqual({ label: 'Pantdweep', sublabel: null })
    expect(locationEntryLabel({ name: null })).toEqual({ label: 'Location entry', sublabel: null })
  })
})

describe('emergencyExitLabel', () => {
  it('prefers sector_name, falling back to a formatted sector number', () => {
    expect(emergencyExitLabel({ sector_name: 'BAIRAGI CAMP-11' })).toEqual({
      label: 'Emergency exit',
      sublabel: 'BAIRAGI CAMP-11',
    })
    expect(emergencyExitLabel({ sector_name: null, sector_no: 9 })).toEqual({
      label: 'Emergency exit',
      sublabel: 'Sector 9',
    })
  })
})

describe('facilityLabel', () => {
  it('matches the AIIMS example from the plan', () => {
    expect(
      facilityLabel({
        name: 'AIIMS Hospital',
        type: 'Hospital',
        category: 'Institute of National Importance / Tertiary Hospital',
        bed: '960',
      }),
    ).toEqual({
      label: 'AIIMS Hospital',
      sublabel: 'Institute of National Importance / Tertiary Hospital · 960 beds',
    })
  })

  it('falls back to type when name and category/bed are missing', () => {
    expect(facilityLabel({ type: 'Post Office' })).toEqual({
      label: 'Post Office',
      sublabel: 'Post Office',
    })
  })
})

describe('hflAreaLabel', () => {
  it('title-cases the sector-derived name and strips the trailing number', () => {
    expect(hflAreaLabel({ name: 'KANKHAL-10', sector_no: 10 })).toEqual({
      label: 'Kankhal flood risk area',
      sublabel: 'Sector 10',
    })
  })
})

describe('hflLineLabel', () => {
  it('describes the return period and bank', () => {
    expect(hflLineLabel({ return_period_years: 100, bank: 'RB' })).toEqual({
      label: '100-year flood line',
      sublabel: 'right bank',
    })
  })

  it('handles a missing bank', () => {
    expect(hflLineLabel({ return_period_years: 25, bank: null })).toEqual({
      label: '25-year flood line',
      sublabel: null,
    })
  })
})

describe('genericLabel', () => {
  it('prefers name, then fh_name, then remark, then the fallback', () => {
    expect(genericLabel({ name: 'Chandi Chowk', remark: 'Chowk' }, 'Junction')).toEqual({
      label: 'Chandi Chowk',
      sublabel: 'Chowk',
    })
    expect(genericLabel({ fh_name: 'FH-12' }, 'Fire hydrant')).toEqual({
      label: 'FH-12',
      sublabel: null,
    })
    expect(genericLabel({}, 'Bridge')).toEqual({ label: 'Bridge', sublabel: null })
  })
})
