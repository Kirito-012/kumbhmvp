// WCAG relative-luminance check to pick readable text (white vs near-black)
// against an arbitrary solid background colour -- used wherever a class's
// colour becomes a filled pill/background rather than just an accent dot.
export function readableTextOn(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  return luminance > 0.45 ? '#0f172a' : '#ffffff'
}

// A handful of seeded DB colours (ticket statuses/priorities/tags) sit right at
// readableTextOn's black/white threshold -- e.g. the "Resolved" status's #34d399 (luminance
// .496) narrowly resolves to dark text while every sibling status resolves to white, so a row
// of solid-fill status pills reads as an inconsistent mix of black and white labels even though
// each pill individually has fine contrast. This is a display-only fix (the DB value is left
// alone) that swaps a known light/borderline colour for a deliberately deepened shade in the
// same hue family before it ever reaches readableTextOn, so it reliably lands on the same side
// as the rest of the set. Keyed by the DB's exact stored hex; extend as new borderline colours
// turn up rather than trying to auto-darken everything (auto-darkening would shift hues that
// are already fine and don't need it).
const SOLID_FILL_COLOR_OVERRIDES: Record<string, string> = {
  '#34d399': '#047a54', // "Resolved" status -- matches statusSolidStyles.resolved in Badge.tsx
}

/** Resolves a DB-stored colour to the shade that should actually be used for a solid-fill pill
 *  background, applying SOLID_FILL_COLOR_OVERRIDES when the raw colour is a known borderline
 *  case. Pass the *result* of this to readableTextOn, not the raw DB colour, when rendering a
 *  solid fill (dot/tint usages are unaffected and can keep using the raw colour). */
export function solidFillColor(hex: string): string {
  return SOLID_FILL_COLOR_OVERRIDES[hex.toLowerCase()] ?? hex
}

// Matches kumbh.sector_plan.class_group buckets produced by the loader
// (Dashboard/scripts/load_kumbh.py) — top classes get their own colour,
// the long tail is bucketed into "Other".
export const CLASS_GROUP_COLORS: Record<string, string> = {
  'Religious Camping': '#e07b39',
  Parking: '#6b7280',
  'Police Camping': '#1d4ed8',
  'Reserved Area': '#a78bfa',
  'Administrative Camping': '#059669',
  Commercial: '#db2777',
  Amenities: '#f59e0b',
  'Health Camping': '#ef4444',
  Road: '#78716c',
  'Existing Development': '#0ea5e9',
  Other: '#cbd5e1',
}

export const ROAD_TYPE_COLORS: Record<string, string> = {
  'Existing Road': '#9ca3af',
  'Proposed Road': '#2563eb',
  'Emergency Exit': '#dc2626',
}

export const ROAD_TYPE_DASH: Record<string, [number, number] | undefined> = {
  'Existing Road': undefined,
  'Proposed Road': [2, 2],
  'Emergency Exit': [1, 1],
}

// Point-of-interest layers loaded from the Aug 2026 JSON drop
// (Dashboard/scripts/load_kumbh_json_layers.py). Each gets one fixed
// marker colour so they read as distinct categories on the map.
export const POINT_LAYER_COLORS: Record<string, string> = {
  amenities: '#f59e0b',
  bus_stop: '#2563eb',
  dustbins: '#65a30d',
  fh_location: '#dc2626',
  kumbh_mela_2027_ghat: '#0ea5e9',
  sanitation: '#7c3aed',
  transformer: '#ea580c',
}

export const POINT_LAYER_LABELS: Record<string, string> = {
  amenities: 'Amenities',
  bus_stop: 'Bus stops',
  dustbins: 'Dustbins',
  fh_location: 'Fire hydrants',
  kumbh_mela_2027_ghat: 'Ghat points (2027)',
  sanitation: 'Sanitation',
  transformer: 'Transformers',
}

export const LINE_LAYER_COLORS: Record<string, string> = {
  bridge: '#78350f',
  trench_line: '#57534e',
}

export const LINE_LAYER_LABELS: Record<string, string> = {
  bridge: 'Bridges',
  trench_line: 'Trench lines',
}

export const POLYGON_LAYER_COLORS: Record<string, string> = {
  ashram: '#db2777',
  bus_terminal: '#2563eb',
  core_parking: '#6b7280',
  ghat_area: '#d97706',
  kumbh_land: '#059669',
  public_service_facilities: '#ef4444',
  river: '#1d4ed8',
}

export const POLYGON_LAYER_LABELS: Record<string, string> = {
  ashram: 'Ashrams',
  bus_terminal: 'Bus terminals',
  core_parking: 'Core parking',
  ghat_area: 'Ghat areas',
  kumbh_land: 'Kumbh land',
  public_service_facilities: 'Public service facilities',
  river: 'River',
}

// Short signage codes shown as an on-map text label for a few POI point
// layers, in place of the usual colour dot -- kept alongside the colour/label
// maps above so every place a POI's dot swatch renders (map markers, the
// Layers panel, the Stats panel) can consistently swap in the same badge.
export const POI_SIGNAGE_CODES: Record<string, string> = {
  bus_stop: 'BS',
  kumbh_mela_2027_ghat: 'G',
  fh_location: 'FH',
}
