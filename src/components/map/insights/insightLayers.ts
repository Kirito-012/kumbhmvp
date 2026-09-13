import type { Map as MLMap, ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { HEAT_PALETTE, NO_DATA_COLOR, darkenHex, type Theme } from '@/lib/insights/heatScale'
import type { SectorRollup } from '@/lib/insights/aggregate'
import { isOpenTicket } from '@/lib/insights/aggregate'
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

export const INSIGHT_HEAT_SOURCE = 'insight-tickets'

export const INSIGHT_SECTOR_FILL_LAYER = 'insight-sector-fill'
export const INSIGHT_SECTOR_OUTLINE_LAYER = 'insight-sector-outline'
export const INSIGHT_SECTOR_SELECTED_LAYER = 'insight-sector-selected'
export const INSIGHT_SECTOR_LABEL_LAYER = 'insight-sector-label'
export const INSIGHT_HEAT_LAYER = 'insight-heat'
export const INSIGHT_HEAT_POINTS_LAYER = 'insight-heat-points'

/** Every layer this module owns, bottom-to-top paint order. Used for visibility toggling and for
 *  the theme-swap effect's re-theme pass. */
export const INSIGHT_LAYER_IDS = [
  INSIGHT_SECTOR_FILL_LAYER,
  INSIGHT_SECTOR_OUTLINE_LAYER,
  INSIGHT_SECTOR_LABEL_LAYER,
  INSIGHT_SECTOR_SELECTED_LAYER,
  INSIGHT_HEAT_LAYER,
  INSIGHT_HEAT_POINTS_LAYER,
] as const

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

/** Builds the GeoJSON feature collection for the heat glow + heat points layers -- open tickets
 *  only (heat metric 'open', the Phase 3 default), weighted by priority per PLAN-heatmap.md §5.2. */
export function buildHeatFeatureCollection(
  tickets: InsightsTicketTuple[],
  statuses: InsightsStatusRow[],
  priorities: InsightsPriorityRow[],
): FeatureCollection<Point, { sector_no: number | null; weight: number }> {
  const features: Feature<Point, { sector_no: number | null; weight: number }>[] = []
  for (const t of tickets) {
    if (!isOpenTicket(t, statuses)) continue
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
