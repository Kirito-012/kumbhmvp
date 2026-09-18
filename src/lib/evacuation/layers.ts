import type { Geometry } from 'geojson'

// Evacuation mode's layer catalogue -- key lists, labels, and the mode's own colour palette.
// See PLAN-evacuation.md §4.1 (this file), §6.1 (the palette) and §6.2 (what each key actually
// draws, added in Phase 2 by evacLayers.ts). Kept separate from classColors.ts because these keys
// are Evacuation-mode-only: they are deliberately NOT part of MapView's POI_LAYER_DEFS, so they
// never appear as Map-mode toggles (PLAN-evacuation.md §1 decisions #5/#6).

/** The handful of things this mode exists to show, on by default. `traffic_route` and
 *  `emergency_exit` are also real kumbh tables MapView already tiles (traffic_route as a POI line
 *  layer in Map mode; emergency_exit via its own Map-mode `emergency-exit-line` layer, see
 *  PLAN-evacuation.md §3 Phase 0) -- Evacuation mode draws both again through its own dedicated
 *  `evac-*` layers (Phase 2) rather than reusing Map mode's, so its visual language (entry/exit
 *  colour coding, arrows, glow) doesn't leak back into the plain map. */
export const EVAC_CORE_KEYS = [
  'entry_exit',
  'entry_exit_line',
  'direction_line',
  'traffic_route',
  'emergency_exit',
  'location_entry',
] as const

/** Supporting context, off by default -- decision #5. `zone_outline` isn't a kumbh table; it's
 *  generated from `/api/evacuation/summary`'s per-zone `ST_Union` of sector_boundary (§8.2), not a
 *  tile source, but it toggles the same way as every other supporting layer. */
export const EVAC_SUPPORT_KEYS = [
  'thematic_gate',
  'junction',
  'bridge',
  'footpath',
  'fh_location',
  'public_service_facilities',
  'zone_outline',
] as const

/** Flood risk, off by default -- decision #10. Both tables are 25-Aug-2026-only (no 2027
 *  equivalent), loaded in Phase 0 -- see CONTEXT.md §10 "Two source drops". */
export const EVAC_FLOOD_KEYS = ['hfl_area', 'hfl_line'] as const

export type EvacCoreKey = (typeof EVAC_CORE_KEYS)[number]
export type EvacSupportKey = (typeof EVAC_SUPPORT_KEYS)[number]
export type EvacFloodKey = (typeof EVAC_FLOOD_KEYS)[number]
export type EvacKey = EvacCoreKey | EvacSupportKey | EvacFloodKey

export const EVAC_ALL_KEYS: readonly EvacKey[] = [
  ...EVAC_CORE_KEYS,
  ...EVAC_SUPPORT_KEYS,
  ...EVAC_FLOOD_KEYS,
]

export const EVAC_LAYER_LABELS: Record<EvacKey, string> = {
  entry_exit: 'Entry / exit points',
  entry_exit_line: 'Entry / exit routes',
  direction_line: 'Direction signage',
  traffic_route: 'Traffic routes',
  emergency_exit: 'Emergency exits',
  location_entry: 'Location entry markers',
  thematic_gate: 'Thematic gates',
  junction: 'Junctions',
  bridge: 'Bridges',
  footpath: 'Footpaths',
  fh_location: 'Fire hydrants',
  public_service_facilities: 'Public service facilities',
  zone_outline: 'Zone outlines',
  hfl_area: 'Flood risk areas',
  hfl_line: 'Flood lines',
}

/** Rows sourced from the 25 Aug 2026 shapefile drop rather than the 2027 gdb (CONTEXT.md §10) --
 *  their layer rows in EvacuationModePanel append "(25 Aug 2026 survey)" after this label lookup,
 *  same wording as the popup "Source" row (see MapView's propertyRowsHtml). */
export const EVAC_SHP_SOURCED_KEYS: readonly EvacKey[] = ['emergency_exit', 'hfl_area', 'hfl_line']

/** Merged over these defaults the same way `defaultVisibility`/`loadStoredVisibility` do for the
 *  plain map, so a key added here later still gets a sane default for a returning visitor instead
 *  of being `undefined` (falsy, but not explicitly decided) -- see MapView.tsx's
 *  `loadStoredEvacVisibility`. */
export function defaultEvacVisibility(): Record<EvacKey, boolean> {
  return {
    ...Object.fromEntries(EVAC_CORE_KEYS.map((k) => [k, true])),
    ...Object.fromEntries(EVAC_SUPPORT_KEYS.map((k) => [k, false])),
    ...Object.fromEntries(EVAC_FLOOD_KEYS.map((k) => [k, false])),
  } as Record<EvacKey, boolean>
}

/** Evacuation mode's own colour language (PLAN-evacuation.md §6.1) -- entry/exit is a green/rose
 *  split rather than Map mode's single "green = entry or exit" convention, since this mode's whole
 *  point is telling the two apart at a glance. Not cross-referenced with classColors.ts hexes on
 *  purpose: these are a deliberately distinct palette, not a "same real-world thing" reuse. */
export const EVAC_COLORS = {
  entry: { light: '#16a34a', dark: '#22c55e' },
  exit: { light: '#e11d48', dark: '#fb7185' },
  emergencyExit: { light: '#dc2626', dark: '#f87171' },
  emergencyExitCasing: { light: '#ffffff', dark: '#0b0f19' },
  // Purple rather than blue -- blue is already the river/water-body color on both the light and
  // dark basemap, so a blue flood-risk fill/outline visually merged straight into the Ganga
  // itself instead of reading as a distinct hazard extent. Purple has no other meaning elsewhere
  // in this mode's palette (entry=green, exit/emergencyExit=red/rose, zone=amber), so it stays
  // unambiguous against every basemap feature it's likely to overlap.
  floodArea: { light: '#9333ea', dark: '#c084fc' },
  floodLine: { light: '#7e22ce', dark: '#d8b4fe' },
  unknown: { light: '#64748b', dark: '#94a3b8' },
  /** The 5-zone outline/label (§2.4/§6.2 item 3) -- amber to match this mode's own
   *  `--map-mode-evacuation` accent, distinct from every other line color here so a zone boundary
   *  is never mistaken for a route or flood line. */
  zoneOutline: { light: '#b45309', dark: '#fbbf24' },
} as const

export type EvacTheme = 'light' | 'dark'

/** Which area Evacuation mode's right panel/search is currently focused on -- covers both a
 *  sector and a zone (unlike Map mode's plain `selectedSector`/Heatmap's `insightSector`,
 *  evacuation mode has no per-parcel data, only "which area is this about"). See
 *  PLAN-evacuation.md §5.1; state lives in MapView, mirrored to the URL as `esector`/`ezone`. */
export type EvacFocus = { kind: 'sector'; sectorNo: number } | { kind: 'zone'; zone: string } | null

/** The currently highlighted search result or clicked evac-* feature (Phase 5) -- never
 *  persisted in the URL, same as the map-mode parcel popup's own selection state. `geometry` is
 *  what actually paints the highlight (fed into the `evac-selected` geojson source): a map click
 *  carries the clicked feature's exact geometry for free (queryRenderedFeatures returns it), while
 *  a search result -- which only ever gives a bbox, never full geometry, to keep that response
 *  light -- gets a rectangle built from its bbox instead. Slightly less precise for a result's
 *  highlight than a click's, but avoids shipping full geometry through the search API for
 *  something that's only ever a visual outline. */
export type EvacSelection = {
  layer: string
  id: number | string
  geometry: Geometry
} | null
