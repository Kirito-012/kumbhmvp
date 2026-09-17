export type Theme = 'light' | 'dark'

/** 5-stop green -> red ramp for the sector-list dots/bars, matching the map glow's hue family
 *  (HEAT_GLOW_COLOR in insightLayers.ts) as opaque hex instead of translucent rgba -- so the list
 *  and the map read as the same scale (PLAN-heatmap.md §11.8). Same stops in both themes now (the
 *  glow itself is theme-independent); kept as a Record<Theme, ...> since colorForValue/callers are
 *  still theme-parameterised for NO_DATA_COLOR's sake. */
const GREEN_TO_RED_RAMP = ['#22c55e', '#a3e635', '#facc15', '#f97316', '#dc2626']
export const HEAT_PALETTE: Record<Theme, string[]> = {
  light: GREEN_TO_RED_RAMP,
  dark: GREEN_TO_RED_RAMP,
}

/** CSS `linear-gradient()` stop list built from the same ramp, for the single-bar legend
 *  (PLAN-heatmap.md §11.8) -- one gradient bar replaces the old stepped swatch rows. */
export function heatGradientCss(theme: Theme): string {
  const palette = HEAT_PALETTE[theme]
  return `linear-gradient(to right, ${palette.join(', ')})`
}

/** Sectors/parcels with zero for the active metric (e.g. no open tickets) get a neutral swatch
 *  instead of the coldest heat colour, so "no data" reads distinctly from "least hot". */
export const NO_DATA_COLOR: Record<Theme, string> = {
  light: '#e2e8f0',
  dark: '#334155',
}

/**
 * Quantile breaks over `values` (ascending), producing up to `classes` buckets. Duplicate breaks
 * collapse naturally when the data has fewer distinct values than `classes` (e.g. every sector
 * tied, or a single sector) -- callers must not assume the result has exactly `classes` entries.
 * Zero values are excluded from the quantile computation itself (they get NO_DATA_COLOR, not a
 * spot on the ramp) but are still valid input; an all-zero/empty `values` returns [].
 */
export function computeQuantileBreaks(values: number[], classes = 5): number[] {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (positive.length === 0) return []
  if (positive.length === 1) return [positive[0]]

  const breaks: number[] = []
  for (let i = 1; i < classes; i++) {
    const p = i / classes
    const idx = p * (positive.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    const frac = idx - lo
    const value = positive[lo] + (positive[hi] - positive[lo]) * frac
    breaks.push(value)
  }
  breaks.push(positive[positive.length - 1])
  // Collapse duplicates (skewed data can otherwise repeat the same break several times).
  return Array.from(new Set(breaks))
}

/**
 * Maps `value` to a palette colour given the breaks computed by computeQuantileBreaks(). A value
 * of 0 (or breaks being empty, meaning every input was 0) always returns NO_DATA_COLOR. The
 * indexing intentionally anchors to the END of the palette (palette.length - breaks.length + i)
 * so that whatever classes survive break-collapse, the single hottest class always lands on the
 * palette's hottest stop -- e.g. with only 2 distinct breaks, values land on the 4th/5th (hottest)
 * colours rather than being compressed into the coldest end.
 */
export function colorForValue(value: number, breaks: number[], theme: Theme): string {
  const palette = HEAT_PALETTE[theme]
  if (value <= 0 || breaks.length === 0) return NO_DATA_COLOR[theme]

  let classIndex = breaks.findIndex((b) => value <= b)
  if (classIndex === -1) classIndex = breaks.length - 1

  const paletteIndex = palette.length - breaks.length + classIndex
  return palette[Math.max(0, Math.min(palette.length - 1, paletteIndex))]
}

/** Roughly darkens a `#rrggbb` hex colour by `factor` (0-1, e.g. 0.25 = 25% darker) for outline
 *  strokes -- keeps a single palette per theme instead of maintaining a parallel outline palette. */
export function darkenHex(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const scale = (component: string) =>
    Math.round(parseInt(component, 16) * (1 - factor))
      .toString(16)
      .padStart(2, '0')
  return `#${scale(m[1])}${scale(m[2])}${scale(m[3])}`
}
