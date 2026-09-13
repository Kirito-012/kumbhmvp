import type { Map as MLMap, ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { HEAT_PALETTE, NO_DATA_COLOR, darkenHex, type Theme } from '@/lib/insights/heatScale'
import type {
  SectorRollup,
  SectorPlanBucket,
  InsightsFilters,
  HeatMetric,
} from '@/lib/insights/aggregate'
import { isOpenTicket, matchesFilters } from '@/lib/insights/aggregate'
import { BUCKET_COLORS, BUCKET_ORDER } from '@/lib/insights/statusBuckets'
import {
  TicketField,
  type InsightsPriorityRow,
  type InsightsStatusRow,
  type InsightsTicketTuple,
} from '@/lib/insights/types'

// Heatmap only ever attaches to the sector_boundary vector source MapView already loads (see
// initMap's map.addSource('sector_boundary', ...)) -- sector_no is already an exposed feature
// property there (used by sector-hover-fill/etc.), so no new tile source is needed for the
// zoomed-out sector shading.
const SECTOR_SOURCE = 'sector_boundary'
const SECTOR_SOURCE_LAYER = 'sector_boundary'

// Ticket mode recolours the same 'sector_plan' vector source MapView already loads for the
// class-group wash (see initMap's map.addSource('sector_plan', ...), promoteId: 'id') via
// feature-state rather than a second tile source -- see PLAN-heatmap.md §5.3.
const PARCEL_SOURCE = 'sector_plan'
const PARCEL_SOURCE_LAYER = 'sector_plan'

export const INSIGHT_HEAT_SOURCE = 'insight-tickets'

export const INSIGHT_SECTOR_FILL_LAYER = 'insight-sector-fill'
export const INSIGHT_SECTOR_OUTLINE_LAYER = 'insight-sector-outline'
export const INSIGHT_SECTOR_SELECTED_LAYER = 'insight-sector-selected'
export const INSIGHT_SECTOR_LABEL_LAYER = 'insight-sector-label'
export const INSIGHT_HEAT_LAYER = 'insight-heat'
export const INSIGHT_HEAT_POINTS_LAYER = 'insight-heat-points'
export const INSIGHT_TICKET_FILL_LAYER = 'insight-ticket-fill'
export const INSIGHT_TICKET_OUTLINE_LAYER = 'insight-ticket-outline'

/** Every Heatmap-only layer this module owns, bottom-to-top paint order. Used for visibility
 *  toggling and for the theme-swap effect's re-theme pass. The sector label layer is shared with
 *  Ticket mode (different text, see updateTicketSectorLabels) so it's toggled separately from
 *  this list -- see setInsightLabelVisible. */
export const INSIGHT_LAYER_IDS = [
  INSIGHT_SECTOR_FILL_LAYER,
  INSIGHT_SECTOR_OUTLINE_LAYER,
  INSIGHT_SECTOR_SELECTED_LAYER,
  INSIGHT_HEAT_LAYER,
  INSIGHT_HEAT_POINTS_LAYER,
] as const

/** Ticket mode's own layers -- toggled independently of INSIGHT_LAYER_IDS above (they're never
 *  both visible at once, but each mode owns its own visibility switch for clarity). */
export const TICKET_LAYER_IDS = [INSIGHT_TICKET_FILL_LAYER, INSIGHT_TICKET_OUTLINE_LAYER] as const

/** Zoom at which the hybrid heatmap crosses over from sector-fill shading to the MapLibre heat
 *  glow -- sector fill fades out 13->14.5, heat glow fades in 13->14.5, see PLAN-heatmap.md §5. */
export const INSIGHT_HEAT_ZOOM_CROSSOVER = 13.75

function sectorColorExpr(
  colorBySector: Map<number, string>,
  fallback: string,
): ExpressionSpecification {
  const pairs: (number | string)[] = []
  for (const [sectorNo, color] of colorBySector) pairs.push(sectorNo, color)
  if (pairs.length === 0) return fallback as unknown as ExpressionSpecification
  return ['match', ['get', 'sector_no'], ...pairs, fallback] as unknown as ExpressionSpecification
}

function sectorLabelExpr(labelBySector: Map<number, string>): ExpressionSpecification {
  const pairs: (number | string)[] = []
  for (const [sectorNo, label] of labelBySector) pairs.push(sectorNo, label)
  if (pairs.length === 0) return '' as unknown as ExpressionSpecification
  return ['match', ['get', 'sector_no'], ...pairs, ''] as unknown as ExpressionSpecification
}

/**
 * Adds every Heatmap layer (idempotent -- a re-entry into Heatmap mode, or React StrictMode's
 * double-invoke, is a no-op if they already exist). All layers start hidden (`visibility: 'none'`)
 * -- MapView's mode-visibility effect turns them on/off, mirroring visibilityForMode's pattern for
 * the plain-map layers. Colours/labels start at the neutral "no data" swatch; the caller applies
 * real values via updateInsightSectorPaint once ticket data has loaded.
 */
export function addInsightLayers(map: MLMap, theme: Theme): void {
  if (!map.getSource(INSIGHT_HEAT_SOURCE)) {
    map.addSource(INSIGHT_HEAT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  if (!map.getLayer(INSIGHT_SECTOR_FILL_LAYER)) {
    map.addLayer({
      id: INSIGHT_SECTOR_FILL_LAYER,
      type: 'fill',
      source: SECTOR_SOURCE,
      'source-layer': SECTOR_SOURCE_LAYER,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': NO_DATA_COLOR[theme],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.72, 13, 0.55, 14.5, 0],
      },
    })
  }
  if (!map.getLayer(INSIGHT_SECTOR_OUTLINE_LAYER)) {
    map.addLayer({
      id: INSIGHT_SECTOR_OUTLINE_LAYER,
      type: 'line',
      source: SECTOR_SOURCE,
      'source-layer': SECTOR_SOURCE_LAYER,
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: {
        'line-color': darkenHex(NO_DATA_COLOR[theme], 0.25),
        'line-width': 1,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 13, 0.7, 14.5, 0],
      },
    })
  }
  if (!map.getLayer(INSIGHT_SECTOR_LABEL_LAYER)) {
    map.addLayer({
      id: INSIGHT_SECTOR_LABEL_LAYER,
      type: 'symbol',
      source: SECTOR_SOURCE,
      'source-layer': SECTOR_SOURCE_LAYER,
      minzoom: 11,
      layout: {
        visibility: 'none',
        'text-field': ['format', ['concat', 'S', ['to-string', ['get', 'sector_no']]], {}],
        'text-font': ['Noto Sans Bold'],
        'text-size': 13,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': theme === 'dark' ? '#0b0d11' : '#ffffff',
        'text-halo-color': NO_DATA_COLOR[theme],
        'text-halo-width': 1.2,
      },
    })
  }
  // Double-stroke selected-sector highlight, same "outline + soft glow" idea as the plain map's
  // sector-selected-outline/-glow pair, kept as one 2.5px line here for simplicity (Phase 3 scope
  // is correct colour + zoom behaviour, not matching that pair's dark-mode glow variant 1:1).
  if (!map.getLayer(INSIGHT_SECTOR_SELECTED_LAYER)) {
    map.addLayer({
      id: INSIGHT_SECTOR_SELECTED_LAYER,
      type: 'line',
      source: SECTOR_SOURCE,
      'source-layer': SECTOR_SOURCE_LAYER,
      filter: ['==', ['get', 'sector_no'], -1],
      layout: { visibility: 'none' },
      paint: { 'line-color': theme === 'dark' ? '#fb923c' : '#7c3aed', 'line-width': 3 },
    })
  }

  if (!map.getLayer(INSIGHT_HEAT_LAYER)) {
    map.addLayer({
      id: INSIGHT_HEAT_LAYER,
      type: 'heatmap',
      source: INSIGHT_HEAT_SOURCE,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['get', 'weight'],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 13, 12, 16, 28],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, 0.85],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(0,0,0,0)',
          0.2,
          HEAT_PALETTE[theme][0],
          0.4,
          HEAT_PALETTE[theme][1],
          0.6,
          HEAT_PALETTE[theme][2],
          0.8,
          HEAT_PALETTE[theme][3],
          1,
          HEAT_PALETTE[theme][4],
        ],
      },
    })
  }
  if (!map.getLayer(INSIGHT_HEAT_POINTS_LAYER)) {
    map.addLayer({
      id: INSIGHT_HEAT_POINTS_LAYER,
      type: 'circle',
      source: INSIGHT_HEAT_SOURCE,
      minzoom: 16,
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 4,
        'circle-color': HEAT_PALETTE[theme][3],
        'circle-stroke-color': theme === 'dark' ? '#0b0d11' : '#ffffff',
        'circle-stroke-width': 1,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 15.5, 0, 16, 0.9],
      },
    })
  }
}

