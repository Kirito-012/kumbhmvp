import type { Map as MLMap, ExpressionSpecification, FilterSpecification, GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection, Point, Geometry } from 'geojson'
import { badgeIconId, makeBadgeIcon, chevronIconId, makeChevronIcon } from '@/lib/mapBadgeIcon'
import { EVAC_COLORS, type EvacKey, type EvacTheme } from '@/lib/evacuation/layers'
import { buildEvacFilters, trafficRoutePlanVisible, type EvacFilters } from '@/lib/evacuation/filters'

// Evacuation mode's own MapLibre layers -- see PLAN-evacuation.md §6. Every layer here is created
// once, hidden, in initMap's `load` handler (gated on canUseInsights, same as insightLayers.ts's
// addInsightLayers) and toggled purely by layout visibility from then on -- entering/leaving the
// mode is a pure visibility flip with no layer-creation latency, same contract as Heatmap/Ticket.
//
// Every layer here reuses an EXISTING source (the `traffic_route`/`entry_exit_line`/
// `direction_line`/`entry_exit`/`location_entry` POI sources MapView's own POI-layer loop already
// creates, plus the `emergency_exit` source added in Phase 0) except `hfl_area`/`hfl_line`, which
// get their own new vector sources here (Phase 0 loaded the tables; nothing else tiles them yet).
// Map mode's own styling is never touched -- these are new layer ids, not edits to `poi-*`/
// `road-line`/`emergency-exit-line`.
//
// Originally deferred (see PLAN-evacuation.md §10's phase notes), since implemented as follow-ups:
// traffic-route/direction-signage arrows (§13/§14 -- bearing-driven points, not line-following
// chevrons, once real data showed vertex order is unreliable), the selected-feature pulse-then-
// settle animation (§14), zone outlines/labels (below), and hover feature-state (below).

const FLOOD_AREA_SOURCE = 'hfl_area'
const FLOOD_LINE_SOURCE = 'hfl_line'
/** Holds the single currently-selected/hovered evac-* feature (Phase 5 populates it via
 *  `setData()`) -- created empty now so later phases only need to feed it data, not touch layer
 *  creation. A 'line' layer renders a LineString/Polygon feature's boundary; a 'circle' layer
 *  renders a Point one; the same empty source backs both, so whichever geometry Phase 5 puts in
 *  paints on the layer that actually matches it. */
const SELECTED_SOURCE = 'evac-selected'
/** Arrow midpoints (one point per traffic_route/direction_line row that has a resolvable Entry/
 *  Exit direction), populated once via setEvacArrowsData -- see /api/evacuation/arrows and this
 *  file's own header comment on why these are bearing-driven points, not line-following chevrons. */
const TRAFFIC_ROUTE_ARROWS_SOURCE = 'evac-traffic-route-arrows'
const DIRECTION_LINE_ARROWS_SOURCE = 'evac-direction-line-arrows'
/** Zone outlines -- populated via setEvacZonesData once /api/evacuation/summary resolves (it
 *  always returns all 5 zones' unioned geometry, regardless of focus, per PLAN-evacuation.md
 *  §2.4/§8.2). */
const ZONE_OUTLINE_SOURCE = 'evac-zone-outline'
const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Every layer id this module creates, grouped by which `evacVisibility` key controls it -- the
 *  single source of truth `setEvacLayersVisible` and the theme-swap pass both iterate. */
const LAYERS_BY_KEY: Record<EvacKey, string[]> = {
  hfl_area: ['evac-hfl-area-fill', 'evac-hfl-area-outline'],
  hfl_line: ['evac-hfl-line'],
  traffic_route: [
    'evac-traffic-route-casing',
    'evac-traffic-route-peak',
    'evac-traffic-route-normal',
    'evac-traffic-route-arrows',
  ],
  entry_exit_line: ['evac-entry-exit-line-glow', 'evac-entry-exit-line'],
  direction_line: ['evac-direction-line', 'evac-direction-line-arrows'],
  emergency_exit: ['evac-emergency-exit-glow', 'evac-emergency-exit-casing', 'evac-emergency-exit'],
  entry_exit: [
    'evac-entry-exit-cluster',
    'evac-entry-exit-cluster-count',
    'evac-entry-exit-hit',
    'evac-entry-exit-badge',
  ],
  location_entry: ['evac-location-entry-hit', 'evac-location-entry-badge'],
  // Supporting layers with no evac-* layer of their own yet -- they reuse Map mode's existing
  // `poi-*` layers directly (see MapView's setEvacLayersVisible call site), so there's nothing for
  // THIS module to toggle for them; listed here only so the Record is total over every EvacKey.
  thematic_gate: [],
  junction: [],
  bridge: [],
  footpath: [],
  fh_location: [],
  public_service_facilities: [],
  zone_outline: ['evac-zone-outline-line', 'evac-zone-outline-label'],
}

