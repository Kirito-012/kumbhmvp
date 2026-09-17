import { describe, it, expect } from 'vitest'
import { computeQuantileBreaks, colorForValue, HEAT_PALETTE, NO_DATA_COLOR } from './heatScale'

describe('computeQuantileBreaks', () => {
  it('returns [] for an empty dataset', () => {
    expect(computeQuantileBreaks([])).toEqual([])
  })

  it('returns [] when every value is zero', () => {
    expect(computeQuantileBreaks([0, 0, 0])).toEqual([])
  })

  it('returns a single break for a single positive value', () => {
    expect(computeQuantileBreaks([42])).toEqual([42])
  })

  it('collapses duplicate breaks when values are heavily tied', () => {
    const breaks = computeQuantileBreaks([5, 5, 5, 5, 5, 5, 5, 5], 5)
    expect(new Set(breaks).size).toBe(breaks.length)
    expect(breaks[breaks.length - 1]).toBe(5)
  })

  it('produces ascending breaks for a skewed real-world-like distribution', () => {
    const values = [742, 669, 625, 599, 58, 55, 40, 32, 20, 15, 10, 5, 1]
    const breaks = computeQuantileBreaks(values, 5)
    for (let i = 1; i < breaks.length; i++) {
      expect(breaks[i]).toBeGreaterThanOrEqual(breaks[i - 1])
    }
    expect(breaks[breaks.length - 1]).toBe(742)
  })
})

describe('colorForValue', () => {
  it('returns NO_DATA_COLOR for zero regardless of breaks', () => {
    expect(colorForValue(0, [10, 20, 30, 40, 50], 'light')).toBe(NO_DATA_COLOR.light)
    expect(colorForValue(0, [10, 20, 30, 40, 50], 'dark')).toBe(NO_DATA_COLOR.dark)
  })

  it('returns NO_DATA_COLOR when breaks is empty (all-zero dataset)', () => {
    expect(colorForValue(5, [], 'light')).toBe(NO_DATA_COLOR.light)
  })

  it('maps the single hottest value to the hottest palette stop for a single-sector dataset', () => {
    const breaks = [42] // computeQuantileBreaks([42])
    expect(colorForValue(42, breaks, 'light')).toBe(HEAT_PALETTE.light[4])
    expect(colorForValue(42, breaks, 'dark')).toBe(HEAT_PALETTE.dark[4])
  })

  it('anchors collapsed breaks to the hottest end of the palette', () => {
    // Only 2 distinct breaks survived collapse -- values should land on stops 3 and 4 (0-indexed),
    // not be compressed into the coldest end of a 5-stop palette.
    const breaks = [10, 20]
    expect(colorForValue(10, breaks, 'light')).toBe(HEAT_PALETTE.light[3])
    expect(colorForValue(20, breaks, 'light')).toBe(HEAT_PALETTE.light[4])
  })

  it('assigns increasing heat for a full 5-class skewed distribution', () => {
    const values = [742, 669, 625, 599, 58, 55, 40, 32, 20, 15, 10, 5, 1]
    const breaks = computeQuantileBreaks(values, 5)
    const colorLow = colorForValue(1, breaks, 'light')
    const colorHigh = colorForValue(742, breaks, 'light')
    expect(colorHigh).toBe(HEAT_PALETTE.light[4])
    expect(colorLow).not.toBe(colorHigh)
  })
})