/** Shows/hides every insight layer at once -- MapView calls this from the mode-visibility effect
 *  alongside visibilityForMode's plain-map handling. Layers not yet created (e.g. Ticket mode
 *  hasn't run addInsightLayers yet in an earlier phase) are silently skipped. */
export function setInsightLayersVisible(map: MLMap, visible: boolean): void {
  const visibility = visible ? 'visible' : 'none'
  for (const id of INSIGHT_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
  }
}

/** The sector label layer is shared between Heatmap and Ticket mode (only its text differs, see
 *  updateInsightSectorPaint vs updateTicketSectorLabels), so it's toggled independently of both
 *  modes' own layer lists rather than living in either INSIGHT_LAYER_IDS or TICKET_LAYER_IDS. */
export function setInsightLabelVisible(map: MLMap, visible: boolean): void {
  if (map.getLayer(INSIGHT_SECTOR_LABEL_LAYER)) {
    map.setLayoutProperty(INSIGHT_SECTOR_LABEL_LAYER, 'visibility', visible ? 'visible' : 'none')
  }
}

// A parcel whose ticket fails the active filters gets this instead of vanishing -- a translucent
// slate wash distinct enough from BUCKET_COLORS.closed (which is opaque) that "filtered out" never
// reads as "actually Closed" (PLAN-heatmap.md §5.3/§9).
const MUTED_TICKET_FILL: Record<Theme, string> = {
  light: 'rgba(100,116,139,0.28)',
  dark: 'rgba(148,163,184,0.22)',
}
const MUTED_TICKET_OUTLINE: Record<Theme, string> = {
  light: 'rgba(71,85,105,0.55)',
  dark: 'rgba(148,163,184,0.45)',
}