function colorPair(pair: { light: string; dark: string }, theme: EvacTheme): string {
  return theme === 'light' ? pair.light : pair.dark
}

/** 'Entry' -> green, 'Exit' -> rose, anything else (destination signs, null) -> slate. Reused for
 *  entry_exit_line/entry_exit/location_entry's `remark` and traffic_route's `entry_exit` -- both
 *  columns use the same 'Entry'/'Exit' vocabulary (case-sensitive; direction_line's own `remark`
 *  is upper-cased 'ENTRY'/'EXIT' instead, so its expression upcases the field first). */
function entryExitColorExpr(field: string, theme: EvacTheme): ExpressionSpecification {
  return [
    'match',
    ['get', field],
    'Entry',
    colorPair(EVAC_COLORS.entry, theme),
    'Exit',
    colorPair(EVAC_COLORS.exit, theme),
    colorPair(EVAC_COLORS.unknown, theme),
  ] as unknown as ExpressionSpecification
}

function directionLineColorExpr(theme: EvacTheme): ExpressionSpecification {
  return [
    'match',
    ['upcase', ['get', 'remark']],
    'ENTRY',
    colorPair(EVAC_COLORS.entry, theme),
    'EXIT',
    colorPair(EVAC_COLORS.exit, theme),
    colorPair(EVAC_COLORS.unknown, theme),
  ] as unknown as ExpressionSpecification
}

/** Same reversed-zoom glow curve as Map mode's own `poi-entry_exit_line-glow` (see MapView's POI
 *  line-layer loop) -- these are short real-world segments that would otherwise be an invisible
 *  speck at region zoom, so the glow widens as you zoom OUT rather than in. Reused verbatim for
 *  entry/exit routes and emergency exits, the two other short-segment line layers this mode has. */
const GLOW_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  28,
  9,
  18,
  13,
  8,
  16,
  0,
] as unknown as ExpressionSpecification
const GLOW_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  0.55,
  9,
  0.4,
  16,
  0,
] as unknown as ExpressionSpecification

const PEAK_DAY_FILTER: FilterSpecification = ['==', ['get', 'plan'], 'Peak day']
const NOT_PEAK_DAY_FILTER: FilterSpecification = ['!=', ['get', 'plan'], 'Peak day']
const UNCLUSTERED_FILTER: FilterSpecification = ['!', ['has', 'point_count']]
const CLUSTERED_FILTER: FilterSpecification = ['has', 'point_count']

const HOVER_CONDITION = ['boolean', ['feature-state', 'hover'], false] as unknown as ExpressionSpecification

/** Widens a hoverable evac-* line by `boost` px while MapLibre's native feature-state `hover` flag
 *  is set on it (see MapView's evac hover mousemove/mouseleave handlers) -- shared by the 3
 *  constant-width hoverable line layers (entry/exit routes, direction signage, emergency exits).
 *  `base` must be a plain number, not a zoom expression -- MapLibre only allows a `zoom` input to
 *  appear directly under `step`/`interpolate` or nested in `let`/`case`/`coalesce`, and wrapping
 *  one in `+` (as an earlier version of this helper did) fails style validation with "Only step,
 *  interpolate, let, and case expressions may be used in an expression that is compared against a
 *  zoom" -- silently leaving the whole layer uncreated. `trafficRouteWidthExpr` below handles the
 *  one hoverable layer that IS zoom-interpolated instead. Requires the source's `promoteId`
 *  (already set for every layer this applies to -- see MapView's POI-source-creation loop) so a
 *  feature's feature-state can be looked up by its real `id` rather than an internal tile-local
 *  one. */
function withHoverWidth(base: number, boost: number): ExpressionSpecification {
  return ['case', HOVER_CONDITION, base + boost, base] as unknown as ExpressionSpecification
}

/** Same hover-boost idea as `withHoverWidth`, but for traffic_route's zoom-interpolated width --
 *  the `case` has to live INSIDE each interpolation stop's output value, not wrap the whole
 *  `interpolate` expression, since `zoom` may only appear directly under `step`/`interpolate` (see
 *  `withHoverWidth`'s own comment for the validation error this avoids). */
function trafficRouteWidthExpr(boost: number): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    8,
    ['case', HOVER_CONDITION, 2.5 + boost, 2.5],
    14,
    ['case', HOVER_CONDITION, 4 + boost, 4],
  ] as unknown as ExpressionSpecification
}

function ensureBadgeImage(map: MLMap, text: string, color: string): string {
  const id = badgeIconId(text, color)
  if (map.hasImage(id)) map.removeImage(id)
  map.addImage(id, makeBadgeIcon(text, color), { pixelRatio: 4 })
  return id
}

function ensureChevronImage(map: MLMap, color: string): string {
  const id = chevronIconId(color)
  if (map.hasImage(id)) map.removeImage(id)
  map.addImage(id, makeChevronIcon(color), { pixelRatio: 4 })
  return id
}

/** icon-image match expression shared by both arrow layers -- 'Entry'/'Exit' (traffic_route's
 *  `entry_exit`) or upper-cased 'ENTRY'/'EXIT' (direction_line's `remark`) both normalise to the
 *  same 3-way match since MapLibre's `match` does a strict equality check, not case-insensitive. */
function arrowIconExpr(map: MLMap, field: string, theme: EvacTheme, upcase: boolean): ExpressionSpecification {
  const getField = upcase ? (['upcase', ['get', field]] as const) : (['get', field] as const)
  const entryValue = upcase ? 'ENTRY' : 'Entry'
  const exitValue = upcase ? 'EXIT' : 'Exit'
  return [
    'match',
    getField,
    entryValue,
    ensureChevronImage(map, colorPair(EVAC_COLORS.entry, theme)),
    exitValue,
    ensureChevronImage(map, colorPair(EVAC_COLORS.exit, theme)),
    ensureChevronImage(map, colorPair(EVAC_COLORS.unknown, theme)),
  ] as unknown as ExpressionSpecification
}

/** Creates every evac-* source/layer once, hidden. Call from initMap's `load` handler, gated on
 *  `canUseInsights`, AFTER MapView's own POI-layer loop has created the `traffic_route`/
 *  `entry_exit_line`/`direction_line`/`entry_exit`/`location_entry` sources this reuses (order
 *  within the evac-* stack itself is fully self-contained, so where this lands relative to Map
 *  mode's own layers doesn't matter -- the two are never visible at the same time, see
 *  visibilityForMode). Idempotent-guarded the same way MapView guards its own one-time layers
 *  (`if (!map.getLayer(...))`), for Strict Mode's dev double-invoke. */