/** `['match', ['feature-state','bucket'], ...]` colour expression shared by fill/outline --
 *  `colorForBucket` supplies each bucket's colour so the two call sites (fill: bucket colour,
 *  outline: darkened bucket colour) can share the match/fallback plumbing. A parcel with no
 *  feature-state set yet (no ticket, e.g. a Road/Parking parcel) falls through to 'transparent'
 *  so the class-group wash underneath (sector-plan-fill) still shows through untouched. */
function ticketBucketExpr(
  colorForBucket: (bucket: SectorPlanBucket) => string,
): ExpressionSpecification {
  const pairs: string[] = []
  for (const bucket of BUCKET_ORDER) pairs.push(bucket, colorForBucket(bucket))
  pairs.push('muted', colorForBucket('muted'))
  return [
    'match',
    ['feature-state', 'bucket'],
    ...pairs,
    'transparent',
  ] as unknown as ExpressionSpecification
}

function ticketFillExpr(theme: Theme): ExpressionSpecification {
  return ticketBucketExpr((b) =>
    b === 'muted' ? MUTED_TICKET_FILL[theme] : BUCKET_COLORS[b][theme],
  )
}

function ticketOutlineExpr(theme: Theme): ExpressionSpecification {
  return ticketBucketExpr((b) =>
    b === 'muted' ? MUTED_TICKET_OUTLINE[theme] : darkenHex(BUCKET_COLORS[b][theme], 0.25),
  )
}