export function addEvacLayers(map: MLMap, theme: EvacTheme): void {
  // Guarded on the very FIRST thing this function creates (not the last) so a call that somehow
  // re-enters mid-way (React Strict Mode's dev double-invoke of the mount effect, or a Fast
  // Refresh re-run while the map instance survives) bails out immediately rather than reaching a
  // real `addSource`/`addLayer` call for an id that's already there -- MapLibre throws
  // synchronously ("Source ... already exists") rather than no-op'ing on a duplicate id.
  //
  // This guard tripping on the FIRST real call (not a re-entry) is exactly the Phase 5 bug: if
  // `hfl_area`/`hfl_line` ever gain an entry in classColors.ts's LINE_LAYER_COLORS/
  // POLYGON_LAYER_COLORS again, MapView's generic POI loop will create a same-named `hfl_area`
  // vector source of its own *before* this function ever runs, so this guard silently no-ops on
  // every single call and every evac-* layer below silently never exists -- see that file's
  // comment on why those two colour maps must never have entries for them.
  if (map.getSource(FLOOD_AREA_SOURCE)) return

  map.addSource(FLOOD_AREA_SOURCE, {
    type: 'vector',
    tiles: [`${location.origin}/api/tiles/hfl_area/{z}/{x}/{y}`],
    promoteId: 'id',
  })
  map.addSource(FLOOD_LINE_SOURCE, {
    type: 'vector',
    tiles: [`${location.origin}/api/tiles/hfl_line/{z}/{x}/{y}`],
    promoteId: 'id',
  })
  map.addSource(SELECTED_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  // Populated later via setEvacArrowsData once /api/evacuation/arrows resolves -- empty at
  // creation, same "layers exist, data arrives async" shape as SELECTED_SOURCE.
  map.addSource(TRAFFIC_ROUTE_ARROWS_SOURCE, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
  map.addSource(DIRECTION_LINE_ARROWS_SOURCE, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
  map.addSource(ZONE_OUTLINE_SOURCE, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })

  // --- Flood risk (off by default; hfl_area/hfl_line are 25-Aug-2026-only, see CONTEXT.md §10) --
  map.addLayer({
    id: 'evac-hfl-area-fill',
    type: 'fill',
    source: FLOOD_AREA_SOURCE,
    'source-layer': 'hfl_area',
    layout: { visibility: 'none' },
    paint: {
      'fill-color': colorPair(EVAC_COLORS.floodArea, theme),
      'fill-opacity': theme === 'light' ? 0.14 : 0.18,
    },
  })
  map.addLayer({
    id: 'evac-hfl-area-outline',
    type: 'line',
    source: FLOOD_AREA_SOURCE,
    'source-layer': 'hfl_area',
    layout: { visibility: 'none' },
    paint: {
      'line-color': colorPair(EVAC_COLORS.floodArea, theme),
      'line-width': 1,
      'line-opacity': 0.6,
    },
  })
  map.addLayer({
    id: 'evac-hfl-line',
    type: 'line',
    source: FLOOD_LINE_SOURCE,
    'source-layer': 'hfl_line',
    layout: { visibility: 'none' },
    paint: {
      'line-color': colorPair(EVAC_COLORS.floodLine, theme),
      'line-width': 1.5,
      'line-dasharray': [3, 2],
      // Fainter for a 25-year flood extent, strongest for the 100-year one -- so the least-likely
      // scenario doesn't visually dominate the one worth planning around most.
      'line-opacity': [
        'match',
        ['get', 'return_period_years'],
        25,
        0.45,
        50,
        0.65,
        100,
        0.9,
        0.5,
      ] as unknown as ExpressionSpecification,
    },
  })

  // --- Zone outlines (supporting; off by default) -----------------------------------------------
  // Thick dashed outline + a name label -- geometry is the ST_Union of each zone's member sectors,
  // fed by setEvacZonesData once /api/evacuation/summary resolves (§2.4/§8.2). A `line` layer on
  // Polygon/MultiPolygon geometry renders its ring automatically, same as a `symbol` layer picks a
  // reasonable label point inside it -- no separate point source needed, unlike sector labels
  // elsewhere in the app (those come from a real per-sector centroid source because they also need
  // to line up with individual sector polygons at every zoom, not just look roughly centered).
  map.addLayer({
    id: 'evac-zone-outline-line',
    type: 'line',
    source: ZONE_OUTLINE_SOURCE,
    layout: { visibility: 'none', 'line-join': 'round' },
    paint: {
      'line-color': colorPair(EVAC_COLORS.zoneOutline, theme),
      'line-width': 3,
      'line-dasharray': [3, 2],
      'line-opacity': 0.8,
    },
  })
  map.addLayer({
    id: 'evac-zone-outline-label',
    type: 'symbol',
    source: ZONE_OUTLINE_SOURCE,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-letter-spacing': 0.05,
    },
    paint: {
      'text-color': colorPair(EVAC_COLORS.zoneOutline, theme),
      'text-halo-color': theme === 'light' ? '#ffffff' : '#0b0f19',
      'text-halo-width': 1.5,
    },
  })

  // --- Traffic routes (core layer; on by default) ---------------------------------------------
  map.addLayer({
    id: 'evac-traffic-route-casing',
    type: 'line',
    source: 'traffic_route',
    'source-layer': 'traffic_route',
    layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': theme === 'light' ? '#0f172a' : '#e2e8f0',
      'line-opacity': theme === 'light' ? 0.18 : 0.22,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 7] as unknown as ExpressionSpecification,
    },
  })
  const trafficRouteCore = (id: string, filter: FilterSpecification, dashed: boolean) =>
    map.addLayer({
      id,
      type: 'line',
      source: 'traffic_route',
      'source-layer': 'traffic_route',
      filter,
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': entryExitColorExpr('entry_exit', theme),
        'line-width': trafficRouteWidthExpr(1.5),
        ...(dashed ? { 'line-dasharray': [2, 1.5] } : {}),
      },
    })
  // Peak day: solid core. Normal day (and the 5 rows with no `plan` at all): dashed -- see
  // PLAN-evacuation.md §6.2 item 4 on why this is 2 layers rather than a data-driven dasharray.
  trafficRouteCore('evac-traffic-route-peak', PEAK_DAY_FILTER, false)
  trafficRouteCore('evac-traffic-route-normal', NOT_PEAK_DAY_FILTER, true)
  // Arrows -- a bearing-driven point per route, not a line-following chevron (see this file's own
  // header comment + /api/evacuation/arrows for why). Shown from z12 so region-wide zoom stays
  // uncluttered; `entry_exit`/`plan`/corridor properties on the source feature let
  // applyEvacFilters filter this exactly like the peak/normal lines above.
  map.addLayer({
    id: 'evac-traffic-route-arrows',
    type: 'symbol',
    source: TRAFFIC_ROUTE_ARROWS_SOURCE,
    minzoom: 12,
    layout: {
      visibility: 'none',
      'icon-image': arrowIconExpr(map, 'entry_exit', theme, false),
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-size': 0.9,
    },
  })

  // --- Entry/exit routes (on by default) ------------------------------------------------------
  map.addLayer({
    id: 'evac-entry-exit-line-glow',
    type: 'line',
    source: 'entry_exit_line',
    'source-layer': 'entry_exit_line',
    layout: { visibility: 'none' },
    paint: {
      'line-color': entryExitColorExpr('remark', theme),
      'line-width': GLOW_WIDTH,
      'line-opacity': GLOW_OPACITY,
      'line-blur': 1.5,
    },
  })
  map.addLayer({
    id: 'evac-entry-exit-line',
    type: 'line',
    source: 'entry_exit_line',
    'source-layer': 'entry_exit_line',
    layout: { visibility: 'none' },
    paint: {
      'line-color': entryExitColorExpr('remark', theme),
      'line-width': withHoverWidth(2.5, 1.5),
    },
  })

  // --- Direction signage (on by default) ------------------------------------------------------
  map.addLayer({
    id: 'evac-direction-line',
    type: 'line',
    source: 'direction_line',
    'source-layer': 'direction_line',
    layout: { visibility: 'none' },
    paint: {
      'line-color': directionLineColorExpr(theme),
      'line-width': withHoverWidth(2, 1.5),
    },
  })
  // Same bearing-driven arrow point as traffic_route's above -- only the 89 ENTRY/EXIT wayfinding
  // signs get one (the 4 destination signs have no resolvable direction, see /api/evacuation/arrows).
  map.addLayer({
    id: 'evac-direction-line-arrows',
    type: 'symbol',
    source: DIRECTION_LINE_ARROWS_SOURCE,
    minzoom: 12,
    layout: {
      visibility: 'none',
      'icon-image': arrowIconExpr(map, 'remark', theme, true),
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-size': 0.75,
    },
  })

  // --- Emergency exits (on by default) ---------------------------------------------------------
  map.addLayer({
    id: 'evac-emergency-exit-glow',
    type: 'line',
    source: 'emergency_exit',
    'source-layer': 'emergency_exit',
    layout: { visibility: 'none' },
    paint: {
      'line-color': colorPair(EVAC_COLORS.emergencyExit, theme),
      'line-width': GLOW_WIDTH,
      'line-opacity': GLOW_OPACITY,
      'line-blur': 1.5,
    },
  })
  map.addLayer({
    id: 'evac-emergency-exit-casing',
    type: 'line',
    source: 'emergency_exit',
    'source-layer': 'emergency_exit',
    layout: { visibility: 'none' },
    paint: {
      'line-color': colorPair(EVAC_COLORS.emergencyExitCasing, theme),
      'line-width': 4,
    },
  })
  map.addLayer({
    id: 'evac-emergency-exit',
    type: 'line',
    source: 'emergency_exit',
    'source-layer': 'emergency_exit',
    layout: { visibility: 'none' },
    paint: {
      'line-color': colorPair(EVAC_COLORS.emergencyExit, theme),
      'line-width': withHoverWidth(2, 1.5),
    },
  })

  // --- Entry/exit point badges (on by default) ------------------------------------------------
  // Own dedicated cluster/hit layers rather than reusing Map mode's `poi-entry_exit-*` ones --
  // those are always force-hidden while this mode is active (visibilityForMode turns every
  // POI_LAYER_DEFS key off), so reusing them would mean un-hiding specific Map-mode layers from
  // evacuation-mode code, coupling the two. A dedicated layer set on the SAME already-clustered
  // `entry_exit` source costs one extra paint definition, not an extra request.
  map.addLayer({
    id: 'evac-entry-exit-cluster',
    type: 'circle',
    source: 'entry_exit',
    filter: CLUSTERED_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'circle-color': colorPair(EVAC_COLORS.entry, theme),
      'circle-opacity': 0.8,
      'circle-radius': ['step', ['get', 'point_count'], 9, 10, 14, 50, 19] as unknown as ExpressionSpecification,
    },
  })
  map.addLayer({
    id: 'evac-entry-exit-cluster-count',
    type: 'symbol',
    source: 'entry_exit',
    filter: CLUSTERED_FILTER,
    minzoom: 9,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff' },
  })
  map.addLayer({
    id: 'evac-entry-exit-hit',
    type: 'circle',
    source: 'entry_exit',
    filter: UNCLUSTERED_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 14] as unknown as ExpressionSpecification,
      'circle-opacity': 0,
    },
  })
  map.addLayer({
    id: 'evac-entry-exit-badge',
    type: 'symbol',
    source: 'entry_exit',
    filter: UNCLUSTERED_FILTER,
    layout: {
      visibility: 'none',
      'icon-image': [
        'match',
        ['get', 'remark'],
        'Entry',
        ensureBadgeImage(map, 'EN', colorPair(EVAC_COLORS.entry, theme)),
        'Exit',
        ensureBadgeImage(map, 'EXT', colorPair(EVAC_COLORS.exit, theme)),
        ensureBadgeImage(map, 'EN', colorPair(EVAC_COLORS.unknown, theme)),
      ] as unknown as ExpressionSpecification,
      'icon-allow-overlap': false,
    },
  })

  // --- Location entry markers (on by default) -------------------------------------------------
  map.addLayer({
    id: 'evac-location-entry-hit',
    type: 'circle',
    source: 'location_entry',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 14] as unknown as ExpressionSpecification,
      'circle-opacity': 0,
    },
  })
  map.addLayer({
    id: 'evac-location-entry-badge',
    type: 'symbol',
    source: 'location_entry',
    layout: {
      visibility: 'none',
      'icon-image': ensureBadgeImage(map, 'EN', colorPair(EVAC_COLORS.entry, theme)),
      'icon-allow-overlap': false,
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
    },
    minzoom: 15,
    paint: {
      'text-color': theme === 'light' ? '#1e293b' : '#e2e8f0',
      'text-halo-color': theme === 'light' ? '#ffffff' : '#0b0f19',
      'text-halo-width': 1.5,
    },
  })

  // --- Selected feature (inert until Phase 5) -------------------------------------------------
  map.addLayer({
    id: 'evac-selected-glow',
    type: 'line',
    source: SELECTED_SOURCE,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#facc15', 'line-width': 10, 'line-opacity': 0.5, 'line-blur': 2 },
  })
  map.addLayer({
    id: 'evac-selected-line',
    type: 'line',
    source: SELECTED_SOURCE,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#facc15', 'line-width': 3 },
  })
  map.addLayer({
    id: 'evac-selected-point',
    type: 'circle',
    source: SELECTED_SOURCE,
    layout: { visibility: 'none' },
    paint: { 'circle-radius': 12, 'circle-color': '#facc15', 'circle-opacity': 0.35 },
  })
}

/** Toggles every evac-* layer's layout visibility per `evacVisibility`, called whenever the mode,
 *  the visibility store, or `evacFilters` changes (see MapView's mode-visibility effect). The 6
 *  supporting keys with no evac-* layer of their own (thematic_gate/junction/bridge/footpath/
 *  fh_location/public_service_facilities) reuse Map mode's own `poi-*` layers directly -- the
 *  caller (which owns `applyLayerVisibility`'s force-off list in `visibilityForMode`) un-hides
 *  exactly the ones this mode wants, without this module reaching into Map-mode layer ids itself.
 *
 *  traffic_route's peak/normal layers are special-cased: their visibility is the AND of the
 *  `traffic_route` evacVisibility toggle AND the plan filter's own choice of which of the two to
 *  show (`trafficRoutePlanVisible`) -- two independent on/off conditions on the same pair of
 *  layers, so they can't just read `evacVisibility.traffic_route` like every other layer here. */
export function setEvacLayersVisible(
  map: MLMap,
  on: boolean,
  evacVisibility: Record<EvacKey, boolean>,
  evacFilters: EvacFilters,
): void {
  for (const [key, layerIds] of Object.entries(LAYERS_BY_KEY) as [
    Exclude<EvacKey, 'zone_outline'>,
    string[],
  ][]) {
    const layerOn = on && evacVisibility[key]
    for (const id of layerIds) {
      if (!map.getLayer(id)) continue
      const visible =
        id === 'evac-traffic-route-peak'
          ? layerOn && trafficRoutePlanVisible('Peak day', evacFilters)
          : id === 'evac-traffic-route-normal'
            ? layerOn && trafficRoutePlanVisible('Normal day', evacFilters)
            : layerOn
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  }
  // Selected-feature layers (evac-selected-glow/-line/-point) are deliberately NOT touched here --
  // there's no evacVisibility key for "is something selected"; their own visibility is driven
  // entirely by whether evacSelection is set, in MapView's dedicated effect (Phase 5).
}

/** Applies the direction/corridor filters (PLAN-evacuation.md §6.3) to every evac-* layer whose
 *  underlying table has those columns, ANDed onto traffic_route's own permanent peak/normal
 *  split. Called whenever `evacFilters` changes.
 *
 *  `entry_exit` (the point badges) is deliberately NOT filtered here: it sits on a clustered
 *  geojson source, and a style `setFilter` can't change which points get clustered together in
 *  the first place (CONTEXT.md §9 "Clustering") -- doing this properly needs the server-side
 *  `?remark=` refetch path this file's own header comment and the plan's §6.3 describe, which
 *  isn't wired up yet. The Direction chip currently has no visible effect on entry/exit points. */
export function applyEvacFilters(map: MLMap, filters: EvacFilters): void {
  if (!map.getLayer('evac-traffic-route-casing')) return // not created yet (canUseInsights false)

  const plain = buildEvacFilters(filters)
  const asFilter = (f: FilterSpecification | null | undefined) => (f ?? null) as FilterSpecification | null

  // The casing has no permanent plan split of its own (unlike the peak/normal core layers), so a
  // plan selection is applied here as a real filter rather than a visibility choice.
  const casingParts = [plain.traffic_route, filters.plan ? ['==', ['get', 'plan'], filters.plan] : null].filter(
    (p): p is FilterSpecification => Boolean(p),
  )
  const casingFilter =
    casingParts.length === 0 ? null : casingParts.length === 1 ? casingParts[0] : (['all', ...casingParts] as unknown as FilterSpecification)
  map.setFilter('evac-traffic-route-casing', casingFilter)
  // Arrows aren't split into peak/normal layers (one point per route, unlike the 2 line layers
  // below), so they take the same combined direction+corridor+plan filter as the casing.
  if (map.getLayer('evac-traffic-route-arrows')) {
    map.setFilter('evac-traffic-route-arrows', casingFilter)
  }

  const peak = buildEvacFilters(filters, { traffic_route: PEAK_DAY_FILTER })
  const normal = buildEvacFilters(filters, { traffic_route: NOT_PEAK_DAY_FILTER })
  map.setFilter('evac-traffic-route-peak', asFilter(peak.traffic_route))
  map.setFilter('evac-traffic-route-normal', asFilter(normal.traffic_route))

  map.setFilter('evac-entry-exit-line-glow', asFilter(plain.entry_exit_line))
  map.setFilter('evac-entry-exit-line', asFilter(plain.entry_exit_line))

  map.setFilter('evac-direction-line', asFilter(plain.direction_line))
  if (map.getLayer('evac-direction-line-arrows')) {
    map.setFilter('evac-direction-line-arrows', asFilter(plain.direction_line))
  }
}

/** Feeds the two arrow geojson sources their data -- called once from MapView after
 *  `/api/evacuation/arrows` resolves (mirrors how evac-selected is fed via setData). */
export function setEvacArrowsData(
  map: MLMap,
  data: { trafficRoute: FeatureCollection<Point>; directionLine: FeatureCollection<Point> },
): void {
  const trafficSource = map.getSource(TRAFFIC_ROUTE_ARROWS_SOURCE) as GeoJSONSource | undefined
  const directionSource = map.getSource(DIRECTION_LINE_ARROWS_SOURCE) as GeoJSONSource | undefined
  trafficSource?.setData(data.trafficRoute)
  directionSource?.setData(data.directionLine)
}

/** Feeds the zone-outline geojson source its data -- called from MapView whenever
 *  /api/evacuation/summary resolves (it always returns all 5 zones, regardless of focus). Each
 *  zone becomes one Feature carrying its own display label so the layer's `text-field` expression
 *  never has to reformat the raw `ZONE NAME`-cased value itself. */
export function setEvacZonesData(map: MLMap, zones: { zone: string; geojson: Geometry }[]): void {
  const source = map.getSource(ZONE_OUTLINE_SOURCE) as GeoJSONSource | undefined
  if (!source) return
  source.setData({
    type: 'FeatureCollection',
    features: zones.map((z) => ({
      type: 'Feature',
      properties: { label: zoneDisplayLabel(z.zone) },
      geometry: z.geojson,
    })),
  })
}

/** 'BAIRAGICAMP ZONE' -> 'Bairagicamp zone' -- same transform EvacuationModePanel's own
 *  `zoneTitleCase` applies to search results, duplicated here (not exported/shared) since this is
 *  the only other place a raw zone name reaches the UI. */
function zoneDisplayLabel(zone: string): string {
  return zone.charAt(0) + zone.slice(1).toLowerCase()
}

/** Re-applies every evac-* colour paint property and regenerates the EN/EXT badge images for the
 *  new theme -- called from MapView's one shared theme-swap effect (PLAN-evacuation.md §6.4).
 *  Images are coloured when created (`makeBadgeIcon` bakes the fill in), so unlike a plain
 *  `setPaintProperty` colour swap, the icon-image expression's referenced image ids must change
 *  too -- `ensureBadgeImage` re-registers (or replaces) them under the new theme's colour. */
export function applyEvacTheme(map: MLMap, theme: EvacTheme): void {
  if (!map.getLayer('evac-hfl-area-fill')) return // not created yet (canUseInsights false)

  map.setPaintProperty('evac-hfl-area-fill', 'fill-color', colorPair(EVAC_COLORS.floodArea, theme))
  map.setPaintProperty(
    'evac-hfl-area-fill',
    'fill-opacity',
    theme === 'light' ? 0.14 : 0.18,
  )
  map.setPaintProperty(
    'evac-hfl-area-outline',
    'line-color',
    colorPair(EVAC_COLORS.floodArea, theme),
  )
  map.setPaintProperty('evac-hfl-line', 'line-color', colorPair(EVAC_COLORS.floodLine, theme))

  if (map.getLayer('evac-zone-outline-line')) {
    map.setPaintProperty('evac-zone-outline-line', 'line-color', colorPair(EVAC_COLORS.zoneOutline, theme))
    map.setPaintProperty('evac-zone-outline-label', 'text-color', colorPair(EVAC_COLORS.zoneOutline, theme))
    map.setPaintProperty(
      'evac-zone-outline-label',
      'text-halo-color',
      theme === 'light' ? '#ffffff' : '#0b0f19',
    )
  }

  map.setPaintProperty(
    'evac-traffic-route-casing',
    'line-color',
    theme === 'light' ? '#0f172a' : '#e2e8f0',
  )
  map.setPaintProperty(
    'evac-traffic-route-casing',
    'line-opacity',
    theme === 'light' ? 0.18 : 0.22,
  )
  map.setPaintProperty('evac-traffic-route-peak', 'line-color', entryExitColorExpr('entry_exit', theme))
  map.setPaintProperty('evac-traffic-route-normal', 'line-color', entryExitColorExpr('entry_exit', theme))
  if (map.getLayer('evac-traffic-route-arrows')) {
    map.setLayoutProperty('evac-traffic-route-arrows', 'icon-image', arrowIconExpr(map, 'entry_exit', theme, false))
  }

  map.setPaintProperty('evac-entry-exit-line-glow', 'line-color', entryExitColorExpr('remark', theme))
  map.setPaintProperty('evac-entry-exit-line', 'line-color', entryExitColorExpr('remark', theme))

  map.setPaintProperty('evac-direction-line', 'line-color', directionLineColorExpr(theme))
  if (map.getLayer('evac-direction-line-arrows')) {
    map.setLayoutProperty('evac-direction-line-arrows', 'icon-image', arrowIconExpr(map, 'remark', theme, true))
  }

  map.setPaintProperty(
    'evac-emergency-exit-glow',
    'line-color',
    colorPair(EVAC_COLORS.emergencyExit, theme),
  )
  map.setPaintProperty(
    'evac-emergency-exit-casing',
    'line-color',
    colorPair(EVAC_COLORS.emergencyExitCasing, theme),
  )
  map.setPaintProperty('evac-emergency-exit', 'line-color', colorPair(EVAC_COLORS.emergencyExit, theme))

  map.setPaintProperty('evac-entry-exit-cluster', 'circle-color', colorPair(EVAC_COLORS.entry, theme))
  map.setLayoutProperty('evac-entry-exit-badge', 'icon-image', [
    'match',
    ['get', 'remark'],
    'Entry',
    ensureBadgeImage(map, 'EN', colorPair(EVAC_COLORS.entry, theme)),
    'Exit',
    ensureBadgeImage(map, 'EXT', colorPair(EVAC_COLORS.exit, theme)),
    ensureBadgeImage(map, 'EN', colorPair(EVAC_COLORS.unknown, theme)),
  ] as unknown as ExpressionSpecification)
  map.setLayoutProperty(
    'evac-location-entry-badge',
    'icon-image',
    ensureBadgeImage(map, 'EN', colorPair(EVAC_COLORS.entry, theme)),
  )
  map.setPaintProperty(
    'evac-location-entry-badge',
    'text-color',
    theme === 'light' ? '#1e293b' : '#e2e8f0',
  )
  map.setPaintProperty(
    'evac-location-entry-badge',
    'text-halo-color',
    theme === 'light' ? '#ffffff' : '#0b0f19',
  )
}