/**
 * Adds Ticket mode's parcel fill/outline layers on the existing `sector_plan` source (idempotent,
 * same reasoning as addInsightLayers). Both start hidden with every feature falling through to
 * 'transparent' -- MapView's feature-state effect paints real buckets in once ticket data has
 * loaded. Added after sector-plan-fill/-class-outline in MapView's `load` handler (not inside
 * addInsightLayers, which runs before sector_plan itself exists) so the ticket fill/outline sit
 * ABOVE the class-group wash but BELOW the peripheral dashed outline and filter-emphasis layers
 * that are added right after them -- see PLAN-heatmap.md §9 ("ticket fill sits under [the
 * peripheral outline], not over it").
 */
export function addTicketLayers(map: MLMap, theme: Theme): void {
  if (!map.getLayer(INSIGHT_TICKET_FILL_LAYER)) {
    map.addLayer({
      id: INSIGHT_TICKET_FILL_LAYER,
      type: 'fill',
      source: PARCEL_SOURCE,
      'source-layer': PARCEL_SOURCE_LAYER,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ticketFillExpr(theme),
        // Fades slightly at parcel-reading zooms so the parcel's own class-wash/outline (still
        // visible underneath) keeps some legibility rather than being fully painted over.
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 15, 0.35],
      },
    })
  }
  if (!map.getLayer(INSIGHT_TICKET_OUTLINE_LAYER)) {
    map.addLayer({
      id: INSIGHT_TICKET_OUTLINE_LAYER,
      type: 'line',
      source: PARCEL_SOURCE,
      'source-layer': PARCEL_SOURCE_LAYER,
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: {
        'line-color': ticketOutlineExpr(theme),
        'line-width': 1,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 0.9],
      },
    })
  }
}

export function setTicketLayersVisible(map: MLMap, visible: boolean): void {
  const visibility = visible ? 'visible' : 'none'
  for (const id of TICKET_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
  }
}

/** Re-applies the fill/outline colour expressions on a theme toggle -- called unconditionally
 *  from MapView's theme-swap effect (syncBasemap), same as applyInsightTheme, since both bucket
 *  and muted colours are theme-dependent plain paint values. */
export function applyTicketTheme(map: MLMap, theme: Theme): void {
  if (map.getLayer(INSIGHT_TICKET_FILL_LAYER)) {
    map.setPaintProperty(INSIGHT_TICKET_FILL_LAYER, 'fill-color', ticketFillExpr(theme))
  }
  if (map.getLayer(INSIGHT_TICKET_OUTLINE_LAYER)) {
    map.setPaintProperty(INSIGHT_TICKET_OUTLINE_LAYER, 'line-color', ticketOutlineExpr(theme))
  }
}

/**
 * Diffs `next` (this pass's sectorPlanId -> bucket map, from aggregate.ts's
 * bucketBySectorPlanId) against `previous` (the last map actually applied) and calls
 * setFeatureState/removeFeatureState only for parcels whose bucket actually changed --
 * PLAN-heatmap.md §9's "~3.6k calls is fine, but batch in one frame and diff so only changed
 * parcels are touched". The caller (MapView) is responsible for the "one frame" half: schedule
 * this inside a single requestAnimationFrame per data/filter change, cancelling any still-pending
 * one from a faster-than-a-frame previous call.
 */
export function applyTicketFeatureState(
  map: MLMap,
  next: Map<number, SectorPlanBucket>,
  previous: Map<number, SectorPlanBucket> | null,
): void {
  const ids = new Set<number>(next.keys())
  if (previous) for (const id of previous.keys()) ids.add(id)

  for (const id of ids) {
    const nextBucket = next.get(id)
    if (previous && previous.get(id) === nextBucket) continue
    const target = { source: PARCEL_SOURCE, sourceLayer: PARCEL_SOURCE_LAYER, id }
    if (nextBucket === undefined) map.removeFeatureState(target)
    else map.setFeatureState(target, { bucket: nextBucket })
  }
}

/** Ticket mode's sector labels ("S7 · 52% resolved" per PLAN-heatmap.md §5.3) -- computed from the
 *  sector's full, unfiltered rollup (a filter chip narrows which parcels are highlighted, not what
 *  "resolved" means for the sector as a whole). Halo colour is re-applied so it still matches
 *  NO_DATA_COLOR on a theme toggle; text colour itself is handled by applyInsightTheme, which
 *  already re-applies unconditionally regardless of which mode set the label text. */
export function updateTicketSectorLabels(
  map: MLMap,
  rollups: Map<number | null, SectorRollup>,
  theme: Theme,
): void {
  const labelBySector = new Map<number, string>()
  for (const [sectorNo, rollup] of rollups) {
    if (sectorNo === null) continue // peripheral has no sector polygon to label
    const pct = rollup.total > 0 ? Math.round((rollup.resolved / rollup.total) * 100) : 0
    labelBySector.set(sectorNo, `S${sectorNo} · ${pct}% resolved`)
  }
  if (map.getLayer(INSIGHT_SECTOR_LABEL_LAYER)) {
    map.setLayoutProperty(INSIGHT_SECTOR_LABEL_LAYER, 'text-field', [
      'format',
      sectorLabelExpr(labelBySector),
      {},
    ])
    map.setPaintProperty(INSIGHT_SECTOR_LABEL_LAYER, 'text-halo-color', NO_DATA_COLOR[theme])
  }
}

export type SectorHeatValues = Map<number, number> // sectorNo -> heat metric value (0 = no data)

/**
 * Repaints the sector fill/outline/label colours and label text from freshly computed heat
 * values + quantile breaks. Called on data load, filter/metric change, and from the theme-swap
 * effect (via a ref holding the latest values/breaks -- see MapView's insightPaintRef).
 */
export function updateInsightSectorPaint(
  map: MLMap,
  values: SectorHeatValues,
  rollups: Map<number | null, SectorRollup>,
  breaks: number[],
  theme: Theme,
  colorForValue: (value: number, breaks: number[], theme: Theme) => string,
): void {
  const colorBySector = new Map<number, string>()
  const labelBySector = new Map<number, string>()
  for (const [sectorNo, value] of values) {
    const color = colorForValue(value, breaks, theme)
    colorBySector.set(sectorNo, color)
    const rollup = rollups.get(sectorNo)
    labelBySector.set(sectorNo, rollup ? `S${sectorNo}\n${rollup.open} open` : `S${sectorNo}`)
  }

  if (map.getLayer(INSIGHT_SECTOR_FILL_LAYER)) {
    map.setPaintProperty(
      INSIGHT_SECTOR_FILL_LAYER,
      'fill-color',
      sectorColorExpr(colorBySector, NO_DATA_COLOR[theme]),
    )
  }
  if (map.getLayer(INSIGHT_SECTOR_OUTLINE_LAYER)) {
    const outlineBySector = new Map<number, string>()
    for (const [sectorNo, color] of colorBySector)
      outlineBySector.set(sectorNo, darkenHex(color, 0.25))
    map.setPaintProperty(
      INSIGHT_SECTOR_OUTLINE_LAYER,
      'line-color',
      sectorColorExpr(outlineBySector, darkenHex(NO_DATA_COLOR[theme], 0.25)),
    )
  }
  if (map.getLayer(INSIGHT_SECTOR_LABEL_LAYER)) {
    map.setLayoutProperty(INSIGHT_SECTOR_LABEL_LAYER, 'text-field', [
      'format',
      sectorLabelExpr(labelBySector),
      {},
    ])
    map.setPaintProperty(INSIGHT_SECTOR_LABEL_LAYER, 'text-halo-color', NO_DATA_COLOR[theme])
  }
}

/** Re-applies theme-dependent (but data-independent) paint -- the heat colour ramp, label
 *  text/halo colours, circle colours -- on a basemap theme toggle. Sector fill/outline colours
 *  ALSO depend on theme (colorForValue takes theme) so those are re-applied via a fresh
 *  updateInsightSectorPaint call, not here. */
export function applyInsightTheme(map: MLMap, theme: Theme): void {
  if (map.getLayer(INSIGHT_HEAT_LAYER)) {
    map.setPaintProperty(INSIGHT_HEAT_LAYER, 'heatmap-color', [
      'interpolate',
      ['linear'],
      ['heatmap-density'],
      0,
      'rgba(0,0,0,0)',
      0.2,
      HEAT_PALETTE[theme][0],
      0.4,
      HEAT_PALETTE[theme][1],
      0.6,
      HEAT_PALETTE[theme][2],
      0.8,
      HEAT_PALETTE[theme][3],
      1,
      HEAT_PALETTE[theme][4],
    ])
  }
  if (map.getLayer(INSIGHT_HEAT_POINTS_LAYER)) {
    map.setPaintProperty(INSIGHT_HEAT_POINTS_LAYER, 'circle-color', HEAT_PALETTE[theme][3])
    map.setPaintProperty(
      INSIGHT_HEAT_POINTS_LAYER,
      'circle-stroke-color',
      theme === 'dark' ? '#0b0d11' : '#ffffff',
    )
  }
  if (map.getLayer(INSIGHT_SECTOR_LABEL_LAYER)) {
    map.setPaintProperty(
      INSIGHT_SECTOR_LABEL_LAYER,
      'text-color',
      theme === 'dark' ? '#0b0d11' : '#ffffff',
    )
  }
  if (map.getLayer(INSIGHT_SECTOR_SELECTED_LAYER)) {
    map.setPaintProperty(
      INSIGHT_SECTOR_SELECTED_LAYER,
      'line-color',
      theme === 'dark' ? '#fb923c' : '#7c3aed',
    )
  }
}

export function setInsightSelectedFilter(map: MLMap, sectorNo: number | null): void {
  if (!map.getLayer(INSIGHT_SECTOR_SELECTED_LAYER)) return
  map.setFilter(INSIGHT_SECTOR_SELECTED_LAYER, ['==', ['get', 'sector_no'], sectorNo ?? -1])
}

function priorityWeight(priorityRow: InsightsPriorityRow | undefined): number {
  // Low/Normal/High/Critical -> 0.6/1/1.6/2.4, keyed by order rather than slug so an unexpected
  // priority slug still gets a sane mid weight instead of falling through to undefined.
  switch (priorityRow?.order) {
    case 0:
      return 0.6
    case 1:
      return 1
    case 2:
      return 1.6
    case 3:
      return 2.4
    default:
      return 1
  }
}

/** Builds the GeoJSON feature collection for the heat glow + heat points layers, weighted by
 *  priority per PLAN-heatmap.md §5.2. Respects the active filters the same way the sector-shading
 *  values do, and includes every ticket (not just open ones) when the metric is 'total' -- "Open
 *  tickets only, unless the metric is total" per §5.2. */
export function buildHeatFeatureCollection(
  tickets: InsightsTicketTuple[],
  statuses: InsightsStatusRow[],
  priorities: InsightsPriorityRow[],
  classGroups: string[],
  filters: InsightsFilters,
  metric: HeatMetric,
  now: number = Date.now(),
): FeatureCollection<Point, { sector_no: number | null; weight: number }> {
  const features: Feature<Point, { sector_no: number | null; weight: number }>[] = []
  for (const t of tickets) {
    if (!matchesFilters(t, statuses, priorities, classGroups, filters, now)) continue
    if (metric !== 'total' && !isOpenTicket(t, statuses)) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [t[TicketField.Lng], t[TicketField.Lat]] },
      properties: {
        sector_no: t[TicketField.SectorNo],
        weight: priorityWeight(priorities[t[TicketField.PriorityIdx]]),
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function setInsightHeatData(
  map: MLMap,
  data: FeatureCollection<Point, { sector_no: number | null; weight: number }>,
): void {
  const src = map.getSource(INSIGHT_HEAT_SOURCE)
  if (src && 'setData' in src) (src as GeoJSONSource).setData(data)
}
