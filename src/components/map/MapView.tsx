'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import type { Feature, Point } from 'geojson'
import { clusterPoints } from '@/lib/poiClustering'
import {
  Map as MLMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type IControl,
  type LngLat,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// MapLibre v6 spins up an ES module Worker for vector-tile parsing, resolved
// via `new URL(..., import.meta.url)` against its own bundled chunk. Turbopack
// doesn't rewrite that reference correctly, so the worker 404s (Next serves
// its HTML error page instead of JS) and every vector tile silently fails to
// decode while the raster basemap keeps working fine since it needs no
// worker. Pointing at a statically-served copy in /public sidesteps bundler
// worker resolution entirely. Keep public/maplibre-gl-worker.mjs and
// public/maplibre-gl-shared.mjs in sync with the installed maplibre-gl
// version (they must stay in the same directory — the worker imports the
// shared module by relative path).
setWorkerUrl('/maplibre-gl-worker.mjs')
import {
  CLASS_GROUP_COLORS,
  ROAD_TYPE_COLORS,
  ROAD_TYPE_DASH,
  POINT_LAYER_COLORS,
  POINT_LAYER_LABELS,
  LINE_LAYER_COLORS,
  LINE_LAYER_LABELS,
  POLYGON_LAYER_COLORS,
  POLYGON_LAYER_LABELS,
  POI_SIGNAGE_CODES,
} from '@/lib/classColors'
import StatsPanel from '@/components/map/StatsPanel'
import SectorReportDrawer from '@/components/map/SectorReportDrawer'
import Panel from '@/components/map/Panel'
import {
  ChartBarIcon,
  ChevronDownIcon,
  CompassIcon,
  GridIcon,
  LayersIcon,
  MapPinIcon,
  ParcelIcon,
  RedoIcon,
  RoadIcon,
  RulerIcon,
  SearchIcon,
  TagIcon,
  UndoIcon,
  XIcon,
} from '@/components/map/icons'

type Sector = {
  sector_no: number
  name: string
  area_hac: number
  lng: number
  lat: number
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

const CENTER: [number, number] = [78.0995, 29.9396]
const INITIAL_ZOOM = 10

// Dark mode vendors CARTO's Dark Matter vector style into /public (rather
// than fetched from basemaps.cartocdn.com at runtime) -- their raster PNG
// tiles started requiring an API key, but the underlying vector tiles/style
// JSON these reference (tiles.basemaps.cartocdn.com, a different subdomain)
// are still open, and vendoring avoids depending on that staying true for an
// extra network hop on every map load.
//
// Light mode vendors MapTiler's "Bright" style instead of CARTO's own light
// styles (Positron, then Voyager) -- both CARTO options turned out too
// muted/pastel next to a reference "classic OSM Bright" look (solid green
// forests, blue water, orange/pink road hierarchy) that this app's light
// mode is meant to match. MapTiler's vector tiles/style/glyphs all require
// an API key unlike CARTO's, so the vendored copy below has its key
// templated out as the literal string "{key}" (see loadBasemapStyle, which
// substitutes NEXT_PUBLIC_MAPTILER_KEY back in at fetch time) rather than
// committing the real key to the repo.
//
// Both fetched once and merged into the map's own style (see
// loadBasemapStyle below) rather than used as a standalone map.setStyle(),
// since every sector/POI source and layer this component creates lives in
// the SAME style object -- swapping the whole style out from under them
// would delete them too.
const BASEMAP_STYLE_URL: Record<'light' | 'dark', string> = {
  light: '/maptiler-bright-style.json',
  dark: '/carto-dark-matter-style.json',
}

async function loadBasemapStyle(theme: 'light' | 'dark') {
  const res = await fetch(BASEMAP_STYLE_URL[theme])
  const text = await res.text()
  // Only the light (MapTiler) style has any "{key}" placeholders -- the dark
  // (CARTO) style's replaceAll is a harmless no-op since it never contains
  // the token.
  const withKey = text.replaceAll('{key}', process.env.NEXT_PUBLIC_MAPTILER_KEY ?? '')
  return JSON.parse(withKey) as {
    sprite?: string
    sources: Record<string, unknown>
    layers: unknown[]
  }
}

function readMapTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

// Fixed emphasis color for the active class/sub-class filter's glow+outline
// (sector-plan-filter-glow/-outline below) -- deliberately NOT any class's
// own color, since several classes are themselves greys/neutrals that
// nearly vanish against the dimmed basemap those layers render over. Warm
// gold reads clearly against both the light and dark dimmed basemap and
// doesn't collide with the map's other fixed accent colors (blue = general
// UI accent, violet = selected-sector outline, red = measure tool).
const FILTER_EMPHASIS_COLOR = '#f59e0b'

// Zoom level above which POI cluster circles show their point-count number
// (see poi-{key}-cluster-count below) -- at wide zooms, many small clusters
// packed close together turned overlapping 2-3 digit labels into unreadable
// text soup, so the bare circle alone carries "there's a cluster here" until
// there's enough screen room for the number to actually help. Matches
// clusterPoints' own zoom-driven grid (src/lib/poiClustering.ts): higher
// zoom naturally means fewer, more spread-out clusters.
const CLUSTER_LABEL_MIN_ZOOM = 13

// Sector hover/selection colors, theme-aware -- the light-mode values are
// the original muted slate/violet/near-black tones, which read fine against
// a pale basemap but nearly vanished against the near-black CARTO Dark
// Matter basemap the dark theme now uses. Dark mode instead gets a glowing
// electric cyan (hover) and warm orange-gold (selected) -- distinct from
// FILTER_EMPHASIS_COLOR's amber above so an active class filter and a
// selected sector stay visually distinguishable when both are true at once,
// and close to the reference "glowing points on black" look this was tuned
// against. Applied at layer creation (initMap) and re-applied by the
// basemap theme-swap effect below, since these are plain static paint
// values, not CSS var()s the map's popups/controls already follow for free.
const SECTOR_COLORS = {
  light: { hover: '#475569', selected: '#7c3aed', boundary: '#111827' },
  // boundary went through two dark-mode attempts before this one: #3f4759
  // (close to the basemap's own dark grays) blended into the CARTO Dark
  // Matter basemap's road lines almost completely, and the next try,
  // #94a3b8, was a real improvement in brightness but still landed in the
  // same grey-blue family as those roads -- close enough in hue that the
  // sector boundary (the primary navigation shape) and the ordinary street
  // grid still read as "the same kind of line" at a glance, just one lighter
  // than the other. A near-white blue with no grey in it at all reads as
  // categorically different at any zoom, rather than merely brighter.
  dark: { hover: '#22d3ee', selected: '#fb923c', boundary: '#c7d6f5' },
} as const

// Sector boundary line width, theme-aware -- light mode's basemap has dark,
// fairly heavy road strokes already, so a thin 1px boundary still stands out
// by contrast alone. Dark mode's near-black basemap has much thinner, fainter
// road lines, so the boundary gets a bit more width on top of its distinct
// color (SECTOR_COLORS.dark.boundary) for extra presence as the primary
// navigation shape.
const SECTOR_BOUNDARY_WIDTH = { light: 1, dark: 1.5 } as const

// The base street network (kumbh.tertiary_road, see PLAN-deferred-roads.md) is
// the only POI line layer dense enough (21k+ features) to need a per-theme
// treatment -- every other POI line colour is shared across both themes
// unchanged (see the note above POLYGON_LAYER_COLORS in classColors.ts),
// which is fine when there are only a handful of features on screen. A first
// pass used a near-neutral grey here specifically so it wouldn't compete with
// the project road network -- but that made it read as invisible rather than
// "quiet" against both basemaps. Google Maps' own road blue is the deliberate
// fix: bright enough to actually see the street network at a glance, while
// staying a clearly different hue from the red/orange project road palette
// (ROAD_TYPE_COLORS) so nothing is ambiguous about which is which.
//
// casingColor is the pale/white border drawn by poi-tertiary_road-casing
// underneath the solid core -- that light-edge/dark-center pairing (not just
// a single thick stroke) is what actually reads as Google's bold
// "3D route ribbon" look rather than a flat thick line. Light mode's casing
// is white (reads as a clean border against Positron/Bright's pale ground);
// dark mode's is a deep navy rather than white, since a white casing against
// Dark Matter's near-black ground would blow out and look like a glow, not
// a border.
//
// `colors` is a three-tier ramp keyed the same way as the width tiers below.
// Width alone turned out not to be enough separation at this density: with
// one flat blue across all 21k+ segments, a whole-city view reads as a single
// uniform mesh where the arterial structure is technically thicker but not
// actually findable, because every lane is shouting just as loudly. Tiering
// the colour as well as the width is what makes the arterial skeleton pop out
// of the residential texture. Each theme moves in the direction that gains
// contrast against *its* ground: on dark, highways go brighter and more luminous
// and lanes drop to a dim muted blue; on light, highways go darker and more
// saturated while lanes wash out pale. `main` keeps the exact previous flat
// colour in both themes, so the mid tier looks unchanged and only the two
// extremes move apart.
const TERTIARY_ROAD_STYLE = {
  light: {
    opacity: 0.9,
    colors: { highway: '#1967d2', main: '#4285f4', lane: '#8fb4f0' },
    casingColor: '#ffffff',
  },
  dark: {
    opacity: 0.95,
    colors: { highway: '#8fbfff', main: '#6ea8fe', lane: '#4a6da5' },
    casingColor: '#1a2b4a',
  },
} as const

// Per-tier colour as a MapLibre expression, built per theme. Mirrors the
// fclass tiering of TERTIARY_ROAD_CORE_WIDTH below, so a given segment's
// colour and thickness always agree about which tier it is in.
function tertiaryRoadColorExpr(theme: 'light' | 'dark'): ExpressionSpecification {
  const { highway, main, lane } = TERTIARY_ROAD_STYLE[theme].colors
  return [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    highway,
    TERTIARY_ROAD_MAIN_FCLASSES,
    main,
    lane,
  ] as unknown as ExpressionSpecification
}

// tertiary_road's `fclass` (standard OSM road classification, see
// Pending.md) groups into the same three-tier hierarchy real road atlases
// use -- highway, main road, local lane -- so width should follow it instead
// of every one of the 21k+ segments drawing at one flat thickness. Tiers
// mirror the tiles route's own arterial/everything-else split
// (src/app/api/tiles/[layer]/[z]/[x]/[y]/route.ts) plus a highway/main split
// within "arterial": trunk/primary read as highways, secondary/tertiary as
// ordinary main roads, everything else (residential/service/track/path/...)
// as a lane. `_link` variants (on-/off-ramps, connectors) follow their
// parent class.
const TERTIARY_ROAD_HIGHWAY_FCLASSES = ['trunk', 'primary', 'trunk_link', 'primary_link']
const TERTIARY_ROAD_MAIN_FCLASSES = ['secondary', 'tertiary', 'secondary_link', 'tertiary_link']

// Core stroke width per tier at each zoom stop -- main-road values are
// unchanged from the old flat width (so the common case looks the same as
// before), highway is ~1.4x thicker and lane ~0.55x thinner at every stop.
const TERTIARY_ROAD_CORE_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  6,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    3,
    TERTIARY_ROAD_MAIN_FCLASSES,
    2,
    1.2,
  ],
  10,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    5,
    TERTIARY_ROAD_MAIN_FCLASSES,
    3.5,
    2,
  ],
  14,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    7,
    TERTIARY_ROAD_MAIN_FCLASSES,
    5,
    3,
  ],
  16,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    10,
    TERTIARY_ROAD_MAIN_FCLASSES,
    7,
    4,
  ],
  18,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    14,
    TERTIARY_ROAD_MAIN_FCLASSES,
    10,
    6,
  ],
] as unknown as ExpressionSpecification

// Casing stays a fixed margin wider than the core at each zoom (2/3/4/5/6px,
// same margins the old flat casing used) regardless of tier, so the pale
// border reads as a consistent edge thickness whether it's wrapping a
// highway or a lane -- not a halo that scales independently of the core.
const TERTIARY_ROAD_CASING_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  6,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    5,
    TERTIARY_ROAD_MAIN_FCLASSES,
    4,
    3.2,
  ],
  10,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    8,
    TERTIARY_ROAD_MAIN_FCLASSES,
    6.5,
    5,
  ],
  14,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    11,
    TERTIARY_ROAD_MAIN_FCLASSES,
    9,
    7,
  ],
  16,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    15,
    TERTIARY_ROAD_MAIN_FCLASSES,
    12,
    9,
  ],
  18,
  [
    'match',
    ['get', 'fclass'],
    TERTIARY_ROAD_HIGHWAY_FCLASSES,
    20,
    TERTIARY_ROAD_MAIN_FCLASSES,
    16,
    12,
  ],
] as unknown as ExpressionSpecification

// Dark-mode-only fill palette for sector-plan-fill, keyed the same as
// CLASS_GROUP_COLORS (src/lib/classColors.ts) -- CLASS_GROUP_COLORS itself
// stays untouched since it's shared by every UI swatch (legend dots, chips,
// the Stats panel) where the light-mode hues already read fine against dark
// UI chrome. A first attempt at this palette desaturated/darkened every hue
// (aiming to tame the "clashing sticker sheet" the raw light colors made as
// large fills), but that overcorrected into a muddy, everything-looks-brown
// mess that lost the whole point of per-class color-coding -- the fix isn't
// less saturation, it's a *different* kind of vividness: the same "glowing
// color on black" quality already tuned for SECTOR_COLORS.dark (electric
// cyan/orange) rather than pastel light-mode hues. Each entry keeps its
// CLASS_GROUP_COLORS hue family but pushed to a brighter, more saturated,
// slightly luminous version -- distinct and energetic against black instead
// of flat and washed out.
//
// Same three-tier importance structure as CLASS_GROUP_COLORS (see that
// file's comment for the full rationale) -- Tier 1 gets the most "glow",
// Tier 2 a visibly quieter version of its own hue, Tier 3 stays a cool
// slate that's readable but recedes, with Green Area/Waterbody keeping a
// faint hue for orientation and Parking split out from plain terrain grey
// since it's the single largest class on the map by area.
const CLASS_GROUP_COLORS_DARK: Record<string, string> = {
  // Tier 1 -- operationally critical
  'Health Camping': '#ff6b6b',
  'Religious Camping': '#ff9d4d',
  'Police Camping': '#4f8dff',
  'Administrative Camping': '#2dd4a8',
  Commercial: '#ff5fa8',
  Amenities: '#ffc247',
  'Reserved Area': '#b794ff',

  // Tier 2 -- secondary, muted but distinct
  Sanitation: '#3dd9c4',
  Transport: '#a79bf0',
  Utilities: '#ffd166',
  'Media Camping': '#f472e0',
  'Other Camping': '#ffb37a',
  Recreation: '#9ae05a',
  Education: '#3fd0e8',
  Warehouses: '#d4a24c',
  'Existing Development': '#38c6ff',

  // Tier 3 -- terrain/context, near-neutral
  Parking: '#8794b3',
  Road: '#9aa2b1',
  Pathway: '#9aa2b1',
  'Open Area': '#9aa2b1',
  'Low Lying Area': '#9aa2b1',
  'Hold-up Area': '#9aa2b1',
  'Unavailable Land': '#9aa2b1',
  Ghat: '#9aa2b1',
  'Green Area': '#6fa889',
  Waterbody: '#5f93b8',

  Other: '#8a93a6',
}

// Fill/outline treatment for sector-plan-fill, theme-aware.
//
// Earlier versions painted parcels as near-solid colour (0.65-0.75 opacity)
// plus a same-hue `fill-outline-color`. At city-wide zooms that turned whole
// sectors into flat blobs of one hue -- hundreds of adjacent parcels each
// contributing a saturated fill *and* a saturated 1px edge, so the basemap's
// road network vanished underneath and the 11-colour palette read as noise
// rather than as categories.
//
// The fix separates the two jobs colour was doing. The *fill* becomes a faint
// wash that only says "something is here", and all the class identity moves
// into a dedicated `line` layer (sector-plan-class-outline) which -- unlike
// `fill-outline-color`, whose whole limitation is that it can't be given a
// width, an opacity or a zoom curve -- can be a crisp, controllable hairline.
// That's what makes each parcel read as a distinct shape instead of merging
// into its neighbours.
//
// Both are zoom-interpolated: at city-wide zooms you're reading *where* the
// classes are (so the wash stays very light and the hairline very thin), and
// by parcel-reading zooms both strengthen to where an individual polygon's
// class is unambiguous. Light mode carries slightly more of everything since
// a pale basemap gives a light wash much less to contrast against.
//
// No hover boost here: MapLibre only allows a `zoom` expression as the
// entire top-level paint value, not nested inside a `case` -- and no code
// actually calls setFeatureState('hover', ...) on sector_plan features
// anyway (that only happens for whole sectors, via sector-hover-fill/-glow),
// so there was never a real hover state for these two to react to.
// Cast the same way matchExpr does below: these are plain runtime arrays
// (MapLibre expressions), but its ExpressionSpecification union is built
// from exact-length mutable tuples that TS can't infer a literal array into.
const SECTOR_FILL_OPACITY: { light: ExpressionSpecification; dark: ExpressionSpecification } = {
  light: [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    0.16,
    15,
    0.4,
  ] as unknown as ExpressionSpecification,
  dark: [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    0.1,
    15,
    0.3,
  ] as unknown as ExpressionSpecification,
}

// Per-parcel class hairline. Widths stay sub-pixel at the low end on purpose:
// MapLibre antialiases them into a faint thread rather than dropping them, so
// dense sectors keep their internal structure legible instead of silting up
// into one solid mass of edges.
const SECTOR_OUTLINE_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  0.4,
  14,
  0.8,
  17,
  1.4,
] as unknown as ExpressionSpecification
const SECTOR_OUTLINE_OPACITY = { light: 0.7, dark: 0.85 } as const

// Same wash + hairline split as sector-plan-fill/-class-outline above,
// applied to the area-shaped POI layers (ashram, tentcity, ropeway_area,
// etc. -- see byGeomType('polygon') below). Unlike sector-plan-fill these
// don't have a separate dark-mode palette (POI colours are already the same
// in both themes), so opacity stays a single value rather than a light/dark
// pair.
const POI_POLYGON_FILL_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  0.14,
  15,
  0.32,
] as unknown as ExpressionSpecification
const POI_POLYGON_OUTLINE_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  11,
  0.5,
  14,
  0.9,
  17,
  1.5,
] as unknown as ExpressionSpecification
const POI_POLYGON_OUTLINE_OPACITY = 0.8

// `name` comes from PostGIS as "BAHADRABAD-01" (title-then-number) -- strip
// that trailing "-NN" and lead with the zero-padded sector_no instead, since
// sector_no is the authoritative number regardless of how the name is spelled.
function formatSectorLabel(sector: Pick<Sector, 'sector_no' | 'name'>): string {
  const title = sector.name.replace(/-\d+$/, '')
  return `${String(sector.sector_no).padStart(2, '0')}. ${title}`
}

const EARTH_RADIUS_M = 6371000

// Great-circle distance between two [lng, lat] points, in metres.
function haversineDistanceM(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`
}

// Small solid dot + white ring + soft halo, replacing MapLibre's default
// pin-shaped Marker (which reads as a generic "dropped location" pin) for
// measure-mode points -- this is meant to feel like a precise survey point,
// not a place marker.
function makeMeasurePointElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.width = '14px'
  el.style.height = '14px'
  el.style.borderRadius = '999px'
  el.style.background = '#e11d48'
  el.style.border = '2px solid #fff'
  el.style.boxShadow = '0 0 0 3px rgba(225,29,72,0.25), 0 1px 3px rgba(0,0,0,0.3)'
  return el
}

function matchExpr(
  field: string,
  colors: Record<string, string>,
  fallback: string,
): ExpressionSpecification {
  const pairs = Object.entries(colors).flat()
  return ['match', ['get', field], ...pairs, fallback] as unknown as ExpressionSpecification
}

// One shared badge image per (text, colour) pair, registered with
// map.addImage and placed via plain icon-image -- pre-baking the pill
// background AND the text into one raster (rather than a stretched pill
// image plus a separate text-field layer sized by icon-text-fit) gives
// exact, predictable pixel dimensions matching the compact badge used in
// the Layers/Stats panels, instead of fighting icon-text-fit's padding math.
function badgeIconId(text: string, color: string) {
  return `poi-badge-${text}-${color.replace('#', '')}`
}

// Rendered at 4x and downscaled via addImage's pixelRatio so the small
// badge stays crisp. Sizing mirrors the panel badge: ~14px tall, ~3px
// corner radius, minimal horizontal padding around the text.
function makeBadgeIcon(text: string, color: string): ImageData {
  const scale = 4
  const height = 14 * scale
  const paddingX = 4 * scale
  const radius = 3 * scale
  const fontSize = 9 * scale

  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `700 ${fontSize}px "Noto Sans", sans-serif`
  const textWidth = measure.measureText(text).width
  const width = Math.ceil(textWidth + paddingX * 2)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(radius, 0)
  ctx.arcTo(width, 0, width, height, radius)
  ctx.arcTo(width, height, 0, height, radius)
  ctx.arcTo(0, height, 0, 0, radius)
  ctx.arcTo(0, 0, width, 0, radius)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${fontSize}px "Noto Sans", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, width / 2, height / 2 + 1)

  return ctx.getImageData(0, 0, width, height)
}

// A native MapLibre control (rather than an absolutely-positioned React
// button) so it stacks in the bottom-right corner alongside the zoom/compass/
// attribution controls using MapLibre's own layout instead of a guessed
// pixel offset -- the guessed offset drifted out of sync and overlapped the
// zoom "+" button as soon as the control stack's real height changed.
class PitchToggleControl implements IControl {
  private map?: MLMap
  private button?: HTMLButtonElement

  private syncPressed = () => {
    const map = this.map
    const button = this.button
    if (!map || !button) return
    const active = map.getPitch() > 5
    button.setAttribute('aria-pressed', String(active))
    // var() references resolve live against the document's current --map-* custom properties
    // (set on <html> by the theme toggle), so this button follows theme changes without needing
    // its own change listener.
    button.style.background = active ? 'var(--map-accent)' : 'var(--map-surface)'
    button.style.color = active ? '#fff' : 'var(--map-fg-muted)'
  }

  onAdd(map: MLMap) {
    this.map = map
    const container = document.createElement('div')
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group'

    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', 'Toggle 3D view')
    button.title = 'Toggle 3D view'
    // The base .maplibregl-ctrl-group button rule is a 29x29 icon slot
    // (display:block, transparent background, no text centering) meant for
    // a background-image glyph -- explicit flex centering + colors here so
    // plain "3D" text renders visibly instead of collapsing/blending in.
    Object.assign(button.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '11px',
      fontWeight: '700',
      fontFamily: 'inherit',
      lineHeight: '1',
      background: 'var(--map-surface)',
      color: 'var(--map-fg-muted)',
    })
    button.textContent = '3D'
    button.onclick = () => {
      const next = map.getPitch() < 5
      map.easeTo({ pitch: next ? 55 : 0, bearing: next ? -20 : 0, duration: 600 })
    }
    this.button = button

    map.on('pitchend', this.syncPressed)
    this.syncPressed()

    container.appendChild(button)
    return container
  }

  onRemove() {
    this.map?.off('pitchend', this.syncPressed)
    this.button?.remove()
    this.map = undefined
  }
}

type PoiGeomType = 'point' | 'line' | 'polygon'

type PoiLayerDef = {
  key: string
  label: string
  color: string
  geomType: PoiGeomType
  /** True for layers sourced from raw third-party OSM data rather than the curated
   *  Kumbh Mela gdb (currently just tertiary_road) -- drives the small "OSM" sub-header
   *  in the POI layers panel list, see the render loop below. */
  isThirdPartyOsm?: boolean
}

// Single source of truth for the 16 POI layers: drives sources/layers on the
// map, the LAYERS panel toggles, and stays in sync with StatsPanel's legend
// since all three read the same POINT_/LINE_/POLYGON_LAYER_* maps.
const POI_LAYER_DEFS: PoiLayerDef[] = [
  ...Object.keys(POINT_LAYER_COLORS).map((key) => ({
    key,
    label: POINT_LAYER_LABELS[key] ?? key,
    color: POINT_LAYER_COLORS[key],
    geomType: 'point' as const,
  })),
  ...Object.keys(LINE_LAYER_COLORS).map((key) => ({
    key,
    label: LINE_LAYER_LABELS[key] ?? key,
    color: LINE_LAYER_COLORS[key],
    geomType: 'line' as const,
    isThirdPartyOsm: key === 'tertiary_road',
  })),
  ...Object.keys(POLYGON_LAYER_COLORS).map((key) => ({
    key,
    label: POLYGON_LAYER_LABELS[key] ?? key,
    color: POLYGON_LAYER_COLORS[key],
    geomType: 'polygon' as const,
  })),
]

// Every vector/geojson source id this component itself creates in the 'load'
// handler (initMap) and never swaps out -- used by the basemap theme-swap
// effect below to tell "one of our own sources" apart from "a source
// belonging to whichever vendored basemap style is currently loaded" without
// hardcoding that basemap's source id (light and dark now vendor different
// providers with different source ids -- MapTiler's 'maptiler_planet' vs
// CARTO's 'carto' -- so there's no single fixed BASEMAP_SOURCE_ID any more).
const APP_SOURCE_IDS = new Set([
  'sector_plan',
  'road',
  'sector_boundary',
  'measure-line',
  'measure-label',
  'measure-preview',
  'measure-preview-label',
  ...POI_LAYER_DEFS.map((d) => d.key),
])

// Client-side mirror of POI_SUBCLASS_TABLES in src/app/api/stats/route.ts --
// which vector-tile property name each subclass-bearing POI layer's
// subclass lives under (ashram spells it sub_class). Every other POI layer
// has no such column and stays a flat single-row layer with no chevron, same
// "no shared whitelist across route files" convention the tiles/locate
// routes already use for their own LAYERS maps.
const POI_SUBCLASS_COLUMNS: Record<string, string> = {
  amenities: 'subclass',
  ashram: 'sub_class',
  public_service_facilities: 'subclass',
  sanitation: 'subclass',
  tentcity: 'subclass',
  parking: 'subclass',
  sector_point: 'subclass',
}

/** Stable identity for one open locator list, so several can be tracked at
 *  once in a keyed map. The `||` separator can't occur in a class or
 *  sub-class name, so it never collides with a legitimate value. */
function locateKey(group: string, subclass: string | null, sector?: number | null): string {
  // The sector is part of the identity, not just the query: locate results are
  // cached by this key and deliberately never pruned, so without it a list
  // fetched while Sector 07 was selected would be replayed unchanged after
  // switching to Sector 11 -- showing the wrong sector's features under the
  // new sector's heading.
  return `${group}||${subclass ?? ''}||${sector ?? ''}`
}

type LocateResultData = {
  classGroup: string
  subclass: string | null
  total: number
  bbox: [number, number, number, number] | null
  features: {
    id: number
    sector_no: number | null
    plot_no: string | null
    block: string | null
    label: string | null
    lng: number
    lat: number
  }[]
}

type PoiLocateResultData = {
  layer: string
  subclass: string | null
  total: number
  bbox: [number, number, number, number] | null
  features: {
    id: number
    label: string | null
    /** Spatially derived (POI tables have no sector column) -- null for a
     *  feature outside every sector boundary. */
    sector_no: number | null
    lng: number
    lat: number
  }[]
}

type RoadTypeDef = {
  key: string
  /** The `type` value as stored in the road table/StatsPanel rows. */
  type: string
  label: string
  color: string
  dash?: [number, number]
}

// The 3 road types (Proposed/Existing/Emergency) used to be one "Roads"
// on/off toggle covering the whole road-line layer. Now each gets its own
// visibility key like a POI layer, so road-line's own filter (not layout
// visibility) has to express "which types are currently on" -- see
// roadTypeFilter in the sector/class filter effect below.
const ROAD_TYPE_DEFS: RoadTypeDef[] = Object.keys(ROAD_TYPE_COLORS).map((type) => ({
  key: `road_${type.toLowerCase().replace(/\s+/g, '_')}`,
  type,
  label: type,
  color: ROAD_TYPE_COLORS[type],
  dash: ROAD_TYPE_DASH[type],
}))

// Tracks the most recently issued /api/poi/points/[layer] request per
// clustered POI layer, keyed by layer key -- see refetchClusteredPoiSource
// below. A plain module-level object (not component state/ref) is fine
// here: it's pure "which fetch is latest" bookkeeping with no rendering
// implications, shared across every MapView instance the same way the map
// itself is a singleton per mount.
const poiSourceFetchTokens: Record<string, number> = {}

// Re-queries a clustered POI point layer's full GeoJSON, scoped to the given
// sub-classes (or unscoped, when subs is empty/undefined), re-clusters it
// (see clusterPoints in src/lib/poiClustering.ts) and swaps the result into
// the already-created 'geojson' source via setData() -- see the
// poiSubclassFilter effect above for why the raw fetch is filtered
// server-side instead of with a style `filter`: a style filter can't affect
// which points get clustered together in the first place, only which
// already-computed features get hidden afterward. Also updates
// rawFeaturesRef so the next zoom-driven re-cluster (syncPoiClusters, in
// initMap) keeps using the filtered dataset rather than snapping back to
// the unfiltered one on the next zoom change. A monotonic per-layer token
// discards a stale response that resolves after a newer request for the
// same layer has already been issued (e.g. rapidly toggling sub-class
// checkboxes), so an in-flight request never clobbers a later selection's
// result.
async function refetchClusteredPoiSource(
  map: MLMap,
  layerKey: string,
  subs: string[] | undefined,
  rawFeaturesRef: React.RefObject<Record<string, Feature<Point>[]>>,
) {
  const source = map.getSource(layerKey) as GeoJSONSource | undefined
  if (!source) return

  const token = (poiSourceFetchTokens[layerKey] ?? 0) + 1
  poiSourceFetchTokens[layerKey] = token

  const params = new URLSearchParams()
  for (const sub of subs ?? []) params.append('subclass', sub)
  const url = params.toString()
    ? `${location.origin}/api/poi/points/${layerKey}?${params}`
    : `${location.origin}/api/poi/points/${layerKey}`

  try {
    const res = await fetch(url)
    const data: { features: Feature<Point>[] } = await res.json()
    if (poiSourceFetchTokens[layerKey] !== token) return // superseded by a newer request
    rawFeaturesRef.current[layerKey] = data.features
    source.setData(clusterPoints(data.features, map.getZoom()))
  } catch {
    // Network hiccup -- leave the source showing its last-known data rather
    // than clearing it out from under the user.
  }
}

// Shared by both the initial layer-creation sync (so POI layers default to
// hidden with no flash of visible-then-hidden) and the visibility-toggle
// effect below, so the id/visibility-key mapping only lives in one place.
function applyLayerVisibility(map: MLMap, visibility: Record<string, boolean>) {
  ;(
    [
      ['sector-plan-fill', visibility.sector_plan],
      ['sector-plan-class-outline', visibility.sector_plan],
      ['sector-plan-peripheral-outline', visibility.sector_plan],
      // Visible if at least one road type is toggled on -- road-line is one
      // shared layer for all 3 types, so which specific types actually draw
      // is handled by its `filter` (see the sector/class filter effect),
      // not by this layout visibility.
      ['road-line', ROAD_TYPE_DEFS.some((d) => visibility[d.key])],
      ['sector-boundary-line', visibility.sector_boundary],
      ['sector-hover-fill', visibility.sector_boundary],
      ['sector-hover-glow', visibility.sector_boundary],
      ['sector-hover-outline', visibility.sector_boundary],
      ['sector-selected-outline', visibility.sector_boundary],
      // Dark-mode-only halo (see where it's created, in initMap) -- gated on
      // theme too so this doesn't fight the theme-swap effect's own
      // visibility toggle by turning the glow back on in light mode whenever
      // sector_boundary's checkbox changes.
      ['sector-selected-glow', visibility.sector_boundary && readMapTheme() === 'dark'],
      ...POI_LAYER_DEFS.flatMap(
        (d) =>
          [
            [`poi-${d.key}`, visibility[d.key]],
            [`poi-${d.key}-outline`, visibility[d.key]],
            [`poi-${d.key}-glow`, visibility[d.key]],
            // tertiary_road's pale/navy border layer (see TERTIARY_ROAD_STYLE) --
            // every other layer key has no -casing layer, so this is a no-op
            // for them via the map.getLayer guard below.
            [`poi-${d.key}-casing`, visibility[d.key]],
            [`poi-${d.key}-hit`, visibility[d.key]],
            [`poi-${d.key}-label`, visibility[d.key]],
            [`poi-${d.key}-cluster`, visibility[d.key]],
            [`poi-${d.key}-cluster-count`, visibility[d.key]],
          ] as [string, boolean][],
      ),
    ] as const
  ).forEach(([id, visible]) => {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  })
}

type InitialParcel = {
  sectorPlanId: number
  lng: number
  lat: number
  sectorNo: number | null
}

const VISIBILITY_STORAGE_KEY = 'tcsticket:mapView:visibility'

function defaultVisibility(): Record<string, boolean> {
  return {
    sector_plan: true,
    sector_boundary: true,
    ...Object.fromEntries(ROAD_TYPE_DEFS.map((d) => [d.key, false])),
    ...Object.fromEntries(POI_LAYER_DEFS.map((d) => [d.key, false])),
  }
}

// Merged over the defaults (rather than used as-is) so a layer key added to
// ROAD_TYPE_DEFS/POI_LAYER_DEFS after a user's last visit still gets a sane
// default instead of being missing/undefined.
function loadStoredVisibility(): Record<string, boolean> {
  const defaults = defaultVisibility()
  try {
    const raw = localStorage.getItem(VISIBILITY_STORAGE_KEY)
    if (!raw) return defaults
    const stored = JSON.parse(raw)
    if (!stored || typeof stored !== 'object') return defaults
    return { ...defaults, ...stored }
  } catch {
    return defaults
  }
}

export default function MapView({
  initialParcel = null,
}: {
  /** Set when arriving from a ticket's "View on map" link — flies straight to that parcel
   *  instead of the default Haridwar-wide view, and pre-selects its sector. */
  initialParcel?: InitialParcel | null
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const hoveredSectorRef = useRef<number | null>(null)
  /** sectorPlanId of the parcel the currently-open popup belongs to — lets the async ticket
   *  lookup discard its result if the user has since clicked a different parcel (or closed it). */
  const popupParcelIdRef = useRef<number | null>(null)
  /** Mirrors `measuring` state inside the map's one-time 'load' click handler, which closes
   *  over stale state otherwise (that effect runs once on mount, not on every re-render). */
  const measuringRef = useRef(false)
  const measurePointsRef = useRef<[number, number][]>([])
  const measureMarkersRef = useRef<Marker[]>([])
  /** Mirrors `selectedSector` state for the same reason as measuringRef -- read by the
   *  once-registered 'contextmenu' handler to right-click-deselect the current sector. */
  const selectedSectorRef = useRef<number | 'all'>('all')
  /** Live on-screen width of the right-docked Stats panel (0 while
   *  collapsed), reported by Panel.tsx -- read by every fitBounds/flyTo
   *  call below so the map centers results in the space actually left of
   *  the panel instead of flying results half-hidden behind it. A ref
   *  (not state) since this only feeds imperative map calls and shouldn't
   *  itself trigger a re-render on every resize-drag frame. */
  const statsPanelWidthRef = useRef(0)
  /** Set by initMap once the map is actually created (which now happens asynchronously, after
   *  the vendored basemap style JSON fetch resolves -- see the mount effect below) -- the effect's
   *  own cleanup can't just close over `map`/`marker` directly the way it used to when map
   *  creation was synchronous within the same effect body. */
  const mapCleanupRef = useRef<(() => void) | null>(null)
  /** Guards the one-time initial fitBounds-to-all-sectors effect below so it
   *  never re-fires (e.g. if `sectors` happens to refetch) and yanks the
   *  camera away from wherever the user has since panned/selected. */
  const initialFitDoneRef = useRef(false)
  /** Raw (unclustered) point features per clustered POI layer key, fetched once from
   *  /api/poi/points/[layer] -- re-clustered client-side (see syncPoiClusters in initMap)
   *  whenever the map's zoom changes, since MapView does its own capped clustering instead of
   *  relying on MapLibre's built-in cluster:true (see the point-source comment in initMap for why). */
  const poiRawFeaturesRef = useRef<Record<string, Feature<Point>[]>>({})

  // Right-panel-aware padding for fitBounds/flyTo -- same left-side
  // constant as before (accounts for the fixed-width "Kumbh Mela" panel,
  // ~w-72 + its offset), but the right side now reads the Stats panel's
  // actual live width (0 when collapsed) instead of a guessed constant, so
  // results center in whatever space is really free of both docked panels.
  function mapFlyPadding() {
    return {
      top: 60,
      bottom: 60,
      left: 340,
      // +24 accounts for the panel's own right-3 (12px) edge offset plus a
      // little breathing room, same idea as the left panel's constant.
      right: statsPanelWidthRef.current > 0 ? statsPanelWidthRef.current + 24 : 60,
    }
  }

  const [sectors, setSectors] = useState<Sector[]>([])
  // Sub-class names + counts per class_group, for the left panel's search
  // tree -- fetched independently of StatsPanel's own /api/stats call (same
  // self-fetching pattern as `sectors` above) rather than threading it down.
  // Re-fetched whenever selectedSector changes so counts here match the
  // Stats panel's own sector-scoped numbers instead of always showing every
  // sector's total.
  const [subclassStats, setSubclassStats] = useState<
    // subclass can be null -- see the comment where it's read in the search panel below for why.
    { class_group: string; subclass: string | null; features: number }[]
  >([])
  // Same idea as subclassStats but for POI layers that have a subclass-like
  // column (see POI_SUBCLASS_COLUMNS) -- populated from the same /api/stats
  // response's poiBySubclass field, not a separate fetch.
  const [poiSubclassStats, setPoiSubclassStats] = useState<
    { layer: string; subclass: string; features: number }[]
  >([])
  // Which class/sub-class to fetch bbox/feature centroids for -- set
  // explicitly by clicking a row's "show list" chevron in the Stats panel's
  // Area-by-class table. Deliberately independent of classFilter/
  // subclassFilter (the multi-select checkboxes): a class or sub-class can
  // be selected without its list open, or its list opened without changing
  // the selection, so a class with several sub-classes checked can still
  // have any one of their lists shown on demand.
  // Several rows can have their list open at once (keyed by locateKey below),
  // so comparing two classes side by side doesn't make the first one close.
  const [locateTargets, setLocateTargets] = useState<
    { classGroup: string; subclass: string | null }[]
  >([])
  // Bounding box + per-feature centroids per open row, keyed by locateKey --
  // powers both the map's zoom-to-fit and the Stats panel's locator lists.
  // A key present with `null` means "fetch still in flight" (drives the
  // row's spinner); a key absent means that row's list is closed.
  // `'error'` marks a locate that failed -- distinct from a missing key,
  // which the panel renders as "still loading".
  const [locateResults, setLocateResults] = useState<
    Record<string, LocateResultData | 'error' | null>
  >({})
  // Which POI layer/sub-class to fetch bbox/feature centroids for -- set
  // explicitly by clicking a row's "show list" chevron in the Stats panel
  // (see togglePoiLocate), never by flipping a visibility/sub-class checkbox
  // alone, since several POI layers or sub-classes can be selected at once
  // and toggling one shouldn't yank the viewport out from under a list the
  // user already has open elsewhere.
  const [poiLocateTargets, setPoiLocateTargets] = useState<
    { layer: string; subclass: string | null }[]
  >([])
  const [poiLocateResults, setPoiLocateResults] = useState<
    Record<string, PoiLocateResultData | 'error' | null>
  >({})
  /** Bumped by a Retry click. The locate effects key off their targets, which
   *  a retry does not change (the row is already open), so without this the
   *  cleared error would never trigger a refetch. */
  const [locateRetryNonce, setLocateRetryNonce] = useState(0)
  /** Transient one-line notice over the map. Exists for the single case that
   *  otherwise gives the user nothing: a fly-to whose bbox comes back null,
   *  which sector scoping made reachable -- checking a class with no features
   *  in the selected sector used to tick the box and silently not move. */
  // Carries an id, not just the text: setting the identical string twice is a
  // no-op to React, so re-clicking the same empty class would leave the
  // dismissed notice hidden and the click would look dead all over again.
  const [mapNotice, setMapNotice] = useState<{ id: number; text: string } | null>(null)
  // Which locate keys already have a fetch started (or finished). A ref, not
  // state, so the fetch effects can consult and update it without calling
  // setState synchronously in the effect body.
  const locateFetchedRef = useRef<Set<string>>(new Set())
  const poiLocateFetchedRef = useRef<Set<string>>(new Set())
  const [selectedSector, setSelectedSector] = useState<number | 'all'>(
    initialParcel?.sectorNo ?? 'all',
  )
  // Initialized to the plain defaults (not loadStoredVisibility) so the first
  // client render matches what the server rendered -- localStorage doesn't
  // exist during SSR, and reading it in the initializer here would make the
  // client's first render (real stored value) diverge from the server's
  // (fallback), causing a hydration mismatch. The actual stored value is
  // applied post-mount below instead.
  const [visibility, setVisibility] = useState<Record<string, boolean>>(defaultVisibility)
  /** Mirrors `visibility` for the map's 'load' handler below, which now runs asynchronously
   *  (after the basemap style JSON fetch in the mount effect resolves) -- by the time it fires,
   *  the localStorage-restore mount effect has often already updated `visibility` state, but the
   *  'load' callback was created back when the mount effect first ran and would otherwise apply
   *  the stale initial (SSR-safe default) value instead, permanently showing e.g. "Sector plan"
   *  as off in the sidebar while the layer itself stays visible on the map. */
  const visibilityRef = useRef(visibility)
  useEffect(() => {
    visibilityRef.current = visibility
  }, [visibility])
  // Empty array means "all classes" -- multiple classes can be selected at
  // once, all rendering together on the map (same on/off model as
  // poiVisibility/roadTypeVisibility rather than a single active choice).
  const [classFilter, setClassFilter] = useState<string[]>([])
  // Sub-class selections for classes that are only *partially* checked --
  // a class fully checked into classFilter implies all its sub-classes, so
  // this only ever holds entries for classes not already in classFilter.
  // Keyed by class_group, value is the set of selected subclass strings.
  const [subclassFilter, setSubclassFilter] = useState<Record<string, string[]>>({})
  // Which classes have their sub-class list expanded in the left panel's
  // tree (UI-only, not persisted -- same per-item disclosure pattern as
  // collapsedGroups below, just per-class rather than per-group).
  const [expandedFilterClasses, setExpandedFilterClasses] = useState<Set<string>>(new Set())
  // Sub-class selections for POI layers that are only *partially* checked --
  // same partial-selection model as subclassFilter, but keyed by POI layer
  // key instead of class_group. A layer fully on via visibility[key] with no
  // entry here means "show every subclass"; an entry here means only those
  // subclasses render on the map. Only ever populated for the 4 layers in
  // POI_SUBCLASS_COLUMNS -- the other 12 layers have no subclass column, so
  // this stays empty for them and their on/off stays purely visibility[key].
  const [poiSubclassFilter, setPoiSubclassFilter] = useState<Record<string, string[]>>({})
  // Mirror of poiSubclassFilter read by the deferred (styledata) branch of the
  // filter effect below. That branch can run well after the click that
  // scheduled it, by which point a closed-over poiSubclassFilter is stale --
  // it would reapply the previous selection and silently undo the current one.
  const poiSubclassFilterRef = useRef(poiSubclassFilter)
  poiSubclassFilterRef.current = poiSubclassFilter
  // Which POI layers have their sub-class list expanded in the left panel's
  // tree -- mirrors expandedFilterClasses, same UI-only/not-persisted model.
  const [expandedFilterPois, setExpandedFilterPois] = useState<Set<string>>(new Set())
  // "Only inside sector area" narrowing for tertiary_road specifically -- not
  // a subclass filter (tertiary_road has no subclass column, so it's not in
  // POI_SUBCLASS_COLUMNS/poiSubclassFilter), just a plain boolean over the
  // in_sector flag set at load time (see PLAN-deferred-roads.md). UI-only
  // default state, not persisted -- resets to "show everything" each visit
  // like every other filter, only the on/off itself (visibility) persists.
  const [tertiaryRoadSectorOnly, setTertiaryRoadSectorOnly] = useState(false)
  // Single search query driving the unified sector/class/road/POI combobox
  // below (merges what used to be two separate `search`/`classSearch` text
  // states now that there's one input for all four taxonomies).
  const [query, setQuery] = useState('')
  const [panelDropdownOpen, setPanelDropdownOpen] = useState(false)
  /** Which docked panel ('search' | 'stats') was most recently expanded by the user -- read only
   *  to force-collapse the *other* one via Panel's forceCollapsed prop, and only takes effect on
   *  a phone-width viewport (see Panel.tsx: both panels go full-bleed width there when expanded,
   *  so two open at once would stack directly on top of each other). Harmless no-op at sm+,
   *  where the two panels dock side-by-side and coexist open as before. */
  const [expandedDockedPanel, setExpandedDockedPanel] = useState<'search' | 'stats' | null>(null)
  // Which browse-mode groups are collapsed when the query is empty (ignored
  // while typing, when every matching group is shown expanded). "Jump to
  // sector" starts collapsed since navigating to a sector is a different
  // kind of action than toggling a filter on -- not persisted, same as the
  // dropdown-open state it lives alongside.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(['Jump to sector']),
  )
  const [measuring, setMeasuring] = useState(false)
  /** Committed measurement points plus a redo stack. A single object (rather than two
   *  separate states) so undo/redo can move a point between the two atomically inside one
   *  functional updater -- safe to call from the once-registered map handlers below, and
   *  safe under StrictMode's double-invoke since the updaters are pure. */
  const [measure, setMeasure] = useState<{ points: [number, number][]; redo: [number, number][] }>({
    points: [],
    redo: [],
  })
  const searchDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!panelDropdownOpen) return
    function onPointerDown(e: PointerEvent) {
      if (!searchDropdownRef.current?.contains(e.target as Node)) setPanelDropdownOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [panelDropdownOpen])

  useEffect(() => {
    fetch('/api/sectors')
      .then((r) => r.json())
      .then(setSectors)
      .catch(() => {})
  }, [])

  // One-time initial fit to the real extent of every sector, once sector
  // data (with each one's xmin/ymin/xmax/ymax) has loaded. The map
  // constructor's own CENTER/INITIAL_ZOOM (see the jumpTo call in the mount
  // effect above) were a rough guess at the Haridwar-Rishikesh corridor's
  // midpoint that turned out to sit well southwest of the plan's actual
  // centroid -- Haridwar/Rishikesh/the sector chain along the Ganges rendered
  // bunched into the upper-right of the viewport no matter how mapFlyPadding
  // was tuned, because padding only repositions a *correct* center within
  // the free viewport, it can't fix a center that's wrong to begin with.
  // Computing the real union bbox from the sectors the map already fetches
  // (same xmin/ymin/xmax/ymax shape /api/sector-plan/locate uses for its own
  // fitBounds) and fitting to it is exact regardless of how the plan's
  // geographic footprint shifts as sectors are added/moved, unlike a
  // hand-picked constant that silently goes stale.
  //
  // Skipped when opening a specific ticket's parcel (initialParcel) -- that
  // case already has its own precise center from the mount effect's jumpTo,
  // and fitting to the whole plan would fight it. Runs at most once
  // (initialFitDoneRef) so it never re-fires and yanks the camera out from
  // under a user who has already panned/selected a sector by the time
  // sectors happens to reload.
  useEffect(() => {
    if (initialParcel || initialFitDoneRef.current || sectors.length === 0) return
    const map = mapRef.current
    if (!map) return
    initialFitDoneRef.current = true
    const xmin = Math.min(...sectors.map((s) => s.xmin))
    const ymin = Math.min(...sectors.map((s) => s.ymin))
    const xmax = Math.max(...sectors.map((s) => s.xmax))
    const ymax = Math.max(...sectors.map((s) => s.ymax))
    map.fitBounds(
      [
        [xmin, ymin],
        [xmax, ymax],
      ],
      { padding: mapFlyPadding(), duration: 0 },
    )
  }, [sectors, initialParcel])

  // Swaps the vendored CARTO basemap style when the app theme toggles --
  // watches <html data-theme> directly (rather than re-rendering on some
  // React theme state) since ThemeToggle.tsx writes the attribute
  // imperatively with no corresponding context/store this component could
  // subscribe to instead. Removes every layer/source belonging to the
  // previous basemap style and re-adds the other theme's, inserted below
  // every sector/POI layer -- cheaper and safer than a full map.setStyle(),
  // which would tear down (and require fully re-adding) every source/layer
  // this component creates in the 'load' handler below, since they live in
  // the SAME style object as the basemap.
  useEffect(() => {
    let cancelled = false
    // initMap loads the map's initial style from this same theme already
    // (see loadBasemapStyle(readMapTheme()) at map creation) -- seeded here,
    // at effect setup, from whatever theme is live *right now* (before any
    // toggle). Seeding it lazily inside the first syncBasemap() call instead
    // (as a previous version of this code did) is a bug: the MutationObserver
    // below only ever fires in response to a real data-theme mutation, so
    // that "first call" IS the user's first toggle, already carrying the NEW
    // theme -- seeding appliedTheme to it there makes the theme===appliedTheme
    // check below pass immediately and silently skip the map update, so the
    // very first toggle after every page load appeared to do nothing until a
    // full refresh (which re-mounts the map fresh with the correct theme).
    let appliedTheme: 'light' | 'dark' = readMapTheme()

    async function syncBasemap() {
      const map = mapRef.current
      const theme = readMapTheme()
      if (!map || !map.isStyleLoaded()) return
      if (theme === appliedTheme) return
      // Claim this theme before the await so a second MutationObserver
      // firing (e.g. React StrictMode's double-invoke, or two rapid toggles)
      // doesn't race in and load the same style twice.
      appliedTheme = theme

      const basemap = await loadBasemapStyle(theme)
      if (cancelled || mapRef.current !== map) return

      // Every layer currently in the style that belongs to the OLD basemap --
      // i.e. shares one of the OLD vendored style's own source ids, or is its
      // lone 'background' layer (which has no source at all) -- rather than a
      // fixed id list, since that's exactly the set map.setStyle() would
      // otherwise replace. Source ids aren't assumed to match between themes
      // any more (light now vendors MapTiler's 'maptiler_planet' source while
      // dark still vendors CARTO's 'carto' source), so this reads the actual
      // set of non-app sources currently on the map instead of one hardcoded
      // BASEMAP_SOURCE_ID -- "non-app" meaning every source id NOT in the
      // fixed list this component itself creates once in the 'load' handler
      // and never swaps out.
      const oldBasemapSourceIds = Object.keys(map.getStyle().sources).filter(
        (id) => !APP_SOURCE_IDS.has(id),
      )
      // Matched by layer *type* ('background'), not by a hardcoded id string --
      // CARTO's styles id theirs "background" but MapTiler's ids its "Background"
      // (capital B), so an id === 'background' check silently failed to match
      // MapTiler's on a light->dark toggle (it also has no 'source' field, so
      // the second half of the old OR clause missed it too). The orphaned
      // layer was never removed, and the *next* dark->light toggle then hit
      // "Layer already exists on this map" trying to re-add "Background".
      const oldBasemapLayerIds = map
        .getStyle()
        .layers.filter(
          (l) =>
            l.type === 'background' || ('source' in l && oldBasemapSourceIds.includes(l.source)),
        )
        .map((l) => l.id)
      const firstNonBasemapLayerId = map
        .getStyle()
        .layers.find((l) => !oldBasemapLayerIds.includes(l.id))?.id

      for (const id of oldBasemapLayerIds) map.removeLayer(id)
      for (const id of oldBasemapSourceIds) {
        if (map.getSource(id)) map.removeSource(id)
      }

      for (const [id, def] of Object.entries(basemap.sources)) {
        map.addSource(id, def as never)
      }
      for (const layer of basemap.layers as never[]) {
        map.addLayer(layer, firstNonBasemapLayerId)
      }
      // Each theme's vendored style ships its own sprite sheet (icon glyphs
      // tuned for that basemap's background) -- without this, toggling theme
      // swapped every fill/line/label color but left the OLD theme's icon
      // sprite loaded, so e.g. switching to light mode kept rendering
      // dark-matter's icons (styled to pop against near-black) on top of the
      // new pale basemap.
      if (basemap.sprite) map.setSprite(basemap.sprite)

      // Sector hover/selected/boundary colors are plain static paint values
      // (not CSS var()s), so they don't follow the theme for free the way
      // the map's popups/controls do -- re-applied here alongside the
      // basemap itself. See SECTOR_COLORS for why these differ per theme.
      const c = SECTOR_COLORS[theme]
      if (map.getLayer('sector-boundary-line')) {
        map.setPaintProperty('sector-boundary-line', 'line-color', c.boundary)
        map.setPaintProperty('sector-boundary-line', 'line-width', SECTOR_BOUNDARY_WIDTH[theme])
      }
      // tertiary_road is the one POI line layer with its own per-theme
      // color/opacity (TERTIARY_ROAD_STYLE) instead of def.color -- without
      // this it would keep whichever theme's values it was created with
      // across a toggle, same as sector-boundary-line above. Its casing
      // layer needs the same per-theme repaint (white border in light mode,
      // navy in dark -- see TERTIARY_ROAD_STYLE's comment).
      if (map.getLayer('poi-tertiary_road')) {
        map.setPaintProperty('poi-tertiary_road', 'line-color', tertiaryRoadColorExpr(theme))
      }
      if (map.getLayer('poi-tertiary_road-casing')) {
        map.setPaintProperty(
          'poi-tertiary_road-casing',
          'line-color',
          TERTIARY_ROAD_STYLE[theme].casingColor,
        )
        map.setPaintProperty(
          'poi-tertiary_road-casing',
          'line-opacity',
          TERTIARY_ROAD_STYLE[theme].opacity,
        )
      }
      // sector-plan-fill's own palette/opacity is theme-aware too (see
      // CLASS_GROUP_COLORS_DARK) -- same "not a CSS var(), re-apply on
      // toggle" reasoning as the sector colors above.
      if (map.getLayer('sector-plan-fill')) {
        const fillColors = theme === 'dark' ? CLASS_GROUP_COLORS_DARK : CLASS_GROUP_COLORS
        map.setPaintProperty(
          'sector-plan-fill',
          'fill-color',
          matchExpr('class_group', fillColors, fillColors.Other),
        )
        map.setPaintProperty('sector-plan-fill', 'fill-opacity', SECTOR_FILL_OPACITY[theme])
      }
      if (map.getLayer('sector-plan-class-outline')) {
        const fillColors = theme === 'dark' ? CLASS_GROUP_COLORS_DARK : CLASS_GROUP_COLORS
        map.setPaintProperty(
          'sector-plan-class-outline',
          'line-color',
          matchExpr('class_group', fillColors, fillColors.Other),
        )
        map.setPaintProperty(
          'sector-plan-class-outline',
          'line-opacity',
          SECTOR_OUTLINE_OPACITY[theme],
        )
      }
      if (map.getLayer('sector-hover-fill')) {
        map.setPaintProperty('sector-hover-fill', 'fill-color', c.hover)
      }
      if (map.getLayer('sector-hover-glow')) {
        map.setPaintProperty('sector-hover-glow', 'line-color', c.hover)
      }
      if (map.getLayer('sector-hover-outline')) {
        map.setPaintProperty('sector-hover-outline', 'line-color', c.hover)
      }
      if (map.getLayer('sector-selected-outline')) {
        map.setPaintProperty('sector-selected-outline', 'line-color', c.selected)
      }
      if (map.getLayer('sector-selected-glow')) {
        map.setPaintProperty('sector-selected-glow', 'line-color', c.selected)
        map.setLayoutProperty(
          'sector-selected-glow',
          'visibility',
          theme === 'dark' ? 'visible' : 'none',
        )
      }
      // Cluster count labels sit on top of each cluster's own (theme-static)
      // category color, so unlike everything else re-applied above this
      // isn't reacting to a color that itself changed -- it's a deliberate
      // per-theme preference: near-black text stays legible against every
      // POI category color in dark mode's brighter/more saturated basemap
      // context, but reads muddy in light mode, where white cuts through
      // more cleanly against the same circle colors sitting on a pale map.
      for (const def of POI_LAYER_DEFS) {
        const id = `poi-${def.key}-cluster-count`
        if (map.getLayer(id)) {
          map.setPaintProperty(id, 'text-color', theme === 'dark' ? '#0b0d11' : '#ffffff')
        }
      }
    }

    const observer = new MutationObserver(() => void syncBasemap())
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const url = selectedSector !== 'all' ? `/api/stats?sector=${selectedSector}` : '/api/stats'
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setSubclassStats(data.bySubclass ?? [])
        setPoiSubclassStats(data.poiBySubclass ?? [])
      })
      .catch(() => {})
  }, [selectedSector])

  // Applies the real localStorage-persisted visibility/expanded state after
  // mount, once hydration (which needs the SSR-matching defaults above) has
  // already reconciled. Runs once; the effects below take over persisting
  // further changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR/hydration guard, same pattern as NotificationBell.tsx
    setVisibility(loadStoredVisibility())
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(visibility))
    } catch {}
  }, [visibility])

  // Values come from PostGIS, not live user input, but escaping is cheap
  // defense-in-depth for HTML injected via Popup.setHTML.
  function escapeHtml(v: unknown): string {
    return String(v).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    )
  }

  // Small header icon + accent color per feature type, echoing the same
  // Parcel/Road/Grid icon set used in the sidebar (StatsPanel.tsx) so the
  // popup reads as part of the same design system rather than a bare table.
  const POPUP_ICON_PATHS: Record<string, string> = {
    road: '<path d="M9 3L5 21M15 3l4 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 3v2.5M12 9.5v2.5M12 15.5v2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    boundary:
      '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="1.6"/>',
    parcel:
      '<path d="M4 8.5L12 4l8 4.5v7L12 20l-8-4.5v-7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 8.5L12 13l8-4.5M12 13v7" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    poi: '<path d="M12 21s7-6.1 7-11.5S16.4 3 12 3 5 5.6 5 9.5 12 21 12 21z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="2.4" stroke="currentColor" stroke-width="1.6"/>',
  }

  // POI feature properties vary per layer/table (see LAYERS in the tiles
  // route), so unlike the fixed road/boundary/parcel rows above, POI rows
  // are derived generically from whatever the vector tile actually sent --
  // id/geometry-only fields dropped, the rest title-cased for display.
  function poiPropertyLabel(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  function poiLayerDef(layerId: string): PoiLayerDef | undefined {
    return POI_LAYER_DEFS.find((d) => `poi-${d.key}` === layerId)
  }

  function popupHeaderHtml(feature: MapGEOJSONFeatureCompat) {
    const p = feature.properties ?? {}
    const isRoad = feature.layer.id === 'road-line'
    const isBoundary =
      feature.layer.id === 'sector-boundary-line' || feature.layer.id === 'sector-hit-target'
    const poiDef = poiLayerDef(feature.layer.id)
    const kind = isRoad ? 'road' : isBoundary ? 'boundary' : poiDef ? 'poi' : 'parcel'
    const title = isRoad
      ? (p.road_name ?? 'Road segment')
      : isBoundary
        ? (p.name ?? 'Sector boundary')
        : poiDef
          ? (p.name ?? poiDef.label)
          : (p.label ?? 'Parcel')
    const subtitle = isRoad
      ? p.type
      : isBoundary
        ? `Sector ${p.sector_no}`
        : poiDef
          ? poiDef.label
          : p.class
    // poiDef.color is a plain hex string (the "18" suffix below appends alpha to it), but the
    // non-POI fallback has to stay a CSS var() so it follows the theme -- color-mix() is the
    // var()-safe equivalent of a hex alpha suffix (both land around ~9% opacity over the panel).
    const accentColor = poiDef?.color
    const iconBg = accentColor
      ? `${accentColor}18`
      : 'color-mix(in srgb, var(--map-accent) 9%, transparent)'
    const iconFg = accentColor ?? 'var(--map-accent)'

    return `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:14px 16px 12px;border-bottom:1px solid var(--map-popup-row-border)">
        <span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border-radius:9px;background:${iconBg};color:${iconFg}">
          <svg viewBox="0 0 24 24" fill="none" width="17" height="17">${POPUP_ICON_PATHS[kind]}</svg>
        </span>
        <div style="min-width:0">
          <div style="font-size:13.5px;font-weight:700;color:var(--map-popup-heading);line-height:1.3;overflow-wrap:anywhere">${escapeHtml(title)}</div>
          ${subtitle ? `<div style="margin-top:1px;font-size:11.5px;color:var(--map-popup-subtle)">${escapeHtml(subtitle)}</div>` : ''}
        </div>
      </div>`
  }

  // Sanitation "Toilet" rows carry their seat breakdown as free text in
  // `name` (e.g. "Toilet - M-30, F-30, Urinal - 10") rather than structured
  // M/F/Urinal columns -- same digit-sum this feature's title is drawn from,
  // surfaced explicitly here so the seat count in the popup traces back to
  // the same text a viewer can read for themselves, and matches how the
  // Sector Report drawer's Utility Infrastructure -> Toilets total is built
  // (see /api/sector-plan/report's toiletSeats reducer).
  function toiletSeatBreakdown(name: unknown): [string, unknown][] {
    if (typeof name !== 'string' || !name.trim()) return []
    const matches = name.match(/\d+/g)
    if (!matches) return [['Seat breakdown', name]]
    const seats = matches.reduce((s, n) => s + Number(n), 0)
    return [
      ['Seat breakdown', name],
      ['Total seats', seats],
    ]
  }

  function propertyRowsHtml(feature: MapGEOJSONFeatureCompat) {
    const p = feature.properties ?? {}
    const poiDef = poiLayerDef(feature.layer.id)
    const isToilet = feature.layer.id === 'poi-sanitation' && p.subclass === 'Toilet'
    const rows: [string, unknown][] = poiDef
      ? [
          ...(isToilet ? toiletSeatBreakdown(p.name) : []),
          ...Object.entries(p)
            // name/label already shown in the header -- id and raw geometry
            // fields aren't meaningful to a viewer, so both are dropped here.
            // For toilets, name is also re-shown above as the seat breakdown.
            // osm_id (tertiary_road) is an external identifier meaningless to
            // an operator, and in_sector is a filter mechanism (see the
            // "Only inside sector area" layer-panel toggle), not a fact about
            // the road -- both dropped the same way id is.
            .filter(([k]) => !['id', 'name', 'geom', 'osm_id', 'in_sector'].includes(k))
            .map(([k, v]): [string, unknown] => [poiPropertyLabel(k), v]),
        ]
      : feature.layer.id === 'road-line'
        ? [
            ['ROW width (m)', p.row_width_m],
            ['Sector', p.sector_no],
          ]
        : feature.layer.id === 'sector-boundary-line' || feature.layer.id === 'sector-hit-target'
          ? [['Area (ha)', p.area_hac]]
          : [
              ['Subclass', p.subclass],
              ['Plot No.', p.plot_no],
              ['Block', p.block],
              ['Sector', p.sector_no ?? 'Peripheral'],
              ['Area (ha)', typeof p.area === 'number' ? p.area.toFixed(3) : p.area],
            ]

    const visible = rows.filter(([, v]) => v !== undefined)
    if (visible.length === 0) return ''

    return `<div style="padding:10px 16px 4px;display:flex;flex-direction:column">${visible
      .map(
        ([k, v], i) =>
          `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:5px 0;${i > 0 ? 'border-top:1px solid var(--map-popup-row-border)' : ''}">
            <span style="font-size:11.5px;color:var(--map-popup-faint)">${escapeHtml(k)}</span>
            <span style="font-size:12.5px;font-weight:600;color:var(--map-popup-heading);text-align:right;overflow-wrap:anywhere">${
              v === null || v === '' ? '—' : escapeHtml(v)
            }</span>
          </div>`,
      )
      .join('')}</div>`
  }

  function ticketRowsHtml(ticket: {
    number: number
    subject: string
    status: { name: string; color: string } | null
    priority: { name: string; color: string } | null
  }) {
    const badge = (label: string, color: string) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:${color}18;color:${color};font-size:10.5px;font-weight:700">${
        label === ticket.status?.name
          ? `<span style="width:5px;height:5px;border-radius:999px;background:${color}"></span>`
          : ''
      }${escapeHtml(label)}</span>`

    return `<div style="margin:12px 16px 0;padding-top:12px;padding-bottom:14px;border-top:1px solid var(--map-popup-row-border)">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap">
        ${ticket.status ? badge(ticket.status.name, ticket.status.color) : ''}
        ${ticket.priority ? badge(ticket.priority.name, ticket.priority.color) : ''}
      </div>
      <p style="margin:0 0 9px;font-size:12.5px;line-height:1.45;color:var(--map-popup-subtle);overflow-wrap:anywhere">${escapeHtml(ticket.subject)}</p>
      <a href="/tickets/${ticket.number}" style="display:inline-flex;align-items:center;gap:4px;color:var(--map-accent);font-weight:700;text-decoration:none;font-size:12px">Show the ticket <span style="font-size:13px">→</span></a>
    </div>`
  }

  function showPopup(map: MLMap, feature: MapGEOJSONFeatureCompat, lngLat: LngLat) {
    popupRef.current?.remove()
    popupParcelIdRef.current = null

    const baseHtml = (ticketHtml: string) =>
      `<div style="font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;width:240px;border-radius:16px">${popupHeaderHtml(feature)}${propertyRowsHtml(feature)}${ticketHtml}</div>`

    const popup = new Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(lngLat)
      .setHTML(baseHtml(''))
      .addTo(map)
    popupRef.current = popup
    // Its own close button bypasses every other path that clears
    // popupRef/popupParcelIdRef (map click, right-click, sector change) --
    // without this, popupRef.current keeps pointing at a removed-but-not-
    // nulled Popup, which would make isOpen()-style "is a popup showing"
    // checks elsewhere see a stale positive forever after the first popup.
    popup.on('close', () => {
      if (popupRef.current !== popup) return
      popupRef.current = null
      popupParcelIdRef.current = null
    })

    // Only parcels (sector-plan-fill) are ticket-backed — roads/boundaries never have one.
    const rawId =
      feature.layer.id === 'sector-plan-fill' ? (feature.id ?? feature.properties?.id) : undefined
    const sectorPlanId = typeof rawId === 'number' ? rawId : Number(rawId)
    if (!Number.isInteger(sectorPlanId)) return

    popupParcelIdRef.current = sectorPlanId
    fetch(`/api/tickets/by-parcel/${sectorPlanId}`)
      .then((r) => r.json())
      .then((data: { ticket: null | Parameters<typeof ticketRowsHtml>[0] }) => {
        // Discard if the user clicked elsewhere (or closed the popup) while this was in flight.
        if (popupRef.current !== popup || popupParcelIdRef.current !== sectorPlanId) return
        if (!data.ticket) return
        popup.setHTML(baseHtml(ticketRowsHtml(data.ticket)))
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    let cancelled = false

    loadBasemapStyle(readMapTheme()).then((basemap) => {
      if (cancelled || !mapContainer.current || mapRef.current) return

      const map = new MLMap({
        container: mapContainer.current,
        style: {
          version: 8,
          // Needed for any 'symbol'/text-field layer (the P/BS/G signage
          // labels below, plus the vendored CARTO style's own place-name/
          // road labels) -- MapLibre renders text from server-supplied SDF
          // glyph PBFs, not local system fonts. Public, no-key demo endpoint.
          // NOT CARTO's own glyphs URL (referenced by the style JSON but
          // discarded here): a style has exactly one glyphs endpoint, and
          // CARTO's font server 404s on "Noto Sans Bold" (used by our own
          // parking/measure labels below) while every CARTO label layer
          // already falls back to plain "Noto Sans Regular", which this
          // endpoint does serve.
          glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
          sprite: basemap.sprite as string | undefined,
          sources: basemap.sources as never,
          layers: basemap.layers as never,
        },
        center: initialParcel ? [initialParcel.lng, initialParcel.lat] : CENTER,
        zoom: initialParcel ? 16 : INITIAL_ZOOM,
        attributionControl: { compact: false },
      })
      // The constructor's own `center` places that lng/lat at the raw canvas
      // midpoint, which is NOT the visually free area once the docked left
      // "Kumbh Mela" panel and top-right Stats panel are drawn on top -- on
      // first load (before any fitBounds/flyTo call ever runs) that made the
      // initial view read as pushed up/left of where it should sit. Every
      // other camera move in this file already accounts for this via
      // mapFlyPadding(); jumpTo (unlike easeTo/flyTo) recenters instantly
      // with no animation, so calling it here immediately after construction
      // corrects the initial view before the user perceives any motion.
      map.jumpTo({
        center: initialParcel ? [initialParcel.lng, initialParcel.lat] : CENTER,
        zoom: initialParcel ? 16 : INITIAL_ZOOM,
        padding: mapFlyPadding(),
      })
      mapRef.current = map
      initMap(map)
    })

    return () => {
      cancelled = true
      mapCleanupRef.current?.()
      mapCleanupRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial-view-only prop, map is created once
  }, [])

  function initMap(map: MLMap) {
    // Bottom-right, not top-right -- the Stats panel docks top-right and a
    // MapLibre control there sits on a fixed offset unaware of the panel's
    // collapsed/expanded height, so they'd visually collide.
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right')
    // Same corner/group mechanism as NavigationControl so it stacks below
    // the zoom/compass buttons using MapLibre's own layout, not a guessed
    // pixel offset that drifts out of sync and overlaps them.
    map.addControl(new PitchToggleControl(), 'bottom-right')

    let marker: Marker | null = null
    if (initialParcel) {
      marker = new Marker({ color: '#2563eb' })
        .setLngLat([initialParcel.lng, initialParcel.lat])
        .addTo(map)
    }

    map.on('load', () => {
      map.addSource('sector_plan', {
        type: 'vector',
        tiles: [`${location.origin}/api/tiles/sector_plan/{z}/{x}/{y}`],
        promoteId: 'id',
      })
      map.addSource('road', {
        type: 'vector',
        tiles: [`${location.origin}/api/tiles/road/{z}/{x}/{y}`],
        promoteId: 'id',
      })
      map.addSource('sector_boundary', {
        type: 'vector',
        tiles: [`${location.origin}/api/tiles/sector_boundary/{z}/{x}/{y}`],
        promoteId: 'id',
      })

      // Full-viewport dark scrim over the vendored vector basemap, used to
      // dim it when a class/sub-class filter is active (see the sector/class
      // filter effect below) -- replaces the old raster basemap's
      // raster-brightness-max paint property, which only raster layers
      // support and the vendored CARTO style's ~90 fill/line/symbol layers
      // don't have an equivalent single knob for. Starts fully transparent;
      // opacity is the only thing that effect ever touches.
      map.addLayer({
        id: 'basemap-dim-scrim',
        type: 'background',
        paint: { 'background-color': '#000000', 'background-opacity': 0 },
      })

      // River sits beneath everything else on the map (it's the base
      // waterway the sector plan is drawn over), so it's added first, before
      // sector_plan -- POI layers all get their own vector source below, but
      // river's source/layer are created here instead so it can be placed at
      // the very bottom of the paint order.
      const riverDef = POI_LAYER_DEFS.find((d) => d.key === 'river')
      if (riverDef) {
        map.addSource(riverDef.key, {
          type: 'vector',
          tiles: [`${location.origin}/api/tiles/${riverDef.key}/{z}/{x}/{y}`],
          promoteId: 'id',
        })
        map.addLayer({
          id: `poi-${riverDef.key}`,
          type: 'fill',
          source: riverDef.key,
          'source-layer': riverDef.key,
          paint: {
            'fill-color': riverDef.color,
            'fill-opacity': 0.25,
            'fill-outline-color': riverDef.color,
          },
        })
      }

      // Invisible parcel-shaped hit-target, always present regardless of the
      // "Sector plan" visibility toggle -- queryRenderedFeatures skips
      // layers with layout visibility 'none' entirely, so with the toggle
      // off (a common way to view class-filter emphasis outlines without
      // the plain fill underneath) sector-plan-fill itself stops being
      // clickable, and a click inside a filter-highlighted parcel's outline
      // (but not exactly on the thin outline stroke) would find nothing here
      // and fall through to sector-hit-target below, wrongly opening the
      // full Sector Report drawer instead of that parcel's own popup. This
      // layer keeps the same filter as sector-plan-fill (see the sector/class
      // filter effect below, which sets both together) so it's exactly as
      // clickable as the fill would be, just without ever being painted.
      map.addLayer({
        id: 'sector-plan-hit-target',
        type: 'fill',
        source: 'sector_plan',
        'source-layer': 'sector_plan',
        paint: { 'fill-color': '#000000', 'fill-opacity': 0.01 },
      })

      // Render order: sector_plan fill (bottom) -> roads -> boundaries (top)
      {
        const fillTheme = readMapTheme()
        const fillColors = fillTheme === 'dark' ? CLASS_GROUP_COLORS_DARK : CLASS_GROUP_COLORS
        map.addLayer({
          id: 'sector-plan-fill',
          type: 'fill',
          source: 'sector_plan',
          'source-layer': 'sector_plan',
          paint: {
            'fill-color': matchExpr('class_group', fillColors, fillColors.Other),
            'fill-opacity': SECTOR_FILL_OPACITY[fillTheme],
          },
        })
        // The class hairline (see SECTOR_FILL_OPACITY's note). Carries the
        // per-class colour that the wash above deliberately no longer does,
        // and is kept in lockstep with sector-plan-fill everywhere the fill
        // is filtered or toggled -- an outline surviving a filter its own
        // fill didn't would draw ghost parcels.
        map.addLayer({
          id: 'sector-plan-class-outline',
          type: 'line',
          source: 'sector_plan',
          'source-layer': 'sector_plan',
          layout: { 'line-join': 'round' },
          paint: {
            'line-color': matchExpr('class_group', fillColors, fillColors.Other),
            'line-width': SECTOR_OUTLINE_WIDTH,
            'line-opacity': SECTOR_OUTLINE_OPACITY[fillTheme],
          },
        })
      }
      // Visual emphasis for an active class/sub-class filter -- everything
      // already NOT matching the filter is excluded by sector-plan-fill's
      // own setFilter (below), so this is purely about making the surviving
      // parcels easy to spot against the basemap/road clutter rather than
      // reading as a plain flat fill (same glow+outline pairing as the
      // sector-hover-* layers above). NO_MATCH keeps it invisible until the
      // filter effect below turns it on, same pattern as sector-hover-*.
      //
      // Uses a single fixed accent color (FILTER_EMPHASIS_COLOR), not the
      // matched class's own color -- several classes (Parking #6b7280, Road
      // #78716c, Other #cbd5e1) are themselves greys close to the dimmed
      // basemap's tone, so a same-colored glow/outline on those classes was
      // nearly invisible. A fixed, distinctly saturated color guarantees
      // contrast regardless of which class is selected -- same reasoning as
      // sector-selected-outline below being hardcoded violet rather than
      // reusing another layer's color.
      const FILTER_NO_MATCH: FilterSpecification = ['==', ['get', 'id'], -1]
      map.addLayer({
        id: 'sector-plan-filter-glow',
        type: 'line',
        source: 'sector_plan',
        'source-layer': 'sector_plan',
        filter: FILTER_NO_MATCH,
        paint: {
          'line-color': FILTER_EMPHASIS_COLOR,
          'line-width': 7,
          'line-opacity': 0.4,
          'line-blur': 5,
        },
      })
      map.addLayer({
        id: 'sector-plan-filter-outline',
        type: 'line',
        source: 'sector_plan',
        'source-layer': 'sector_plan',
        filter: FILTER_NO_MATCH,
        paint: {
          'line-color': FILTER_EMPHASIS_COLOR,
          'line-width': 2.5,
          'line-opacity': 1,
        },
      })
      // Peripheral areas (outside any numbered sector) get a dashed accent
      // outline on top of their class fill, per user decision.
      map.addLayer({
        id: 'sector-plan-peripheral-outline',
        type: 'line',
        source: 'sector_plan',
        'source-layer': 'sector_plan',
        filter: ['==', ['get', 'sector_no'], null],
        paint: {
          'line-color': '#f97316',
          'line-width': 1.5,
          'line-dasharray': [2, 1.5],
        },
      })
      map.addLayer({
        id: 'road-line',
        type: 'line',
        source: 'road',
        'source-layer': 'road',
        paint: {
          'line-color': matchExpr('type', ROAD_TYPE_COLORS, '#78716c'),
          // Flat width, no zoom/row_width_m scaling -- matches the sector
          // boundary line's constant 1px. Emergency Exit stays 2x that (2px)
          // so it's still visually distinct from Proposed/Existing Road.
          'line-width': ['case', ['==', ['get', 'type'], 'Emergency Exit'], 2, 1],
        },
      })
      map.addLayer({
        id: 'sector-boundary-line',
        type: 'line',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        paint: {
          'line-color': SECTOR_COLORS[readMapTheme()].boundary,
          'line-width': SECTOR_BOUNDARY_WIDTH[readMapTheme()],
        },
      })

      // Remaining POI layers (Aug 2026 JSON drop) -- one source + one visual
      // layer per entry in POI_LAYER_DEFS (river excluded -- it was already
      // added above, beneath sector_plan), rendered on top of the sector
      // plan/roads/boundaries above. Sources are created up front so
      // add-layer order below (which controls paint/z-order) doesn't have to
      // match POI_LAYER_DEFS's array order.
      //
      // Point-geometry layers get a plain (non-clustering) 'geojson' source
      // that MapView re-clusters itself on every zoom change -- see the
      // poiClusterDataRef/syncPoiClusters effect below. MapLibre's built-in
      // geojson clustering (cluster: true) was tried first, but its
      // supercluster engine has no "max points per cluster" option: it only
      // groups points within a fixed screen-pixel radius per zoom level, so
      // a genuinely dense pocket of points (e.g. 150+ dustbins along one
      // riverside stretch) still produced one giant cluster no matter how
      // tight the radius was tuned. clusterPoints() (src/lib/poiClustering.ts)
      // recursively subdivides any group over MAX_CLUSTER_SIZE instead,
      // guaranteeing a hard cap. A single full-dataset fetch is safe here
      // specifically because all 7 point tables are small (under ~1,400 rows
      // each as of Sept 2026 -- re-check row counts before adding an 8th).
      // /api/poi/points/[layer] serves the same columns the tiles route
      // does, so popups read identically either way. Line/polygon POI
      // layers (river, ashram, kumbh_land, etc.) are unaffected and stay on
      // vector tiles.
      const remainingPoiDefs = POI_LAYER_DEFS.filter((d) => d.key !== 'river')
      for (const def of remainingPoiDefs) {
        if (def.geomType === 'point') {
          map.addSource(def.key, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          })
        } else {
          map.addSource(def.key, {
            type: 'vector',
            tiles: [`${location.origin}/api/tiles/${def.key}/{z}/{x}/{y}`],
            promoteId: 'id',
          })
        }
      }

      // Paint polygons first (bottom), then lines, then points (top) --
      // otherwise area layers like kumbh_land/ashram would cover the point
      // markers (dustbins, sanitation, etc.) drawn before them.
      const byGeomType = (t: PoiGeomType) => remainingPoiDefs.filter((d) => d.geomType === t)

      for (const def of byGeomType('polygon')) {
        // Same wash + dedicated hairline treatment as sector-plan-fill/
        // sector-plan-class-outline (see SECTOR_FILL_OPACITY's note) --
        // these area POIs (ashrams, tent city, ropeway areas, etc.) are
        // parcel-shaped just like sector_plan features, so a flat 0.25
        // fill-color + fill-outline-color read the same "solid blob" way
        // once several were on screen together.
        map.addLayer({
          id: `poi-${def.key}`,
          type: 'fill',
          source: def.key,
          'source-layer': def.key,
          paint: {
            'fill-color': def.color,
            'fill-opacity': POI_POLYGON_FILL_OPACITY,
          },
        })
        map.addLayer({
          id: `poi-${def.key}-outline`,
          type: 'line',
          source: def.key,
          'source-layer': def.key,
          layout: { 'line-join': 'round' },
          paint: {
            'line-color': def.color,
            'line-width': POI_POLYGON_OUTLINE_WIDTH,
            'line-opacity': POI_POLYGON_OUTLINE_OPACITY,
          },
        })
      }
      for (const def of byGeomType('line')) {
        // Entry/exit routes are a functionally important filter (crowd flow
        // planning), not just another reference line -- a flat 2px width
        // that stays visually thin at any zoom made them nearly impossible
        // to spot zoomed out, and easy to miss even zoomed in against the
        // basemap's own similarly thin road strokes. Thicker overall, AND
        // scaling UP as you zoom OUT (the reverse of the usual "thinner
        // when zoomed out" pattern), so the route stays a clear, deliberate
        // marker at every zoom instead of shrinking into the background
        // exactly when the wide view would make it most useful to see.
        const isEntryExit = def.key === 'entry_exit_line'
        const isTertiary = def.key === 'tertiary_road'
        if (isEntryExit) {
          // Entry/exit routes are short real-world segments (tens to a few
          // hundred metres) -- at whole-region zoom levels (4-9) even a wide
          // stroke is only a handful of screen-pixels long, so it reads as
          // an easy-to-miss speck no matter how thick the line itself is.
          // A wide, soft, semi-transparent casing drawn underneath turns
          // each short segment into an unmissable glowing blob at low zoom,
          // while fading out (both narrower and more transparent) as you
          // zoom in and the crisp line underneath becomes legible on its
          // own -- same idea as the sector-selected-glow halo layer.
          map.addLayer({
            id: `poi-${def.key}-glow`,
            type: 'line',
            source: def.key,
            'source-layer': def.key,
            paint: {
              'line-color': def.color,
              'line-width': ['interpolate', ['linear'], ['zoom'], 4, 28, 9, 18, 13, 8, 16, 0],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.55, 9, 0.4, 16, 0],
              'line-blur': 1.5,
            },
          })
        }
        // tertiary_road's Google Maps nav-line look is a CASING, not a single
        // stroke: Google's own route line is a pale/white border with a
        // solid, more saturated core drawn on top -- that light-edge/dark-
        // center pairing is what actually reads as "a bold 3D route ribbon"
        // rather than just a thick flat line. Same halo-plus-core idea as the
        // entry_exit glow above, but as a permanent two-layer casing instead
        // of a fading low-zoom effect.
        if (isTertiary) {
          map.addLayer(
            {
              id: `poi-${def.key}-casing`,
              type: 'line',
              source: def.key,
              'source-layer': def.key,
              minzoom: 6,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': TERTIARY_ROAD_STYLE[readMapTheme()].casingColor,
                'line-opacity': TERTIARY_ROAD_STYLE[readMapTheme()].opacity,
                // Wider than the core line below by a fixed margin at every
                // zoom so the casing reads as a consistent border thickness,
                // not a halo that grows/shrinks independently of the core --
                // tiered by fclass (see TERTIARY_ROAD_CASING_WIDTH) so a
                // highway's casing is wider than a lane's, matching the core.
                'line-width': TERTIARY_ROAD_CASING_WIDTH,
              },
            },
            'road-line',
          )
        }
        map.addLayer(
          {
            id: `poi-${def.key}`,
            type: 'line',
            source: def.key,
            'source-layer': def.key,
            // Matches the tiles route's own minzoom for this layer (see
            // PLAN-deferred-roads.md) -- without this the client would still
            // request/paint an (empty) tile below z6 for nothing.
            ...(isTertiary ? { minzoom: 6 } : {}),
            // Round join/cap so a bold stroke reads as one continuous ribbon
            // at junctions and endpoints (Google Maps' own route-line look)
            // instead of the sharp miter corners/flat-cut ends the default
            // line-join/line-cap produce, which stand out badly at this width.
            ...(isTertiary ? { layout: { 'line-join': 'round', 'line-cap': 'round' } } : {}),
            paint: {
              // tertiary_road gets its own theme-aware color/opacity
              // (TERTIARY_ROAD_STYLE) instead of def.color -- see that
              // constant's comment for why a flat colour doesn't survive at
              // this feature density in both themes.
              'line-color': isTertiary ? tertiaryRoadColorExpr(readMapTheme()) : def.color,
              // The core line is drawn fully opaque -- TERTIARY_ROAD_STYLE's
              // opacity now applies only to the casing below it (a
              // semi-transparent core over a semi-transparent casing reads as
              // muddy/washed-out; Google's own route core is solid).
              'line-opacity': 1,
              // Extends all the way down to zoom 4 (whole-state view) at 14px
              // -- the previous 10-18 range left it clamped to a flat 5px
              // below zoom 10, but these are short real-world segments (a
              // route crossing, not a highway), so even 9px barely registered
              // as more than a colored speck once the whole Haridwar-Rishikesh
              // region is on screen. Wider at low zoom, plus the glow casing
              // above, makes the route legible as a shape from far out.
              'line-width': isEntryExit
                ? ['interpolate', ['linear'], ['zoom'], 4, 14, 9, 10, 14, 4, 18, 2.5]
                : isTertiary
                  ? // The solid core drawn over poi-tertiary_road-casing above
                    // -- narrower than the casing by a fixed margin at every
                    // zoom so the pale border reads as a consistent edge, the
                    // same layered look as Google's own route polyline.
                    // Tiered by fclass (see TERTIARY_ROAD_CORE_WIDTH) so
                    // highways draw thicker than main roads, and lanes
                    // thinner still, instead of one flat width for all three.
                    TERTIARY_ROAD_CORE_WIDTH
                  : 2,
            },
          },
          // Rendered beneath road-line (added earlier, above) so the curated
          // project road network always wins visually over this base street
          // texture -- every other POI line layer has no such ordering
          // requirement against road-line, hence special-casing just this one.
          isTertiary ? 'road-line' : undefined,
        )
      }
      for (const def of byGeomType('point')) {
        // Any POI with a signage code (Ghat points, bus stops, fire
        // hydrants -- "G"/"BS"/"FH") shows only that label, not the dot
        // underneath -- still add the circle layer (kept as the hit-target
        // for hover/click and the Layers-panel visibility toggle) but
        // render it fully transparent.
        const hideCircle = Boolean(POI_SIGNAGE_CODES[def.key])

        // Cluster circle -- one per group of nearby points (see clusterRadius
        // on the geojson source above). 3 size/color-opacity tiers by point
        // count, matching the mockup: small (2-9), medium (10-49), large
        // (50+). Uses the layer's own category color throughout, just deeper
        // opacity at higher counts so a dense cluster reads as "more"
        // without needing a different hue.
        map.addLayer({
          id: `poi-${def.key}-cluster`,
          type: 'circle',
          source: def.key,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': def.color,
            'circle-opacity': ['step', ['get', 'point_count'], 0.75, 10, 0.85, 50, 0.92],
            'circle-radius': ['step', ['get', 'point_count'], 9, 10, 14, 50, 19],
            // Smooths the merge/split "pop" every zoom step causes -- a
            // cluster's own point_count (and so its radius/opacity tier)
            // jumps discretely as supercluster recomputes membership on
            // each zoom change, so without a transition the circle would
            // instantly snap to its new size instead of visibly growing or
            // shrinking. Short duration so it still feels responsive to
            // scroll-wheel zooming rather than lagging behind it.
            'circle-radius-transition': { duration: 200 },
            'circle-opacity-transition': { duration: 200 },
          },
        })
        // Count label -- only rendered from CLUSTER_LABEL_MIN_ZOOM up. Below
        // that, many small nearby clusters (each capped at MAX_CLUSTER_SIZE,
        // see clusterPoints in src/lib/poiClustering.ts) sit close enough
        // together that overlapping 2-3 digit numbers turned into unreadable
        // text soup -- the bare colored circles (poi-{key}-cluster above)
        // still convey "there's a cluster here", just without a number
        // fighting its neighbors for space, until there's screen room for
        // the label to actually mean something.
        map.addLayer({
          id: `poi-${def.key}-cluster-count`,
          type: 'symbol',
          source: def.key,
          filter: ['has', 'point_count'],
          minzoom: CLUSTER_LABEL_MIN_ZOOM,
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Bold'],
            'text-size': ['step', ['get', 'point_count'], 10.5, 10, 12, 50, 13],
            'text-allow-overlap': true,
          },
          paint: {
            // Theme-aware -- see the theme-swap effect's matching
            // poi-{key}-cluster-count repaint for why dark mode keeps
            // near-black text (reads cleanly against this layer's own
            // fairly light/saturated category colors) while light mode uses
            // white instead.
            'text-color': readMapTheme() === 'dark' ? '#0b0d11' : '#ffffff',
          },
        })

        // The visible dot's own radius (2.5-6px) is too small a target to
        // reliably click/tap -- queryRenderedFeatures hit-tests against the
        // actual rendered geometry, so a miss just falls through to the
        // sector-selection click handler underneath instead of opening this
        // point's popup. A wider fully-transparent circle underneath widens
        // the real click area without changing how the dot/badge looks.
        // Filtered to unclustered points only -- clustered points already
        // have their own (much bigger) clickable circle above.
        map.addLayer({
          id: `poi-${def.key}-hit`,
          type: 'circle',
          source: def.key,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 14],
            'circle-opacity': 0,
          },
        })
        // Dot-density style: solid flat-filled circle, no white stroke ring
        // -- against the near-black/navy dark basemap a stroke read as a
        // washed-out halo around every point, muddying the actual category
        // color. Slightly larger than the old 2.5-6px radius so the flat
        // fill still has visual presence without the stroke's extra few
        // pixels of apparent size.
        map.addLayer({
          id: `poi-${def.key}`,
          type: 'circle',
          source: def.key,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': def.color,
            // Extends down to zoom 4 at radius 6 -- below zoom 10 this used
            // to clamp flat to 3px, which (like entry_exit_line's own
            // line-width) barely registered once zoomed out to a
            // whole-region view. Every point layer gets this same wider
            // low-zoom range, not just entry/exit, so dots stay visibly
            // present at any zoom instead of shrinking into specks.
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 4, 16, 7],
            'circle-opacity': hideCircle ? 0 : 0.88,
            // Matches poi-{key}-cluster's own transition -- a point popping
            // out of a cluster as it crosses clusterMaxZoom (or into one)
            // otherwise snaps straight to full size/opacity the instant the
            // filter flips, which read as an abrupt flicker rather than a
            // point "arriving".
            'circle-radius-transition': { duration: 200 },
            'circle-opacity-transition': { duration: 200 },
          },
        })

        const signageCode = POI_SIGNAGE_CODES[def.key]
        if (signageCode) {
          // Solid-colour pill with the code baked into the same raster
          // (matching the Layers-panel/Stats-panel badge) instead of plain
          // coloured text -- see makeBadgeIcon for why this replaced a
          // stretched-pill + separate text-field layer.
          const iconId = badgeIconId(signageCode, def.color)
          if (!map.hasImage(iconId)) {
            map.addImage(iconId, makeBadgeIcon(signageCode, def.color), { pixelRatio: 4 })
          }
          map.addLayer({
            id: `poi-${def.key}-label`,
            type: 'symbol',
            source: def.key,
            filter: ['!', ['has', 'point_count']],
            layout: {
              'icon-image': iconId,
              'icon-anchor': 'bottom',
              'icon-offset': [0, -6],
              'icon-allow-overlap': false,
            },
          })
        }
      }

      // Loads each clustered point layer's full raw dataset once, then
      // clusters+renders it immediately and again on every zoom change (see
      // clusterPoints in src/lib/poiClustering.ts for why this is custom
      // grid clustering rather than MapLibre's built-in cluster:true).
      // Recomputes on zoom only, not pan -- clustering happens in a
      // zoom-fixed world-pixel grid (not viewport-relative), so panning
      // alone never changes which points belong to which cluster.
      const pointDefs = byGeomType('point')
      function syncPoiClusters() {
        const zoom = map.getZoom()
        for (const def of pointDefs) {
          const raw = poiRawFeaturesRef.current[def.key]
          if (!raw) continue
          const source = map.getSource(def.key) as GeoJSONSource | undefined
          source?.setData(clusterPoints(raw, zoom))
        }
      }
      Promise.all(
        pointDefs.map((def) =>
          fetch(`${location.origin}/api/poi/points/${def.key}`)
            .then((r) => r.json())
            .then((fc: { features: Feature<Point>[] }) => {
              poiRawFeaturesRef.current[def.key] = fc.features
            })
            .catch(() => {
              poiRawFeaturesRef.current[def.key] = []
            }),
        ),
      ).then(syncPoiClusters)
      map.on('zoomend', syncPoiClusters)

      // Invisible hit-target covering each sector's full boundary polygon
      // (near-zero, not exactly-zero, opacity so it still paints and stays
      // hit-testable). This is what "hovering/clicking a sector" actually
      // means -- unlike sector-plan-fill it has no gaps between parcels, so
      // the whole sector area is consistently interactive.
      map.addLayer({
        id: 'sector-hit-target',
        type: 'fill',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        paint: { 'fill-color': '#000000', 'fill-opacity': 0.01 },
      })

      const NO_MATCH: FilterSpecification = ['==', ['get', 'sector_no'], -1]

      // Whole-sector hover highlight (muted slate) -- filter-driven rather
      // than per-feature feature-state, since a sector spans hundreds of
      // small sector_plan parcels that would be expensive to track
      // individually. A saturated accent color (tried magenta, then
      // emerald) read as too neon against the muted OSM basemap -- a calm
      // dark neutral reads as "highlighted" without fighting for attention,
      // and stays distinct from the blue selected-sector outline below. The
      // glow is now subtle (thin + low opacity) rather than a thick ring.
      const sectorColors = SECTOR_COLORS[readMapTheme()]
      map.addLayer({
        id: 'sector-hover-fill',
        type: 'fill',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: { 'fill-color': sectorColors.hover, 'fill-opacity': 0.08 },
      })
      map.addLayer({
        id: 'sector-hover-glow',
        type: 'line',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: {
          'line-color': sectorColors.hover,
          'line-width': 6,
          'line-opacity': 0.2,
          'line-blur': 4,
        },
      })
      map.addLayer({
        id: 'sector-hover-outline',
        type: 'line',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: { 'line-color': sectorColors.hover, 'line-width': 2.5, 'line-opacity': 0.9 },
      })
      // Selected-sector outline -- sector-plan-fill/road-line are already
      // filtered down to just this sector elsewhere; this outline is the
      // extra visual anchor for which one that is. Deliberately not blue:
      // ROAD_TYPE_COLORS['Proposed Road'] is #2563eb, and a thick outline in
      // that same hue was indistinguishable from proposed-road segments
      // running along/near the boundary.
      map.addLayer({
        id: 'sector-selected-outline',
        type: 'line',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: { 'line-color': sectorColors.selected, 'line-width': 5, 'line-opacity': 1 },
      })
      // Dark mode's selected outline is a glowing accent (unlike light mode's
      // flat violet), so it gets the same soft blurred halo treatment as
      // sector-hover-glow above -- otherwise a plain 5px line reads as a
      // thick flat stroke rather than the "glowing point" look this was
      // tuned toward. Hidden outright in light mode (paired 1:1 with
      // sector-selected-outline's own filter by the sector-filter effect
      // below) rather than just left at opacity 0, since MapLibre still
      // costs a hit-test pass for every visible-but-invisible layer.
      map.addLayer(
        {
          id: 'sector-selected-glow',
          type: 'line',
          source: 'sector_boundary',
          'source-layer': 'sector_boundary',
          filter: NO_MATCH,
          layout: { visibility: readMapTheme() === 'dark' ? 'visible' : 'none' },
          paint: {
            'line-color': sectorColors.selected,
            'line-width': 10,
            'line-opacity': 0.35,
            'line-blur': 6,
          },
        },
        'sector-selected-outline',
      )

      // Measure-distance path -- plain client-side GeoJSON (not a vector tile
      // source like everything else here), rewritten in place by the redraw
      // effect below every time the committed point list changes. Placed
      // after sector-selected-outline so a measurement drawn near/along a
      // selected sector's boundary renders on top of it, not beneath.
      map.addSource('measure-line', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      // Soft glow beneath the crisp dashed line, same technique as the
      // sector hover highlight -- reads as a precise, "lifted" measuring
      // line rather than a flat static stroke.
      map.addLayer({
        id: 'measure-line-glow',
        type: 'line',
        source: 'measure-line',
        paint: { 'line-color': '#e11d48', 'line-width': 7, 'line-opacity': 0.22, 'line-blur': 3 },
      })
      map.addLayer({
        id: 'measure-line',
        type: 'line',
        source: 'measure-line',
        paint: {
          'line-color': '#e11d48',
          'line-width': 2,
          'line-dasharray': [1.4, 1.4],
        },
      })

      // Per-segment distance labels -- one point feature per committed
      // segment, placed at its midpoint. MapLibre doesn't give precise
      // placement control for text tied to arbitrary line geometry, so a
      // dedicated point source (one feature per segment) is simpler and more
      // reliable than symbol-placement: 'line-center' across a multi-segment
      // LineString.
      map.addSource('measure-label', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'measure-label',
        type: 'symbol',
        source: 'measure-label',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-offset': [0, -1.1],
          'text-anchor': 'bottom',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#e11d48',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.6,
        },
      })

      // Rubber-band preview -- the tentative segment from the last committed
      // point to the cursor. Kept in its own sources so the per-mousemove
      // updates never touch React state or the committed sources (avoids a
      // render on every mouse pixel, and avoids the preview flickering
      // against the committed redraw effect).
      map.addSource('measure-preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'measure-preview-line',
        type: 'line',
        source: 'measure-preview',
        paint: {
          'line-color': '#e11d48',
          'line-width': 2,
          'line-dasharray': [1.4, 1.4],
          'line-opacity': 0.55,
        },
      })
      map.addSource('measure-preview-label', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'measure-preview-label',
        type: 'symbol',
        source: 'measure-preview-label',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-offset': [0, -1.1],
          'text-anchor': 'bottom',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#e11d48',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.6,
          'text-opacity': 0.7,
        },
      })

      // Apply the current layer visibility (POI layers default to off) right
      // away, synchronously with layer creation -- every layer above is
      // added with MapLibre's default 'visible' layout, so without this the
      // POI dots/lines/fills would render (or stay rendered indefinitely, if
      // the separate visibility-syncing effect below never re-runs) despite
      // the sidebar's toggles showing off. Reads visibilityRef, NOT the
      // `visibility` variable directly -- map creation now happens
      // asynchronously (after the basemap style JSON fetch resolves), so by
      // the time this 'load' handler fires, the localStorage-restore mount
      // effect has often already updated `visibility` state to the user's
      // real saved preferences; the plain variable here would still be
      // whatever it was back when this closure was first created.
      applyLayerVisibility(map, visibilityRef.current)

      function setHoverFilter(sectorNo: number | null) {
        const filter: FilterSpecification =
          sectorNo === null ? NO_MATCH : ['==', ['get', 'sector_no'], sectorNo]
        map.setFilter('sector-hover-fill', filter)
        map.setFilter('sector-hover-glow', filter)
        map.setFilter('sector-hover-outline', filter)
      }

      map.on('mousemove', 'sector-hit-target', (e: MapLayerMouseEvent) => {
        // Measure mode owns hover/cursor entirely while active -- see the
        // map-wide mousemove handler below.
        if (measuringRef.current) return
        const raw = e.features?.[0]?.properties?.sector_no
        const sectorNo = typeof raw === 'number' ? raw : null
        if (hoveredSectorRef.current !== sectorNo) {
          hoveredSectorRef.current = sectorNo
          setHoverFilter(sectorNo)
        }
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'sector-hit-target', () => {
        if (measuringRef.current) return
        hoveredSectorRef.current = null
        setHoverFilter(null)
        map.getCanvas().style.cursor = ''
      })

      // Every POI geometry layer, PLUS: the wider invisible -hit circle
      // (points render at 2.5-6px, too small a target to reliably click)
      // and the separate signage-badge symbol layer that bus stops/ghat
      // points render above/offset from their own transparent circle --
      // clicking the visible "BS"/"G" badge has to hit-test too, or clicks
      // on the only thing actually visible for those two layers miss and
      // fall through to sector selection underneath instead.
      const poiLayerIds = POI_LAYER_DEFS.flatMap((d) => {
        const ids = [`poi-${d.key}`]
        if (d.geomType === 'point') ids.push(`poi-${d.key}-hit`)
        if (POI_SIGNAGE_CODES[d.key]) ids.push(`poi-${d.key}-label`)
        return ids
      })
      // Cluster circles -- kept separate from poiLayerIds since a cluster
      // click zooms in (see the click handler below) rather than opening a
      // popup, but they still get the same pointer-cursor hover treatment.
      const poiClusterLayerIds = byGeomType('point').map((d) => `poi-${d.key}-cluster`)

      for (const layerId of [...poiLayerIds, ...poiClusterLayerIds]) {
        map.on('mouseenter', layerId, () => {
          if (measuringRef.current) return
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layerId, () => {
          if (measuringRef.current) return
          map.getCanvas().style.cursor = ''
        })
      }

      // Single map-wide click handler: clicking bare sector area (only
      // sector-hit-target matches, no parcel/road underneath) selects that
      // sector everywhere -- the dropdown, the map filter/fly-to, the Stats
      // panel, and the Sector Report drawer all key off the same
      // selectedSector state. Clicking outside every sector deselects back
      // to "All sectors".
      //
      // Clicking an actual parcel or road, though, only shows that
      // feature's info popup -- it does NOT select the sector. This matters
      // most while a class/sub-class filter is active (e.g. filtered to
      // "Religious Camping" and clicking one of the highlighted matches to
      // inspect it): selecting the sector on every such click used to yank
      // the heavy Sector Report drawer open on top of what was meant to be
      // a quick per-parcel look, fighting the filter-and-inspect workflow.
      // Sector selection remains reachable via bare sector-area clicks, the
      // search dropdown's "Jump to sector", and the Stats panel's
      // per-sector row.
      //
      // POI markers/lines/areas are a separate concern -- clicking one shows
      // its own popup but never changes sector selection, so they're checked
      // first and, when hit, short-circuit the logic below.
      map.on('click', (e) => {
        // Measure mode takes over every click while active -- checked via a
        // ref (not the `measuring` state directly) since this whole 'load'
        // callback runs once on mount and would otherwise close over a
        // stale value forever. addMeasurePoint/clearPreview are safe to call
        // here despite that same staleness because they only ever go through
        // the stable setMeasure identity and pure functional updaters.
        if (measuringRef.current) {
          addMeasurePoint([e.lngLat.lng, e.lngLat.lat])
          clearPreview()
          return
        }

        // Clusters zoom the map in rather than opening a popup -- a cluster
        // circle represents many points at once, so there's no single
        // feature to show a popup for. Our clustering (see clusterPoints in
        // src/lib/poiClustering.ts) is a plain zoom-driven pixel grid with no
        // supercluster-style index to ask "the exact zoom this cluster
        // splits at", so this just zooms in a fixed +3 levels centered on
        // the click -- clusters recompute automatically via the zoomend
        // listener above (syncPoiClusters), and +3 reliably breaks apart a
        // capped (<=20-point) cluster in practice for this dataset's density.
        const clusterHits = map.queryRenderedFeatures(e.point, { layers: poiClusterLayerIds })
        if (clusterHits.length > 0) {
          map.easeTo({
            center: [e.lngLat.lng, e.lngLat.lat],
            zoom: Math.min(map.getZoom() + 3, 18),
            duration: 500,
          })
          return
        }

        const poiHits = map.queryRenderedFeatures(e.point, { layers: poiLayerIds })
        if (poiHits.length > 0) {
          // A -hit/-label hit's properties are the same underlying feature
          // as its poi-<key> circle, but showPopup/poiLayerDef key off
          // feature.layer.id -- normalize back to the geometry layer's id
          // so the popup's header/rows resolve the right PoiLayerDef.
          const hit = poiHits[0]
          const layerId = hit.layer.id.replace(/-(hit|label)$/, '')
          showPopup(
            map,
            { ...hit, layer: { id: layerId } } as unknown as MapGEOJSONFeatureCompat,
            e.lngLat,
          )
          return
        }

        // sector-plan-hit-target (an always-clickable invisible twin of
        // sector-plan-fill, see where it's created above) plus the class-
        // filter emphasis ring are queried alongside sector-plan-fill itself
        // -- when "Sector plan" is toggled off, sector-plan-fill's layout
        // visibility is 'none', which queryRenderedFeatures treats as "not
        // there" for hit-testing purposes even with a filter-highlighted
        // parcel's outline still visibly drawn. Without the hit-target, a
        // click anywhere inside such a parcel's outline (but not exactly on
        // the thin stroke itself) would find no detail hit here and fall
        // through to sector-hit-target below, wrongly opening the full
        // Sector Report drawer instead of just that parcel's popup.
        const hits = map.queryRenderedFeatures(e.point, {
          layers: [
            'sector-plan-fill',
            'sector-plan-hit-target',
            'sector-plan-filter-glow',
            'sector-plan-filter-outline',
            'road-line',
            'sector-hit-target',
          ],
        })
        if (hits.length === 0) {
          setSelectedSector('all')
          popupRef.current?.remove()
          popupParcelIdRef.current = null
          return
        }
        const PARCEL_DETAIL_LAYERS = [
          'sector-plan-fill',
          'sector-plan-hit-target',
          'sector-plan-filter-glow',
          'sector-plan-filter-outline',
        ]
        const detail = hits.find(
          (f) => PARCEL_DETAIL_LAYERS.includes(f.layer.id) || f.layer.id === 'road-line',
        )
        if (detail) {
          // A real parcel/road was hit -- show its popup only, don't touch
          // selectedSector (see comment above the handler). Normalize every
          // parcel-detail layer id back to 'sector-plan-fill' so
          // showPopup/propertyRowsHtml's layer.id switch (which only knows
          // about the fill layer, not its hit-target/emphasis-ring siblings)
          // resolves the parcel property rows correctly instead of falling
          // through to the generic/wrong branch.
          const normalized = PARCEL_DETAIL_LAYERS.includes(detail.layer.id)
            ? ({
                ...detail,
                layer: { id: 'sector-plan-fill' },
              } as unknown as MapGEOJSONFeatureCompat)
            : (detail as unknown as MapGEOJSONFeatureCompat)
          showPopup(map, normalized, e.lngLat)
          return
        }
        // Only sector-hit-target matched (bare sector area, no parcel/road
        // underneath) -- this is the one remaining map click path that
        // selects a sector, with no popup since nothing concrete was clicked.
        const raw = hits[0].properties?.sector_no
        setSelectedSector(typeof raw === 'number' ? raw : 'all')
        popupRef.current?.remove()
        popupParcelIdRef.current = null
      })

      // Right-click: undoes the last committed point while measuring, or --
      // otherwise -- closes any open parcel popup and deselects the current
      // sector, mirroring the "click an empty area to deselect" gesture
      // without having to find empty area. Suppresses both MapLibre's own
      // default handling and the browser's native context menu either way.
      map.on('contextmenu', (e) => {
        if (measuringRef.current) {
          e.preventDefault()
          e.originalEvent?.preventDefault?.()
          undoMeasurePoint()
          clearPreview()
          return
        }
        // A popup can be open with no sector selected (e.g. clicking a
        // parcel outside any selected sector), so this can't early-return
        // on selectedSectorRef alone -- otherwise right-click would do
        // nothing at all in that state instead of closing the popup.
        if (selectedSectorRef.current === 'all' && !popupRef.current) return
        e.preventDefault()
        e.originalEvent?.preventDefault?.()
        setSelectedSector('all')
        popupRef.current?.remove()
        popupRef.current = null
        popupParcelIdRef.current = null
      })

      // Live rubber-band: from the last committed point to the cursor,
      // tracking continuously rather than only appearing after the next
      // click -- reads as "measuring toward" a destination rather than a
      // static after-the-fact result. Writes only the preview sources
      // (never React state), so this runs on every mouse pixel without
      // triggering a render.
      map.on('mousemove', (e) => {
        if (!measuringRef.current || measurePointsRef.current.length === 0) return
        const last = measurePointsRef.current[measurePointsRef.current.length - 1]
        const live: [number, number] = [e.lngLat.lng, e.lngLat.lat]
        setPreview(last, live)
      })
      map.on('mouseout', () => {
        if (measuringRef.current) clearPreview()
      })
    })

    mapCleanupRef.current = () => {
      marker?.remove()
      map.remove()
      mapRef.current = null
    }
  }

  // Measurement mutators -- pure functional updates, so these are safe to
  // call from the map's once-registered click/contextmenu handlers (they
  // close over stale state, but never over a stale setMeasure identity).
  function addMeasurePoint(point: [number, number]) {
    // A fresh point always clears the redo stack -- the standard undo/redo
    // convention (redoing after a new action would silently discard it).
    setMeasure((m) => ({ points: [...m.points, point], redo: [] }))
  }
  function undoMeasurePoint() {
    setMeasure((m) =>
      m.points.length === 0
        ? m // nothing to undo -- stay in measure mode rather than exiting it
        : {
            points: m.points.slice(0, -1),
            redo: [...m.redo, m.points[m.points.length - 1]],
          },
    )
  }
  function redoMeasurePoint() {
    setMeasure((m) =>
      m.redo.length === 0
        ? m
        : { points: [...m.points, m.redo[m.redo.length - 1]], redo: m.redo.slice(0, -1) },
    )
  }
  function exitMeasureMode() {
    setMeasuring(false)
    setMeasure({ points: [], redo: [] })
    clearPreview()
  }

  function setSourceData(sourceId: string, features: Feature[]) {
    const src = mapRef.current?.getSource(sourceId)
    if (src && 'setData' in src) {
      ;(src as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    }
  }

  // Rubber-band preview -- the tentative segment from the last committed
  // point to the live cursor position. Written directly from the map's
  // mousemove handler, never through React state.
  function setPreview(from: [number, number], to: [number, number]) {
    setSourceData('measure-preview', [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [from, to] },
      },
    ])
    const midpoint: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    const label = formatDistance(haversineDistanceM(from, to))
    setSourceData('measure-preview-label', [
      {
        type: 'Feature',
        properties: { label },
        geometry: { type: 'Point', coordinates: midpoint },
      },
    ])
  }
  function clearPreview() {
    setSourceData('measure-preview', [])
    setSourceData('measure-preview-label', [])
  }

  // Redraws the committed measurement (markers, path, per-segment labels)
  // whenever the point list changes -- the single source of truth for
  // committed geometry, replacing the old per-click imperative updates.
  // Also mirrors the points into measurePointsRef for the map's mousemove
  // handler (registered once on mount, so it can't read `measure` state
  // directly).
  useEffect(() => {
    measurePointsRef.current = measure.points
    const map = mapRef.current
    if (!map || !map.getSource('measure-line')) return

    measureMarkersRef.current.forEach((m) => m.remove())
    measureMarkersRef.current = measure.points.map((pt) =>
      new Marker({ element: makeMeasurePointElement() }).setLngLat(pt).addTo(map),
    )

    setSourceData(
      'measure-line',
      measure.points.length >= 2
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: measure.points },
            },
          ]
        : [],
    )

    setSourceData(
      'measure-label',
      measure.points.slice(1).map((b, i) => {
        const a = measure.points[i]
        const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        return {
          type: 'Feature',
          properties: { label: formatDistance(haversineDistanceM(a, b)) },
          geometry: { type: 'Point', coordinates: midpoint },
        }
      }),
    )
  }, [measure.points])

  // Keeps measuringRef in sync for the map handlers above (registered once
  // on mount, so they can't read `measuring` state directly), swaps the
  // cursor to a crosshair while active, and disables double-click-to-zoom
  // (a double-click while measuring would otherwise zoom the map AND drop
  // two points in the same gesture).
  useEffect(() => {
    measuringRef.current = measuring
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = measuring ? 'crosshair' : ''
    if (measuring) map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }, [measuring])

  // Keeps selectedSectorRef in sync for the map's 'contextmenu' handler above
  // (registered once on mount, so it can't read `selectedSector` state directly).
  useEffect(() => {
    selectedSectorRef.current = selectedSector
  }, [selectedSector])

  // Keyboard shortcuts while measuring: Escape exits the mode entirely,
  // Ctrl/Cmd+Z undoes the last point, Ctrl+Y or Ctrl/Cmd+Shift+Z redoes.
  // Only registered while measuring, and skipped when a text input has
  // focus so it doesn't hijack the search box.
  useEffect(() => {
    if (!measuring) return
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (e.key === 'Escape') {
        exitMeasureMode()
        return
      }
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoMeasurePoint()
        clearPreview()
      } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redoMeasurePoint()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutators close over stable setMeasure/setMeasuring identities
  }, [measuring])

  // Layer visibility -- reacts to toggling the sidebar's switches, and also
  // catches the one-time swap from SSR-safe defaults to the
  // localStorage-restored value performed by the mount effect above (which
  // changes `visibility` identity, so this effect re-runs and reconciles the
  // map to match).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    applyLayerVisibility(map, visibility)
  }, [visibility])

  // Sector filter (also drives fly-to when a single sector is chosen)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('sector-plan-fill')) return

    const sectorFilter =
      selectedSector === 'all' ? null : ['==', ['get', 'sector_no'], selectedSector]

    // A feature matches if its class_group is fully selected, OR its exact
    // (class_group, subclass) pair is individually selected via a partial
    // class's sub-class checkboxes. No selection at all (both empty) means
    // "show everything", same as classFilter alone used to mean.
    const subclassPairs = Object.entries(subclassFilter).flatMap(([cls, subs]) =>
      subs.map((sub) => [cls, sub]),
    )
    const classCondition =
      classFilter.length === 0
        ? null
        : classFilter.length === 1
          ? ['==', ['get', 'class_group'], classFilter[0]]
          : ['in', ['get', 'class_group'], ['literal', classFilter]]
    const subclassCondition =
      subclassPairs.length === 0
        ? null
        : [
            'any',
            ...subclassPairs.map(([cls, sub]) => [
              'all',
              ['==', ['get', 'class_group'], cls],
              ['==', ['get', 'subclass'], sub],
            ]),
          ]
    const classOrSubclassCondition =
      classCondition && subclassCondition
        ? ['any', classCondition, subclassCondition]
        : (classCondition ?? subclassCondition)

    const combined = [sectorFilter, classOrSubclassCondition].filter(Boolean) as unknown[]
    const finalFilter =
      combined.length === 0 ? null : combined.length === 1 ? combined[0] : ['all', ...combined]

    map.setFilter('sector-plan-fill', finalFilter as FilterSpecification | null)
    // Always kept identical to sector-plan-fill's own filter -- see where
    // sector-plan-hit-target is created (in initMap) for why this invisible
    // twin exists; if its filter ever drifted from the fill's, a click on a
    // now-filtered-out parcel could still register as a parcel-detail hit
    // instead of correctly falling through to sector selection.
    if (map.getLayer('sector-plan-hit-target')) {
      map.setFilter('sector-plan-hit-target', finalFilter as FilterSpecification | null)
    }
    // The class hairline is the other half of sector-plan-fill's paint job
    // (see SECTOR_FILL_OPACITY's note) -- it must track the exact same
    // filter or a filtered-out parcel would keep its coloured edge with no
    // fill behind it, reading as a ghost outline.
    if (map.getLayer('sector-plan-class-outline')) {
      map.setFilter('sector-plan-class-outline', finalFilter as FilterSpecification | null)
    }

    // Visual emphasis (glow + outline) tracks the exact same combined
    // filter as the fill itself -- only shown at all once a class/sub-class
    // filter is actually narrowing things down (a bare sector selection
    // with no class filter shouldn't outline literally everything in it).
    const emphasisActive = !!classOrSubclassCondition
    const NEVER_MATCH: FilterSpecification = ['==', ['get', 'id'], -1]
    const emphasisFilter = emphasisActive ? (finalFilter as FilterSpecification) : NEVER_MATCH
    if (map.getLayer('sector-plan-filter-glow')) {
      map.setFilter('sector-plan-filter-glow', emphasisFilter)
    }
    if (map.getLayer('sector-plan-filter-outline')) {
      map.setFilter('sector-plan-filter-outline', emphasisFilter)
    }
    // With "Sector plan" toggled off, sector-plan-fill's own layout
    // visibility (driven by the applyLayerVisibility effect, keyed only on
    // the sidebar toggles) is 'none' -- so a class/sub-class filter alone
    // used to leave you with just the thin emphasis outline and no fill,
    // even though the filter clearly means "show me these parcels". Once a
    // class filter narrows things down, force the fill (and its matching
    // hit-target) visible regardless of the toggle; with no filter active
    // this falls back to the toggle exactly as before.
    if (map.getLayer('sector-plan-fill')) {
      map.setLayoutProperty(
        'sector-plan-fill',
        'visibility',
        emphasisActive || visibility.sector_plan ? 'visible' : 'none',
      )
    }
    if (map.getLayer('sector-plan-class-outline')) {
      map.setLayoutProperty(
        'sector-plan-class-outline',
        'visibility',
        emphasisActive || visibility.sector_plan ? 'visible' : 'none',
      )
    }
    if (map.getLayer('sector-plan-hit-target')) {
      map.setLayoutProperty(
        'sector-plan-hit-target',
        'visibility',
        emphasisActive || visibility.sector_plan ? 'visible' : 'none',
      )
    }
    // Dim the basemap so the (now outlined/glowing) matched parcels read as
    // the obvious focus instead of competing with road/label clutter --
    // fill-opacity alone stops being a distinguishing signal once the map is
    // already filtered down to a single class. A black scrim above the
    // vendored vector basemap (but below sector_plan/road/POI) darkens it
    // consistently in both light and dark mode, unlike blending toward a
    // fixed color which would read as lightening in dark mode.
    if (map.getLayer('basemap-dim-scrim')) {
      map.setPaintProperty('basemap-dim-scrim', 'background-opacity', emphasisActive ? 0.45 : 0)
    }

    // road-line is one shared layer for all 3 road types -- which ones
    // actually draw is expressed here as a `type` filter (not layout
    // visibility, which applyLayerVisibility already uses to hide the whole
    // layer when none are on), ANDed with the sector filter like everything
    // else on this source.
    const onTypes = ROAD_TYPE_DEFS.filter((d) => visibility[d.key]).map((d) => d.type)
    const roadTypeCondition =
      onTypes.length === 0 || onTypes.length === ROAD_TYPE_DEFS.length
        ? null
        : ['in', ['get', 'type'], ['literal', onTypes]]
    const roadCombined = [sectorFilter, roadTypeCondition].filter(Boolean) as unknown[]
    const roadFilter =
      roadCombined.length === 0
        ? null
        : roadCombined.length === 1
          ? roadCombined[0]
          : ['all', ...roadCombined]
    map.setFilter('road-line', roadFilter as FilterSpecification | null)

    const selectedSectorFilter = (
      selectedSector === 'all'
        ? ['==', ['get', 'sector_no'], -1]
        : ['==', ['get', 'sector_no'], selectedSector]
    ) as FilterSpecification
    if (map.getLayer('sector-selected-outline')) {
      map.setFilter('sector-selected-outline', selectedSectorFilter)
    }
    // Same filter as sector-selected-outline -- see where sector-selected-glow
    // is created (in initMap) for why this dark-mode-only halo exists.
    if (map.getLayer('sector-selected-glow')) {
      map.setFilter('sector-selected-glow', selectedSectorFilter)
    }

    if (selectedSector !== 'all') {
      const s = sectors.find((x) => x.sector_no === selectedSector)
      if (s) {
        map.fitBounds(
          [
            [s.xmin, s.ymin],
            [s.xmax, s.ymax],
          ],
          // Extra left padding accounts for the "Kumbh Mela" panel docked
          // over the map's left edge (w-72 + its offset, ~320px) -- plain
          // symmetric padding fits the sector to the map's full width and
          // leaves its left edge hidden behind the panel.
          { padding: mapFlyPadding(), maxZoom: 16, duration: 800 },
        )
      }
    }
  }, [selectedSector, classFilter, subclassFilter, sectors, visibility])

  // POI sub-class filter -- narrows individual POI layers to a subset of
  // their subclass values, for the 4 layers that have one (see
  // POI_SUBCLASS_COLUMNS). Independent of layout visibility
  // (applyLayerVisibility's job) and independent of the sector/class filter
  // effect above -- POI layers were never sector-scoped on the map layer
  // itself, only in /api/stats's server-side aggregation, so this is the
  // first filter expression ever applied to poi-* layers, not an extension
  // of one.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      // Read through the ref, not the closed-over value: when this runs from
      // the deferred styledata branch below it may be several selections
      // behind, and reapplying that stale snapshot would undo the newest one.
      const latest = poiSubclassFilterRef.current
      for (const [layerKey, column] of Object.entries(POI_SUBCLASS_COLUMNS)) {
        const subs = latest[layerKey]
        const isClustered = POI_LAYER_DEFS.find((d) => d.key === layerKey)?.geomType === 'point'

        if (isClustered) {
          // amenities/sanitation are clustered point layers (see initMap) --
          // clustering happens client-side over the layer's full raw dataset
          // (clusterPoints in src/lib/poiClustering.ts), so a cluster's
          // point_count can never be made to reflect an active sub-class
          // filter via setFilter alone (a filtered-out point would still
          // count toward its cluster). Instead, /api/poi/points/[layer]
          // itself is re-queried scoped to just the selected sub-classes,
          // re-clustered, and swapped in via setData() -- so clusters only
          // ever contain matching points and their counts stay exactly
          // correct. See refetchClusteredPoiSource above.
          void refetchClusteredPoiSource(map, layerKey, subs, poiRawFeaturesRef)
          continue
        }

        const filter: FilterSpecification | null =
          subs && subs.length > 0
            ? (['in', ['get', column], ['literal', subs]] as unknown as FilterSpecification)
            : null
        // Every layer id a POI def can create for the same source, since a
        // sub-class filter has to hide the feature outright, not just one of
        // the strokes drawn for it -- polygon POIs (ashram, tentcity,
        // public_service_facilities) paint a fill AND a separate -outline
        // line layer, so filtering only the fill left every non-matching
        // ashram still outlined on the map. -glow/-casing are the line
        // equivalents (entry_exit_line, tertiary_road); -hit/-label cover the
        // point layers' invisible click target and signage badge.
        for (const suffix of ['', '-outline', '-glow', '-casing', '-hit', '-label'] as const) {
          const id = `poi-${layerKey}${suffix}`
          if (map.getLayer(id)) map.setFilter(id, filter)
        }
      }
    }

    // Deliberately NOT gated on isStyleLoaded(). The click that picks a
    // sub-class also makes the layer visible and flies the map, so tiles are
    // usually still streaming here and isStyleLoaded() reads false -- but it
    // can stay false indefinitely once the map settles, and no further
    // styledata ever arrives. Gating on it (or deferring to styledata) meant
    // the filter was simply never applied and every sub-class kept rendering.
    // setFilter is safe on an existing layer regardless of tile state, and
    // each call is already guarded by map.getLayer, so applying straight away
    // is both correct and the only thing that reliably lands.
    apply()

    // The layers themselves are created in the 'load' handler, so a selection
    // restored before that (or made during the very first paint) can land
    // before there is anything to filter. Re-apply once on styledata to cover
    // that startup window; it's a no-op when apply() above already succeeded.
    map.once('styledata', apply)
    return () => {
      map.off('styledata', apply)
    }
  }, [poiSubclassFilter])

  // "Only inside sector area" for tertiary_road -- see tertiaryRoadSectorOnly's
  // declaration. Independent of the subclass-filter effect above since
  // in_sector isn't a subclass column; this is the only POI line layer with
  // its own per-layer filter toggle in the panel.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const filter: FilterSpecification | null = tertiaryRoadSectorOnly
      ? (['==', ['get', 'in_sector'], true] as FilterSpecification)
      : null
    // Applied to both the core line and its casing (see TERTIARY_ROAD_STYLE)
    // -- filtering only the core would leave the wider pale/navy border
    // visible everywhere regardless of the toggle, since the two are
    // separate layers over the same unfiltered source.
    for (const id of ['poi-tertiary_road', 'poi-tertiary_road-casing']) {
      if (map.getLayer(id)) map.setFilter(id, filter)
    }
  }, [tertiaryRoadSectorOnly])

  // Fetches bbox/feature centroids for every open class/sub-class locator
  // list (opened by a row's pin icon in the Stats panel) and flies the map to
  // fit whichever one was just opened. Several can be open at once, so this
  // only ever fetches keys it hasn't already got.
  //
  // Results for closed rows are deliberately NOT pruned: locateTargets alone
  // decides what renders, so a leftover entry is invisible, and keeping it
  // makes reopening the same row instant instead of refetching. The map is
  // bounded by how many rows exist, so it can't grow without limit.
  useEffect(() => {
    let cancelled = false
    for (const target of locateTargets) {
      const sector = selectedSector === 'all' ? null : selectedSector
      const key = locateKey(target.classGroup, target.subclass, sector)
      // Already fetched, or a fetch is already in flight -- a ref (not state)
      // tracks this so the effect body never calls setState synchronously.
      if (locateFetchedRef.current.has(key)) continue
      locateFetchedRef.current.add(key)
      const params = new URLSearchParams({ class_group: target.classGroup })
      if (target.subclass !== null) params.set('subclass', target.subclass)
      // Scoped to the selected sector so the list matches the count above it:
      // /api/stats is sector-scoped and the section reads "(this sector)", so
      // an unscoped locator list contradicted its own heading and flew the
      // planner clean out of the sector they had filtered to.
      if (sector !== null) params.set('sector', String(sector))
      fetch(`/api/sector-plan/locate?${params}`)
        .then((r) => {
          if (!r.ok) throw new Error(`locate failed: ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (cancelled) return
          setLocateResults((prev) => ({
            ...prev,
            [key]: {
              classGroup: target.classGroup,
              subclass: target.subclass,
              total: data.total ?? 0,
              bbox: data.bbox ?? null,
              features: data.features ?? [],
            },
          }))
          const map = mapRef.current
          if (map && data.bbox) {
            const [xmin, ymin, xmax, ymax] = data.bbox as [number, number, number, number]
            map.fitBounds(
              [
                [xmin, ymin],
                [xmax, ymax],
              ],
              // Same left padding as the sector fitBounds above (accounts for
              // the docked "Kumbh Mela" panel), but a lower maxZoom -- a
              // single-parcel bbox would otherwise zoom in tighter than is
              // useful for orienting on where the parcel actually is.
              { padding: mapFlyPadding(), maxZoom: 15, duration: 800 },
            )
          }
        })
        .catch(() => {
          // Let a failed fetch be retried the next time the row is opened.
          locateFetchedRef.current.delete(key)
          if (!cancelled) {
            // Records the failure rather than deleting the key. A missing key
            // reads as `null`, which the panel cannot tell apart from "still
            // loading" -- so a failed locate used to leave the row spinning
            // forever with no way to find out why.
            setLocateResults((prev) => ({ ...prev, [key]: 'error' }))
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [locateTargets, selectedSector, locateRetryNonce])

  /** Flies the map to one specific matched feature (from the Stats panel's
   *  locator list) at a close, readable zoom -- the point of the list is
   *  visiting one result at a time instead of relying on the (possibly
   *  wide, for scattered matches) bbox fit above. */
  function flyToLocateFeature(lng: number, lat: number) {
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: 17,
      padding: mapFlyPadding(),
      duration: 700,
    })
  }

  /** Fetches just the bbox for a class/sub-class (sector_plan) or POI layer/
   *  sub-class and flies the map to fit it -- fire-and-forget, no state
   *  update, so it never opens the Stats panel's locator list (that's
   *  locateTarget/poiLocateTarget's job via the row's pin icon). Fired
   *  whenever a class/subclass/layer row is clicked to select it: the zoom
   *  is expected every time a selection changes, same as before locate and
   *  selection were split into two independent actions, but with none of
   *  the "resolves to exactly one target" gymnastics now that several rows
   *  can be selected at once -- this only ever fits the ONE row just
   *  clicked, regardless of what else is already selected. */
  /** Appends the selected sector to a locate URL. Every fly-to must be scoped
   *  the same way the locator lists are, or checking a class while zoomed to
   *  one sector fits the bbox of that class across the whole mela and throws
   *  the planner out of the area they are working in. Centralised here rather
   *  than at each call site precisely because the call sites had drifted. */
  function withSector(url: string): string {
    if (selectedSector === 'all') return url
    return `${url}${url.includes('?') ? '&' : '?'}sector=${selectedSector}`
  }

  // Clears the notice a few seconds after it appears. An effect (not a
  // setTimeout at the call site) so a second notice replaces the first
  // cleanly instead of the older timer cutting the newer message short.
  useEffect(() => {
    if (mapNotice === null) return
    const t = setTimeout(() => setMapNotice(null), 3200)
    return () => clearTimeout(t)
  }, [mapNotice])

  function flyToBbox(url: string, label?: string) {
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const map = mapRef.current
        if (!data.bbox) {
          // Nothing to fly to. Silent before, which read as a dead click.
          setMapNotice({
            id: Date.now(),
            text: label
              ? `No ${label} in ${selectedSector === 'all' ? 'this area' : `Sector ${selectedSector}`}`
              : 'Nothing to show here',
          })
          return
        }
        if (map && data.bbox) {
          const [xmin, ymin, xmax, ymax] = data.bbox as [number, number, number, number]
          map.fitBounds(
            [
              [xmin, ymin],
              [xmax, ymax],
            ],
            { padding: mapFlyPadding(), maxZoom: 15, duration: 800 },
          )
        }
      })
      .catch(() => {})
  }

  // POI equivalent of the class locator effect above -- several POI layer or
  // sub-class lists can be open at once, each fetched once and keyed by
  // locateKey.
  useEffect(() => {
    let cancelled = false
    for (const target of poiLocateTargets) {
      const sector = selectedSector === 'all' ? null : selectedSector
      const key = locateKey(target.layer, target.subclass, sector)
      if (poiLocateFetchedRef.current.has(key)) continue
      poiLocateFetchedRef.current.add(key)
      const params = new URLSearchParams({ layer: target.layer })
      if (target.subclass !== null) params.set('subclass', target.subclass)
      // Same sector scoping as the class locate above -- see its comment.
      if (sector !== null) params.set('sector', String(sector))
      fetch(`/api/poi/locate?${params}`)
        .then((r) => {
          if (!r.ok) throw new Error(`locate failed: ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (cancelled) return
          setPoiLocateResults((prev) => ({
            ...prev,
            [key]: {
              layer: target.layer,
              subclass: target.subclass,
              total: data.total ?? 0,
              bbox: data.bbox ?? null,
              features: data.features ?? [],
            },
          }))
          const map = mapRef.current
          if (map && data.bbox) {
            const [xmin, ymin, xmax, ymax] = data.bbox as [number, number, number, number]
            map.fitBounds(
              [
                [xmin, ymin],
                [xmax, ymax],
              ],
              { padding: mapFlyPadding(), maxZoom: 15, duration: 800 },
            )
          }
        })
        .catch(() => {
          poiLocateFetchedRef.current.delete(key)
          if (!cancelled) {
            // See the class locate's catch -- a sentinel, not a delete.
            setPoiLocateResults((prev) => ({ ...prev, [key]: 'error' }))
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [poiLocateTargets, selectedSector, locateRetryNonce])

  /** Whole-layer POI row/checkbox click (Stats panel row or left search
   *  panel's main checkbox) -- toggles the layer's visibility (existing
   *  behavior) and, when that turns it on, also sets it as the locate
   *  target so the map flies to fit it and the panel shows its locator
   *  list. Clicking an already-visible row just turns it off, same as
   *  before, and clears any locate result for it. Now also always resolves
   *  to a clean fully-on-or-off state, clearing any partial
   *  poiSubclassFilter entry either way -- same as toggleClassFilter
   *  dropping subclassFilter[c] on a whole-class click, so the two
   *  selection modes never fight. */
  function togglePoiLayerFilter(layerKey: string) {
    // Tri-state parent, mirroring toggleClassFilter: a layer narrowed to some
    // sub-classes promotes to the whole layer rather than switching off, so a
    // partial selection is widened instead of silently discarded.
    const hasPartial = (poiSubclassFilter[layerKey]?.length ?? 0) > 0
    const turningOn = hasPartial || !visibility[layerKey]
    setVisibility((v) => ({ ...v, [layerKey]: turningOn }))
    setPoiSubclassFilter((prev) => {
      if (!(layerKey in prev)) return prev
      const next = { ...prev }
      delete next[layerKey]
      return next
    })
    // A hidden layer showing a stale locator list makes no sense -- close any
    // list belonging to the layer just turned off (other layers' open lists
    // are untouched).
    if (!turningOn) {
      setPoiLocateTargets((prev) => prev.filter((t) => t.layer !== layerKey))
    }
    // Zoom to the layer whenever it's turned on -- same "clicking a row flies
    // you there" expectation as before locate/selection were split, but as a
    // one-off fetch that doesn't touch poiLocateTargets/open the locator list.
    if (turningOn)
      flyToBbox(
        withSector(`/api/poi/locate?layer=${encodeURIComponent(layerKey)}`),
        POI_LAYER_DEFS.find((d) => d.key === layerKey)?.label ?? layerKey,
      )
  }

  /** Toggling a POI sub-class checkbox -- same interaction model as
   *  toggleSubclassFilter, adapted for POI's flat on/off visibility[key]
   *  boolean instead of classFilter's array membership. Shared by the left
   *  search panel's filter tree AND the Stats panel's sub-class rows -- both
   *  are genuine multi-select checkboxes now (Temple and Mosque can both be
   *  checked at once from either place):
   *  - Layer currently off: picking any one subclass turns it on, scoped to
   *    just that subclass (fresh partial selection).
   *  - Layer fully on (no subclass filter yet): picking one subclass "splits"
   *    it into a partial selection containing every OTHER subclass, so
   *    nothing visually changes except the one just unchecked.
   *  - Unchecking the last remaining subclass in a partial selection turns
   *    the whole layer off rather than leaving an empty-but-on phantom
   *    state -- there's no tri-state "on but showing nothing" concept here,
   *    same as there's none for a fully-deselected class.
   *  Deliberately does not touch poiLocateTarget: the locator list is opened
   *  by a row's own "show list" chevron now (see onToggleLocate below), not
   *  derived from what's selected, so toggling a checkbox never yanks the
   *  viewport or opens/closes a list on its own. */
  function togglePoiSubclassFilter(layerKey: string, sub: string) {
    const wasFullyOn = visibility[layerKey] && !poiSubclassFilter[layerKey]
    const current = poiSubclassFilter[layerKey] ?? (wasFullyOn ? poiSubclassNames(layerKey) : [])
    const isSelecting = !current.includes(sub)
    const next = isSelecting ? [...current, sub] : current.filter((x) => x !== sub)

    if (next.length === 0) {
      setVisibility((v) => ({ ...v, [layerKey]: false }))
      setPoiSubclassFilter((prev) => {
        const copy = { ...prev }
        delete copy[layerKey]
        return copy
      })
      return
    }

    setVisibility((v) => (v[layerKey] ? v : { ...v, [layerKey]: true }))
    setPoiSubclassFilter((prev) => ({ ...prev, [layerKey]: next }))
    // Zoom to just the sub-class just checked -- mirrors togglePoiLayerFilter,
    // fired only when checking one on (unchecking shouldn't yank the view
    // away), and always scoped to this one sub-class regardless of how many
    // others are already selected.
    if (isSelecting) {
      const params = new URLSearchParams({ layer: layerKey, subclass: sub })
      flyToBbox(withSector(`/api/poi/locate?${params}`), sub)
    }
  }

  /** Clicking a POI row's pin icon in the Stats panel -- fetches and displays
   *  that layer/sub-class's feature list, flying the map to fit it.
   *  Independent of poiSubclassFilter/visibility (the checkbox selection
   *  above): a sub-class can be listed without being selected, or selected
   *  without its list open. Several lists stay open at once so two layers can
   *  be compared side by side; clicking an already-open row's pin closes just
   *  that one. */
  function togglePoiLocate(layerKey: string, sub: string | null) {
    setPoiLocateTargets((prev) =>
      prev.some((t) => t.layer === layerKey && t.subclass === sub)
        ? prev.filter((t) => !(t.layer === layerKey && t.subclass === sub))
        : [...prev, { layer: layerKey, subclass: sub }],
    )
  }

  function toggleExpandedFilterPoi(layerKey: string) {
    setExpandedFilterPois((prev) => {
      const next = new Set(prev)
      if (next.has(layerKey)) next.delete(layerKey)
      else next.add(layerKey)
      return next
    })
  }

  /** All known sub-class names for a POI layer, from the fetched stats --
   *  mirrors classSubclassNames. Empty for the 12 layers with no subclass
   *  column (POI_SUBCLASS_COLUMNS doesn't include them, so poiSubclassStats
   *  never has rows for them either). */
  function poiSubclassNames(layerKey: string): string[] {
    return poiSubclassStats.filter((r) => r.layer === layerKey).map((r) => r.subclass)
  }

  const classGroups = Object.keys(CLASS_GROUP_COLORS).sort((a, b) => a.localeCompare(b))

  function toggleClassFilter(c: string) {
    // Tri-state parent, so a partial sub-class selection is never silently
    // discarded: a class with SOME sub-classes checked promotes to the whole
    // class (the partial entry is superseded, not thrown away -- everything
    // it covered is still selected). Only a fully-selected class clears.
    const hasPartial = (subclassFilter[c]?.length ?? 0) > 0
    const isSelecting = hasPartial || !classFilter.includes(c)
    setClassFilter((prev) =>
      isSelecting ? (prev.includes(c) ? prev : [...prev, c]) : prev.filter((x) => x !== c),
    )
    // The whole-class selection subsumes any partial picks within it, so the
    // partial entry is dropped either way -- but promoting rather than
    // clearing means the user's narrower picks are widened, never lost.
    setSubclassFilter((prev) => {
      if (!(c in prev)) return prev
      const next = { ...prev }
      delete next[c]
      return next
    })
    // Zoom to the class whenever it's checked on -- mirrors
    // togglePoiLayerFilter's flyToBbox call, fired as a one-off fetch that
    // doesn't touch locateTarget/open the locator list.
    if (isSelecting)
      flyToBbox(withSector(`/api/sector-plan/locate?class_group=${encodeURIComponent(c)}`), c)
  }

  function toggleSubclassFilter(cls: string, sub: string) {
    // Toggling a sub-class while its whole class is checked "splits off"
    // that class into a partial selection: every other sub-class stays
    // implicitly selected (classFilter no longer includes it, but every
    // sibling sub-class is added explicitly so nothing visually changes)
    // except the one just unchecked. If the class wasn't selected at all
    // (no filter active), the click instead starts a fresh partial
    // selection containing just that one sub-class.
    const wasFullyChecked = classFilter.includes(cls)
    const current = subclassFilter[cls] ?? (wasFullyChecked ? classSubclassNames(cls) : [])
    const isSelecting = !current.includes(sub)
    setClassFilter((prev) => prev.filter((x) => x !== cls))
    setSubclassFilter((prev) => {
      const next = isSelecting ? [...current, sub] : current.filter((x) => x !== sub)
      return { ...prev, [cls]: next }
    })
    // Zoom to just the sub-class just checked -- mirrors
    // togglePoiSubclassFilter, fired only when checking one on.
    if (isSelecting) {
      const params = new URLSearchParams({ class_group: cls, subclass: sub })
      flyToBbox(withSector(`/api/sector-plan/locate?${params}`), sub)
    }
  }

  /** Clicking a class/sub-class row's pin icon in the Stats panel's
   *  Area-by-class table -- mirrors togglePoiLocate, including keeping
   *  several lists open at once. */
  /** Clears a failed locate's error sentinel so the fetch effect re-runs for
   *  that row. Retrying cannot go through toggleLocate: the row is still open
   *  when the error shows, so toggling would close it instead of retrying. */
  function retryLocate(classGroup: string, subclass: string | null) {
    const key = locateKey(classGroup, subclass, selectedSector === 'all' ? null : selectedSector)
    locateFetchedRef.current.delete(key)
    setLocateResults((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setLocateRetryNonce((n) => n + 1)
  }

  function retryPoiLocate(layerKey: string, subclass: string | null) {
    const key = locateKey(layerKey, subclass, selectedSector === 'all' ? null : selectedSector)
    poiLocateFetchedRef.current.delete(key)
    setPoiLocateResults((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setLocateRetryNonce((n) => n + 1)
  }

  function toggleLocate(classGroup: string, subclass: string | null) {
    setLocateTargets((prev) =>
      prev.some((t) => t.classGroup === classGroup && t.subclass === subclass)
        ? prev.filter((t) => !(t.classGroup === classGroup && t.subclass === subclass))
        : [...prev, { classGroup, subclass }],
    )
  }

  function clearAllFilters() {
    setClassFilter([])
    setSubclassFilter({})
    setVisibility((v) => {
      const next = { ...v }
      for (const d of ROAD_TYPE_DEFS) next[d.key] = false
      for (const d of POI_LAYER_DEFS) next[d.key] = false
      return next
    })
    // Without this, a POI layer's partial sub-class selection survives being
    // turned off here -- re-enabling that layer later (e.g. from the Layers
    // list) would silently come back already scoped to whatever subset was
    // last checked instead of fully on, which doesn't match what "Clear all"
    // implies for every other filter it resets.
    setPoiSubclassFilter({})
    // The locate targets only drive the Stats panel's locator lists, not
    // anything painted on the map, but every layer/class is being cleared
    // above -- leaving stale targets means lists can keep showing results
    // for things that are no longer shown.
    setPoiLocateTargets([])
    setLocateTargets([])
  }

  function selectAllClasses() {
    setClassFilter(classGroups)
    setSubclassFilter({})
  }

  function selectAllRoads() {
    setVisibility((v) => {
      const next = { ...v }
      for (const d of ROAD_TYPE_DEFS) next[d.key] = true
      return next
    })
  }

  function selectAllPois() {
    setVisibility((v) => {
      const next = { ...v }
      for (const d of POI_LAYER_DEFS) next[d.key] = true
      return next
    })
    setPoiSubclassFilter({})
  }

  function toggleExpandedFilterClass(cls: string) {
    setExpandedFilterClasses((prev) => {
      const next = new Set(prev)
      if (next.has(cls)) next.delete(cls)
      else next.add(cls)
      return next
    })
  }

  /** All known sub-class names for a class, from the fetched stats -- used
   *  as the starting point when a class goes from "fully selected" to
   *  "partially selected" via a single sub-class checkbox click. */
  function classSubclassNames(cls: string): string[] {
    // Null subclasses (see subclassStats' own comment for why they exist)
    // aren't a real selectable sub-class in the UI, so they're dropped here
    // rather than propagated into subclassFilter's string[] selections.
    return subclassStats
      .filter((r) => r.class_group === cls && r.subclass !== null)
      .map((r) => r.subclass as string)
  }

  const baseLayerRows: Array<{
    key: string
    label: string
    icon: typeof ParcelIcon
    theme: 'blue' | 'teal'
  }> = [
    { key: 'sector_plan', label: 'Sector plan', icon: ParcelIcon, theme: 'blue' },
    { key: 'sector_boundary', label: 'Boundaries', icon: GridIcon, theme: 'teal' },
  ]
  // --- Unified search panel -------------------------------------------
  // Merges what used to be three separate widgets (SECTOR box, CLASS box,
  // LAYERS/"More layers" disclosure) into one grouped, searchable list.
  // Nothing new is fetched here -- every group is built from state/constants
  // that already existed for the old widgets (sectors, classGroups,
  // ROAD_TYPE_DEFS, POI_LAYER_DEFS, baseLayerRows).
  type SearchGroupName =
    'Jump to sector' | 'Sector classes' | 'Roads' | 'POI layers' | 'Base layers'

  const q = query.trim().toLowerCase()
  function matchesQuery(...labels: string[]): boolean {
    if (!q) return true
    return labels.some((l) => l.toLowerCase().includes(q))
  }

  const searchGroups: Array<{ group: SearchGroupName; rows: number }> = []
  const matchedSectors = sectors.filter((s) => matchesQuery(s.name))
  const matchedClasses = classGroups.filter((c) => matchesQuery(c, ...classSubclassNames(c)))
  const matchedRoads = ROAD_TYPE_DEFS.filter((d) => matchesQuery(d.label))
  const matchedPois = POI_LAYER_DEFS.filter((d) =>
    matchesQuery(d.label, ...poiSubclassNames(d.key)),
  )
  const matchedBaseLayers = baseLayerRows.filter((b) => matchesQuery(b.label))
  if (matchedSectors.length > 0)
    searchGroups.push({ group: 'Jump to sector', rows: matchedSectors.length })
  if (matchedClasses.length > 0)
    searchGroups.push({ group: 'Sector classes', rows: matchedClasses.length })
  if (matchedRoads.length > 0) searchGroups.push({ group: 'Roads', rows: matchedRoads.length })
  if (matchedPois.length > 0) searchGroups.push({ group: 'POI layers', rows: matchedPois.length })
  if (matchedBaseLayers.length > 0)
    searchGroups.push({ group: 'Base layers', rows: matchedBaseLayers.length })

  function toggleCollapsedGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }
  function isGroupCollapsed(group: string) {
    // While actively searching, every matching group is always expanded --
    // collapsedGroups only governs the empty-query browse view.
    return q === '' && collapsedGroups.has(group)
  }

  const groupIcon: Record<SearchGroupName, typeof ParcelIcon> = {
    'Jump to sector': LayersIcon,
    'Sector classes': TagIcon,
    Roads: RoadIcon,
    'POI layers': MapPinIcon,
    'Base layers': GridIcon,
  }
  const groupTheme: Record<SearchGroupName, 'blue' | 'teal' | 'amber' | 'violet'> = {
    'Jump to sector': 'blue',
    'Sector classes': 'teal',
    Roads: 'amber',
    'POI layers': 'violet',
    'Base layers': 'teal',
  }

  const measureTotalM = measure.points
    .slice(1)
    .reduce((sum, b, i) => sum + haversineDistanceM(measure.points[i], b), 0)

  return (
    <div className="kumbh-map relative h-screen w-full overflow-hidden">
      <div ref={mapContainer} className="h-full w-full" />

      {/* Transient notice -- see mapNotice. Centred over the map rather than
          in a panel because it explains why the map did not move, and the
          click that triggered it may have come from either panel. */}
      {mapNotice && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full px-3 py-1.5 text-[12.5px] font-medium shadow-lg"
          style={{
            background: 'var(--map-surface)',
            color: 'var(--map-fg)',
            border: '1px solid var(--map-border)',
          }}
        >
          {mapNotice.text}
        </div>
      )}

      {/* Measure distance -- floating button cluster beside the hamburger
          menu (SidebarToggle sits at left-4 top-4, h-10 w-10) rather than
          inside the left panel, so it's reachable without opening the
          panel. Undo/redo appear beside it only while measuring. */}
      {/* max-w reserves room on the right so this row never runs into the collapsed Stats pill
          sharing the same top strip. This element itself starts at left-16 (64px), and max-w is
          measured from ITS OWN left edge, not the viewport's -- so to keep a 168px gap between
          this row's right edge and the viewport's right edge (clearing Stats' collapsed
          max-sm:w-36 pill: 144px + 12px right-3 offset + 12px breathing room), the class needs
          100vw minus that 168px minus the 64px this row is already offset by. The first attempt
          at this only subtracted the 168px and re-introduced the exact overlap it was meant to
          fix (confirmed via measured DOM rects: Redo's right edge landed 14px past Stats' left
          edge). sm+ uses the old flat 72px margin, which was never the affected case. */}
      <div className="fixed left-16 top-4 z-30 flex max-w-[calc(100vw-232px)] items-center gap-1.5 sm:max-w-[calc(100vw-72px)]">
        <button
          type="button"
          onClick={() => (measuring ? exitMeasureMode() : setMeasuring(true))}
          aria-pressed={measuring}
          aria-label="Measure distance"
          title="Measure distance"
          style={
            measuring
              ? {
                  borderColor: 'var(--danger-soft)',
                  background: 'var(--danger-soft)',
                  color: 'var(--danger)',
                }
              : {
                  borderColor: 'var(--map-panel-border)',
                  background: 'var(--map-panel-bg)',
                  color: 'var(--map-fg-muted)',
                }
          }
          className="inline-flex h-10 min-w-10 shrink items-center gap-1.5 rounded-lg border px-2.5 shadow-lg backdrop-blur-md transition-colors hover:brightness-95"
        >
          <RulerIcon className="h-4 w-4 shrink-0" />
          {measuring && (
            <span className="truncate text-[11.5px] font-semibold">
              {measure.points.length >= 2
                ? formatDistance(measureTotalM)
                : measure.points.length === 1
                  ? // Shorter copy on phones -- the full sentence plus the undo/redo buttons
                    // beside it doesn't fit a narrow measure-cluster (max-w above) as one line.
                    'Add points…'
                  : 'Tap to measure'}
            </span>
          )}
        </button>
        {measuring && (
          <>
            <button
              type="button"
              onClick={() => {
                undoMeasurePoint()
                clearPreview()
              }}
              disabled={measure.points.length === 0}
              aria-label="Undo point"
              title="Undo point (Ctrl+Z or right-click)"
              style={{
                borderColor: 'var(--map-panel-border)',
                background: 'var(--map-panel-bg)',
                color: 'var(--map-fg-muted)',
              }}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-lg backdrop-blur-md transition-colors hover:brightness-95 disabled:pointer-events-none disabled:opacity-40"
            >
              <UndoIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={redoMeasurePoint}
              disabled={measure.redo.length === 0}
              aria-label="Redo point"
              title="Redo point (Ctrl+Y)"
              style={{
                borderColor: 'var(--map-panel-border)',
                background: 'var(--map-panel-bg)',
                color: 'var(--map-fg-muted)',
              }}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-lg backdrop-blur-md transition-colors hover:brightness-95 disabled:pointer-events-none disabled:opacity-40"
            >
              <RedoIcon className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <Panel
        icon={<CompassIcon className="h-full w-full" />}
        title="Kumbh Mela"
        subtitle="Sector plan · Haridwar–Rishikesh"
        side="left"
        overlayOpen={panelDropdownOpen}
        forceCollapsed={expandedDockedPanel === 'stats'}
        onExpand={() => setExpandedDockedPanel('search')}
        onCollapse={() => setExpandedDockedPanel((cur) => (cur === 'search' ? null : cur))}
      >
        <div className="flex flex-col gap-4">
          {/* Unified search -- merges the old SECTOR box, CLASS box (with its
              subclass tree), and the "More layers" POI/road disclosure into
              one searchable, grouped, multi-select combobox. Pinned above the
              base layer switches so it's the first thing reachable when the
              panel opens. */}
          <div ref={searchDropdownRef} className="relative">
            {selectedSector !== 'all' && (
              <div
                style={{
                  background: 'var(--map-accent-bg)',
                  borderColor: 'var(--map-accent-bg-hover)',
                  color: 'var(--map-accent-fg)',
                }}
                className="mb-1.5 flex items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[12.5px] font-medium"
              >
                <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  You&apos;re in{' '}
                  <b className="font-bold">
                    {(() => {
                      const s = sectors.find((x) => x.sector_no === selectedSector)
                      return s ? formatSectorLabel(s) : `Sector ${selectedSector}`
                    })()}
                  </b>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSector('all')}
                  className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] font-semibold opacity-85 hover:bg-white/10 hover:opacity-100"
                >
                  Clear
                </button>
              </div>
            )}
            {(classFilter.length > 0 ||
              Object.values(subclassFilter).some((subs) => subs.length > 0) ||
              ROAD_TYPE_DEFS.some((d) => visibility[d.key]) ||
              POI_LAYER_DEFS.some((d) => visibility[d.key])) && (
              <div className="mb-1.5 flex flex-col gap-1">
                {/* Clear all lives outside the scrollable chip list below (not
                    as its own last chip) so it stays reachable without
                    scrolling down through every active filter first --
                    "clear everything" should never require finding the thing
                    you're trying to get rid of. */}
                <button
                  type="button"
                  onClick={clearAllFilters}
                  style={{ color: 'var(--map-fg-faint)' }}
                  className="inline-flex w-fit cursor-pointer items-center gap-1 py-0.5 text-[11.5px] font-medium underline-offset-2 hover:underline"
                >
                  Clear all
                </button>
                <div className="flex max-h-52 flex-wrap gap-1 overflow-y-auto kumbh-scroll">
                  {classFilter.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleClassFilter(c)}
                      title={
                        (subclassFilter[c]?.length ?? 0) > 0
                          ? `Clear ${c} (also clears ${subclassFilter[c].length} sub-class selection${subclassFilter[c].length === 1 ? '' : 's'})`
                          : `Clear ${c}`
                      }
                      style={{
                        background: 'var(--map-accent-bg)',
                        color: 'var(--map-accent-fg)',
                      }}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full py-0.5 pl-2 pr-1.5 text-[11.5px] font-medium transition-colors hover:brightness-95"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: CLASS_GROUP_COLORS[c] }}
                      />
                      <span className="truncate max-w-[9rem]">{c}</span>
                      <XIcon className="h-2.5 w-2.5 shrink-0" />
                    </button>
                  ))}
                  {Object.entries(subclassFilter)
                    .filter(([, subs]) => subs.length > 0)
                    .map(([c, subs]) => {
                      // Excludes null-subclass rows, matching what the
                      // dropdown tree below actually offers -- counting them
                      // made the denominator unreachable, so a class with a
                      // null row read "(4/5)" even with everything checked.
                      const total = subclassStats.filter(
                        (r) => r.class_group === c && r.subclass !== null,
                      ).length
                      // Names the one sub-class when only one is picked, the
                      // same convention the POI chips below already used --
                      // the two halves of this row previously disagreed, with
                      // classes always reading "(n/total)" even at n = 1,
                      // which told the user a count when it could have told
                      // them the actual thing they had selected.
                      const label =
                        subs.length === 1 ? `${c} · ${subs[0]}` : `${c} (${subs.length}/${total})`
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() =>
                            setSubclassFilter((prev) => {
                              const next = { ...prev }
                              delete next[c]
                              return next
                            })
                          }
                          title={
                            subs.length === 1
                              ? `Clear ${c} · ${subs[0]}`
                              : `Clear all ${subs.length} ${c} sub-classes (${subs.join(', ')})`
                          }
                          style={{
                            background: 'var(--map-accent-bg)',
                            color: 'var(--map-accent-fg)',
                          }}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-full py-0.5 pl-2 pr-1.5 text-[11.5px] font-medium transition-colors hover:brightness-95"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: CLASS_GROUP_COLORS[c] }}
                          />
                          <span className="truncate max-w-[9rem]">{label}</span>
                          <XIcon className="h-2.5 w-2.5 shrink-0" />
                        </button>
                      )
                    })}
                  {ROAD_TYPE_DEFS.filter((d) => visibility[d.key]).map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setVisibility((v) => ({ ...v, [d.key]: false }))}
                      style={{ background: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full py-0.5 pl-2 pr-1.5 text-[11.5px] font-medium transition-colors hover:brightness-95"
                    >
                      <span
                        className="h-0 w-2.5 shrink-0"
                        style={{
                          borderTopWidth: 2,
                          borderTopColor: d.color,
                          borderTopStyle: d.dash ? 'dashed' : 'solid',
                        }}
                      />
                      <span className="truncate max-w-[9rem]">{d.label}</span>
                      <XIcon className="h-2.5 w-2.5 shrink-0" />
                    </button>
                  ))}
                  {POI_LAYER_DEFS.filter((d) => visibility[d.key]).map((d) => {
                    // A layer narrowed to a subset of its sub-classes says so,
                    // rather than reading as the whole layer: the one selected
                    // sub-class by name, or "Layer (n/total)" past that -- same
                    // convention as the partial-class chips above.
                    const subs = poiSubclassFilter[d.key]
                    const total = poiSubclassNames(d.key).length
                    const label =
                      !subs || subs.length === 0 || subs.length === total
                        ? d.label
                        : subs.length === 1
                          ? `${d.label} · ${subs[0]}`
                          : `${d.label} (${subs.length}/${total})`
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => {
                          setVisibility((v) => ({ ...v, [d.key]: false }))
                          // Clearing the layer clears its sub-class narrowing too,
                          // so re-enabling it later comes back fully on instead of
                          // silently pinned to the subset last picked.
                          setPoiSubclassFilter((prev) => {
                            if (!(d.key in prev)) return prev
                            const next = { ...prev }
                            delete next[d.key]
                            return next
                          })
                        }}
                        title={
                          subs && subs.length > 0 && subs.length < total
                            ? `Hide ${d.label} (clears ${subs.length} sub-class${subs.length === 1 ? '' : 'es'}: ${subs.join(', ')})`
                            : `Hide ${d.label}`
                        }
                        style={{
                          background: 'var(--map-accent-bg)',
                          color: 'var(--map-accent-fg)',
                        }}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-full py-0.5 pl-2 pr-1.5 text-[11.5px] font-medium transition-colors hover:brightness-95"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: d.color }}
                        />
                        <span className="truncate max-w-[9rem]">{label}</span>
                        <XIcon className="h-2.5 w-2.5 shrink-0" />
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--map-fg-faint)]" />
              <input
                type="text"
                value={query}
                onFocus={() => setPanelDropdownOpen(true)}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPanelDropdownOpen(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setPanelDropdownOpen(false)
                }}
                placeholder="What do you want to see?"
                // The placeholder is not an accessible name -- it disappears
                // the moment the user types, leaving a screen reader to
                // announce "edit, blank".
                //
                // No aria-expanded here: that belongs to role="combobox", and
                // this input is a plain textbox filtering a group below it,
                // not a combobox owning a listbox (see the dropdown's own
                // comment). Claiming the attribute without the role is the
                // same false promise that role removed.
                aria-label="Search sectors, classes, POI layers and roads"
                style={{
                  borderColor: 'var(--map-border)',
                  background: 'var(--map-input-bg)',
                  color: 'var(--map-fg)',
                }}
                className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-[14px] placeholder:text-[var(--map-fg-faint)] outline-none transition-shadow focus:border-[var(--map-accent)] focus:ring-2 focus:ring-[var(--map-accent)]/25"
              />
            </div>
            {/* Collapsed, this panel is just a placeholder and two toggles, which
                advertises none of what's actually searchable. This line names the
                scope so a first-time user knows there's a catalogue behind it. */}
            {!panelDropdownOpen && !query && (
              <button
                type="button"
                onClick={() => setPanelDropdownOpen(true)}
                style={{ color: 'var(--map-fg-faint)' }}
                className="mt-1.5 w-full cursor-pointer px-1 text-left text-[11px] hover:text-[var(--map-fg-muted)]"
              >
                {sectors.length} sectors · {classGroups.length} classes · {POI_LAYER_DEFS.length}{' '}
                POI layers
              </button>
            )}
            {/* The dropdown is deliberately NOT role="listbox". A listbox
                promises a screen reader single-focus roving navigation driven
                by aria-activedescendant, which this tree does not implement --
                it is a grouped set of independently focusable checkboxes and
                buttons, some nested, reached with Tab. Claiming the listbox
                contract while behaving like a group was worse for assistive
                tech than describing what this actually is: the reader
                announced "list box, N options" and then Down-arrow did
                nothing. Rows below are checkboxes, not options. */}
            {panelDropdownOpen && (
              <ul
                role="group"
                aria-label="Searchable map layers"
                style={{ borderColor: 'var(--map-border)', background: 'var(--map-surface)' }}
                className="kumbh-scroll absolute z-10 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border py-1 shadow-lg"
              >
                {searchGroups.length === 0 && (
                  <li
                    className="px-2.5 py-1.5 text-[12.5px]"
                    style={{ color: 'var(--map-fg-faint)' }}
                  >
                    No matches for &ldquo;{query}&rdquo;
                  </li>
                )}
                {searchGroups.map(({ group, rows }) => {
                  const GroupIcon = groupIcon[group]
                  const theme = groupTheme[group]
                  const collapsed = isGroupCollapsed(group)
                  return (
                    <li key={group} role="presentation">
                      {/* A plain row holding two SIBLING buttons -- the
                          disclosure and "All" -- rather than one interactive
                          header with the other nested inside it. Nesting one
                          button inside another (in either direction) is
                          invalid: a screen reader cannot say which of the two
                          the user is on, and the inner one needed
                          stopPropagation to avoid firing both. Native buttons
                          also bring their own Enter/Space handling, so the
                          hand-rolled onKeyDown is gone. */}
                      <div className="flex w-full items-center gap-1.5 px-2.5 py-1.5 hover:bg-[var(--map-surface-hover)]">
                        <button
                          type="button"
                          onClick={() => toggleCollapsedGroup(group)}
                          aria-expanded={!collapsed}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
                        >
                          <ChevronDownIcon
                            className={`h-3 w-3 shrink-0 text-[var(--map-fg-faint)] transition-transform ${collapsed ? '-rotate-90' : ''}`}
                          />
                          <span
                            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
                            style={{
                              background: `var(--map-section-${theme}-bg)`,
                              color: `var(--map-section-${theme}-fg)`,
                            }}
                          >
                            <GroupIcon className="h-2.5 w-2.5" />
                          </span>
                          <span
                            className="flex-1 truncate text-[10.5px] font-bold uppercase tracking-wide"
                            style={{ color: 'var(--map-fg-muted)' }}
                          >
                            {group}
                          </span>
                        </button>
                        {(group === 'Sector classes' ||
                          group === 'Roads' ||
                          group === 'POI layers') && (
                          <button
                            type="button"
                            onClick={() => {
                              if (group === 'Sector classes') selectAllClasses()
                              else if (group === 'Roads') selectAllRoads()
                              else selectAllPois()
                            }}
                            aria-label={`Select all ${group}`}
                            style={{ color: 'var(--map-accent)' }}
                            className="shrink-0 cursor-pointer px-1 text-[10.5px] font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
                          >
                            All
                          </button>
                        )}
                        <span
                          className="shrink-0 text-[10.5px] tabular-nums"
                          style={{ color: 'var(--map-fg-faint)' }}
                        >
                          {rows}
                        </span>
                      </div>
                      {!collapsed && group === 'Jump to sector' && (
                        <ul>
                          {matchedSectors.map((s) => (
                            <li key={s.sector_no}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSector(s.sector_no)
                                  setQuery('')
                                  setPanelDropdownOpen(false)
                                }}
                                style={{
                                  color: 'var(--map-fg)',
                                  background:
                                    selectedSector === s.sector_no
                                      ? 'var(--map-surface-active)'
                                      : undefined,
                                }}
                                className="w-full cursor-pointer py-1.5 pl-9 pr-2.5 text-left text-[13px] hover:bg-[var(--map-surface-hover)]"
                              >
                                {formatSectorLabel(s)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!collapsed && group === 'Sector classes' && (
                        <ul>
                          {matchedClasses.map((c) => {
                            const isFullySelected = classFilter.includes(c)
                            // Null-subclass rows (see subclassStats' own comment) aren't a real
                            // selectable sub-class -- their features are still counted in the
                            // class's own total via byClass, just not offered as a checkbox here.
                            const subclasses = subclassStats
                              .filter(
                                (r): r is typeof r & { subclass: string } =>
                                  r.class_group === c && r.subclass !== null,
                              )
                              .sort((a, b) => b.features - a.features)
                            const partialSubs = subclassFilter[c]
                            const isIndeterminate =
                              !isFullySelected &&
                              !!partialSubs &&
                              partialSubs.length > 0 &&
                              partialSubs.length < subclasses.length
                            const isChecked =
                              isFullySelected || (!!partialSubs && partialSubs.length > 0)
                            const hasChildren = subclasses.length > 1
                            // subclass can be null -- sector_plan rows with no subclass value
                            // still come back as one (class_group, null) row from /api/stats
                            // (unlike the POI subclass query, this one has no "IS NOT NULL"
                            // filter), so every .toLowerCase() below has to tolerate that.
                            const subclassNameMatches =
                              q !== '' &&
                              subclasses.some((s) => s.subclass?.toLowerCase().includes(q))
                            const isExpanded = expandedFilterClasses.has(c) || subclassNameMatches
                            // While actively searching, only show the subclasses that
                            // themselves match the query -- a class can match via one
                            // subclass (e.g. "hospital" -> Health Camping, because "4
                            // Bedded Hospital" matches) without dumping its whole
                            // unrelated subclass list ("Firstaid Center", etc.) into
                            // view. Once the query is cleared/manually expanded, the
                            // full list comes back.
                            const visibleSubclasses = subclassNameMatches
                              ? subclasses.filter((s) => s.subclass?.toLowerCase().includes(q))
                              : subclasses
                            return (
                              <li key={c}>
                                <div
                                  style={{
                                    color: 'var(--map-fg)',
                                    background: isChecked ? 'var(--map-surface-active)' : undefined,
                                  }}
                                  className="flex w-full items-center gap-1 py-1.5 pl-6 pr-2.5 text-left text-[13px] hover:bg-[var(--map-surface-hover)]"
                                >
                                  {hasChildren ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleExpandedFilterClass(c)}
                                      aria-expanded={isExpanded}
                                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${c} sub-classes`}
                                      style={{ color: 'var(--map-fg-faint)' }}
                                      className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center"
                                    >
                                      <ChevronDownIcon
                                        className={`h-3 w-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                                      />
                                    </button>
                                  ) : (
                                    <span className="h-3.5 w-3.5 shrink-0" />
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      toggleClassFilter(c)
                                      setQuery('')
                                    }}
                                    className="flex flex-1 cursor-pointer items-center gap-2 overflow-hidden"
                                  >
                                    <span
                                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border"
                                      style={{
                                        borderColor: isChecked
                                          ? CLASS_GROUP_COLORS[c]
                                          : 'var(--map-border)',
                                        background: isChecked
                                          ? CLASS_GROUP_COLORS[c]
                                          : 'transparent',
                                      }}
                                    >
                                      {isIndeterminate ? (
                                        <span className="h-[2px] w-2 rounded-full bg-white" />
                                      ) : (
                                        isChecked && (
                                          <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            className="h-2.5 w-2.5"
                                            aria-hidden="true"
                                          >
                                            <path
                                              d="M5 13l4 4L19 7"
                                              stroke="white"
                                              strokeWidth={3}
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                            />
                                          </svg>
                                        )
                                      )}
                                    </span>
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                                      style={{ background: CLASS_GROUP_COLORS[c] }}
                                    />
                                    <span className="truncate">{c}</span>
                                  </button>
                                </div>
                                {hasChildren && isExpanded && (
                                  <ul>
                                    {visibleSubclasses.map((row) => {
                                      const subChecked = isFullySelected
                                        ? true
                                        : (partialSubs?.includes(row.subclass) ?? false)
                                      return (
                                        <li key={row.subclass}>
                                          <button
                                            type="button"
                                            onClick={() => toggleSubclassFilter(c, row.subclass)}
                                            style={{ color: 'var(--map-fg-muted)' }}
                                            className="flex w-full cursor-pointer items-center gap-2 py-1 pl-14 pr-2.5 text-left text-[12px] hover:bg-[var(--map-surface-hover)]"
                                          >
                                            <span
                                              className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border"
                                              style={{
                                                borderColor: subChecked
                                                  ? CLASS_GROUP_COLORS[c]
                                                  : 'var(--map-border)',
                                                background: subChecked
                                                  ? CLASS_GROUP_COLORS[c]
                                                  : 'transparent',
                                              }}
                                            >
                                              {subChecked && (
                                                <svg
                                                  viewBox="0 0 24 24"
                                                  fill="none"
                                                  className="h-2 w-2"
                                                  aria-hidden="true"
                                                >
                                                  <path
                                                    d="M5 13l4 4L19 7"
                                                    stroke="white"
                                                    strokeWidth={4}
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                  />
                                                </svg>
                                              )}
                                            </span>
                                            <span className="truncate">{row.subclass}</span>
                                            <span
                                              className="ml-auto shrink-0 tabular-nums"
                                              style={{ color: 'var(--map-fg-faint)' }}
                                            >
                                              {row.features}
                                            </span>
                                          </button>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {!collapsed && group === 'Roads' && (
                        <ul>
                          {matchedRoads.map((d) => (
                            <li key={d.key}>
                              <button
                                type="button"
                                onClick={() => setVisibility((v) => ({ ...v, [d.key]: !v[d.key] }))}
                                style={{
                                  color: 'var(--map-fg)',
                                  background: visibility[d.key]
                                    ? 'var(--map-surface-active)'
                                    : undefined,
                                }}
                                className="flex w-full cursor-pointer items-center gap-2 py-1.5 pl-9 pr-2.5 text-left text-[13px] hover:bg-[var(--map-surface-hover)]"
                              >
                                <span
                                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border"
                                  style={{
                                    borderColor: visibility[d.key] ? d.color : 'var(--map-border)',
                                    background: visibility[d.key] ? d.color : 'transparent',
                                  }}
                                >
                                  {visibility[d.key] && (
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      className="h-2.5 w-2.5"
                                      aria-hidden="true"
                                    >
                                      <path
                                        d="M5 13l4 4L19 7"
                                        stroke="white"
                                        strokeWidth={3}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  )}
                                </span>
                                <span
                                  className="h-0 w-3 shrink-0"
                                  style={{
                                    borderTopWidth: 2,
                                    borderTopColor: d.color,
                                    borderTopStyle: d.dash ? 'dashed' : 'solid',
                                  }}
                                />
                                <span className="truncate">{d.label}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!collapsed && group === 'POI layers' && (
                        <ul>
                          {matchedPois.map((d, i) => {
                            // Small sub-header before the first raw-OSM layer in the
                            // list (currently just tertiary_road) -- flags it as
                            // third-party reference data distinct from the curated
                            // gdb layers around it, without pulling it into its own
                            // top-level group (see the "should this be under Roads"
                            // conversation this came out of -- it stays under POI
                            // layers, just visually separated within that list).
                            const isFirstOsm =
                              d.isThirdPartyOsm && !matchedPois[i - 1]?.isThirdPartyOsm
                            const signageCode = POI_SIGNAGE_CODES[d.key]
                            const subclasses = poiSubclassStats
                              .filter((r) => r.layer === d.key)
                              .sort((a, b) => b.features - a.features)
                            const partialSubs = poiSubclassFilter[d.key]
                            const isFullyOn = visibility[d.key] && !partialSubs
                            const isChecked = isFullyOn || (!!partialSubs && partialSubs.length > 0)
                            const isIndeterminate =
                              !isFullyOn &&
                              !!partialSubs &&
                              partialSubs.length > 0 &&
                              partialSubs.length < subclasses.length
                            // tertiary_road has no subclass column (it's not in
                            // POI_SUBCLASS_COLUMNS), but reuses this same
                            // chevron+nested-row treatment for its one "Only
                            // inside sector area" toggle instead of a subclass list.
                            const isTertiaryRoad = d.key === 'tertiary_road'
                            const hasChildren = subclasses.length > 1 || isTertiaryRoad
                            const subclassNameMatches =
                              q !== '' &&
                              subclasses.some((s) => s.subclass.toLowerCase().includes(q))
                            const isExpanded = expandedFilterPois.has(d.key) || subclassNameMatches
                            const visibleSubclasses = subclassNameMatches
                              ? subclasses.filter((s) => s.subclass.toLowerCase().includes(q))
                              : subclasses
                            return (
                              <Fragment key={d.key}>
                                {isFirstOsm && (
                                  <li
                                    role="presentation"
                                    aria-hidden="true"
                                    className="select-none pb-0.5 pl-6 pr-2.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide"
                                    style={{ color: 'var(--map-fg-faint)' }}
                                  >
                                    OSM
                                  </li>
                                )}
                                <li>
                                  <div
                                    style={{
                                      color: 'var(--map-fg)',
                                      background: isChecked
                                        ? 'var(--map-surface-active)'
                                        : undefined,
                                    }}
                                    className="flex w-full items-center gap-1 py-1.5 pl-6 pr-2.5 text-left text-[13px] hover:bg-[var(--map-surface-hover)]"
                                  >
                                    {hasChildren ? (
                                      <button
                                        type="button"
                                        onClick={() => toggleExpandedFilterPoi(d.key)}
                                        aria-expanded={isExpanded}
                                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${d.label} sub-classes`}
                                        style={{ color: 'var(--map-fg-faint)' }}
                                        className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center"
                                      >
                                        <ChevronDownIcon
                                          className={`h-3 w-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                                        />
                                      </button>
                                    ) : (
                                      <span className="h-3.5 w-3.5 shrink-0" />
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => togglePoiLayerFilter(d.key)}
                                      className="flex flex-1 cursor-pointer items-center gap-2 overflow-hidden"
                                    >
                                      <span
                                        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border"
                                        style={{
                                          borderColor: isChecked ? d.color : 'var(--map-border)',
                                          background: isChecked ? d.color : 'transparent',
                                        }}
                                      >
                                        {isIndeterminate ? (
                                          <span className="h-[2px] w-2 rounded-full bg-white" />
                                        ) : (
                                          isChecked && (
                                            <svg
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              className="h-2.5 w-2.5"
                                              aria-hidden="true"
                                            >
                                              <path
                                                d="M5 13l4 4L19 7"
                                                stroke="white"
                                                strokeWidth={3}
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              />
                                            </svg>
                                          )
                                        )}
                                      </span>
                                      {signageCode ? (
                                        <span
                                          className="flex h-3.5 shrink-0 items-center justify-center rounded-[3px] px-1 text-[8.5px] font-bold leading-none text-white"
                                          style={{ background: d.color }}
                                        >
                                          {signageCode}
                                        </span>
                                      ) : (
                                        <span
                                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                                          style={{ background: d.color }}
                                        />
                                      )}
                                      <span className="truncate">{d.label}</span>
                                    </button>
                                  </div>
                                  {isTertiaryRoad && isExpanded && (
                                    <ul>
                                      <li>
                                        <button
                                          type="button"
                                          onClick={() => setTertiaryRoadSectorOnly((v) => !v)}
                                          style={{ color: 'var(--map-fg-muted)' }}
                                          className="flex w-full cursor-pointer items-center gap-2 py-1 pl-14 pr-2.5 text-left text-[12px] hover:bg-[var(--map-surface-hover)]"
                                        >
                                          <span
                                            className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border"
                                            style={{
                                              borderColor: tertiaryRoadSectorOnly
                                                ? d.color
                                                : 'var(--map-border)',
                                              background: tertiaryRoadSectorOnly
                                                ? d.color
                                                : 'transparent',
                                            }}
                                          >
                                            {tertiaryRoadSectorOnly && (
                                              <svg
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                className="h-2 w-2"
                                                aria-hidden="true"
                                              >
                                                <path
                                                  d="M5 13l4 4L19 7"
                                                  stroke="white"
                                                  strokeWidth={4}
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                />
                                              </svg>
                                            )}
                                          </span>
                                          <span className="truncate">Only inside sector area</span>
                                        </button>
                                      </li>
                                    </ul>
                                  )}
                                  {!isTertiaryRoad && hasChildren && isExpanded && (
                                    <ul>
                                      {visibleSubclasses.map((row) => {
                                        const subChecked = isFullyOn
                                          ? true
                                          : (partialSubs?.includes(row.subclass) ?? false)
                                        return (
                                          <li key={row.subclass}>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                togglePoiSubclassFilter(d.key, row.subclass)
                                              }
                                              style={{
                                                color: subChecked
                                                  ? 'var(--map-fg)'
                                                  : 'var(--map-fg-muted)',
                                                background: subChecked
                                                  ? 'var(--map-surface-active)'
                                                  : undefined,
                                              }}
                                              className={`flex w-full cursor-pointer items-center gap-2 py-1 pl-14 pr-2.5 text-left text-[12px] hover:bg-[var(--map-surface-hover)] ${subChecked ? 'font-medium' : ''}`}
                                            >
                                              <span
                                                className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border"
                                                style={{
                                                  borderColor: subChecked
                                                    ? d.color
                                                    : 'var(--map-border)',
                                                  background: subChecked ? d.color : 'transparent',
                                                }}
                                              >
                                                {subChecked && (
                                                  <svg
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    className="h-2 w-2"
                                                    aria-hidden="true"
                                                  >
                                                    <path
                                                      d="M5 13l4 4L19 7"
                                                      stroke="white"
                                                      strokeWidth={4}
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                    />
                                                  </svg>
                                                )}
                                              </span>
                                              <span className="truncate">{row.subclass}</span>
                                              <span
                                                className="ml-auto shrink-0 tabular-nums"
                                                style={{ color: 'var(--map-fg-faint)' }}
                                              >
                                                {row.features}
                                              </span>
                                            </button>
                                          </li>
                                        )
                                      })}
                                    </ul>
                                  )}
                                </li>
                              </Fragment>
                            )
                          })}
                        </ul>
                      )}
                      {!collapsed && group === 'Base layers' && (
                        <ul>
                          {matchedBaseLayers.map(({ key, label, icon: Icon }) => (
                            <li key={key}>
                              <button
                                type="button"
                                onClick={() => setVisibility((v) => ({ ...v, [key]: !v[key] }))}
                                style={{
                                  color: 'var(--map-fg)',
                                  background: visibility[key]
                                    ? 'var(--map-surface-active)'
                                    : undefined,
                                }}
                                className="flex w-full cursor-pointer items-center gap-2 py-1.5 pl-9 pr-2.5 text-left text-[13px] hover:bg-[var(--map-surface-hover)]"
                              >
                                <span
                                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border"
                                  style={{
                                    borderColor: visibility[key]
                                      ? 'var(--map-accent)'
                                      : 'var(--map-border)',
                                    background: visibility[key]
                                      ? 'var(--map-accent)'
                                      : 'transparent',
                                  }}
                                >
                                  {visibility[key] && (
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      className="h-2.5 w-2.5"
                                      aria-hidden="true"
                                    >
                                      <path
                                        d="M5 13l4 4L19 7"
                                        stroke="white"
                                        strokeWidth={3}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  )}
                                </span>
                                <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--map-fg-faint)]" />
                                <span className="truncate">{label}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Base layers -- pinned below search, always visible without
              opening the dropdown since toggling the whole sector plan or
              boundary layer off is a frequent, fundamental action. */}
          <div className="flex flex-col gap-2">
            {baseLayerRows.map(({ key, label, icon: Icon, theme }) => (
              <div
                key={key}
                style={{ borderColor: 'var(--map-border)', background: 'var(--map-surface)' }}
                className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 shadow-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    style={{
                      background: `var(--map-section-${theme}-bg)`,
                      color: `var(--map-section-${theme}-fg)`,
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span
                    className="truncate text-[13px] font-medium"
                    style={{ color: 'var(--map-fg)' }}
                  >
                    {label}
                  </span>
                </span>
                <label className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={visibility[key]}
                    onChange={(e) => setVisibility((v) => ({ ...v, [key]: e.target.checked }))}
                  />
                  <span className="absolute inset-0 rounded-full bg-[var(--map-switch-track)] transition-colors peer-checked:bg-[var(--map-accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--map-accent)]/40" />
                  <span className="absolute left-0.5 h-4 w-4 rounded-full bg-[var(--map-switch-thumb)] shadow transition-transform peer-checked:translate-x-4" />
                </label>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <StatsPanel
        icon={<ChartBarIcon className="h-full w-full" />}
        sectorNo={selectedSector === 'all' ? null : selectedSector}
        sectorLabel={
          selectedSector !== 'all'
            ? (() => {
                const s = sectors.find((x) => x.sector_no === selectedSector)
                return s ? formatSectorLabel(s) : `Sector ${selectedSector}`
              })()
            : undefined
        }
        onClearSector={() => setSelectedSector('all')}
        onSelectSector={(n) => setSelectedSector(n)}
        classFilter={classFilter}
        onClassFilterChange={toggleClassFilter}
        subclassFilter={subclassFilter}
        onSubclassFilterChange={toggleSubclassFilter}
        locateTargets={locateTargets}
        onToggleLocate={toggleLocate}
        onRetryLocate={retryLocate}
        locateResults={locateResults}
        onLocateFeatureClick={flyToLocateFeature}
        poiVisibility={visibility}
        onTogglePoiLayer={togglePoiLayerFilter}
        poiSubclassFilter={poiSubclassFilter}
        onPoiSubclassFilterChange={togglePoiSubclassFilter}
        poiLocateTargets={poiLocateTargets}
        onTogglePoiLocate={togglePoiLocate}
        onRetryPoiLocate={retryPoiLocate}
        poiLocateResults={poiLocateResults}
        onPoiLocateFeatureClick={flyToLocateFeature}
        roadTypeVisibility={visibility}
        onToggleRoadType={(key) => setVisibility((v) => ({ ...v, [key]: !v[key] }))}
        onWidthChange={(w) => {
          statsPanelWidthRef.current = w
        }}
        forceCollapsed={expandedDockedPanel === 'search'}
        onExpand={() => setExpandedDockedPanel('stats')}
        onCollapse={() => setExpandedDockedPanel((cur) => (cur === 'stats' ? null : cur))}
      />

      <SectorReportDrawer
        sectorNo={selectedSector === 'all' ? null : selectedSector}
        sectorLabel={(() => {
          const s = sectors.find((x) => x.sector_no === selectedSector)
          return s ? formatSectorLabel(s) : `Sector ${selectedSector}`
        })()}
        onClose={() => setSelectedSector('all')}
      />
    </div>
  )
}

// MapLibre's typed feature from map events isn't exactly MapGeoJSONFeature
// in all versions; keep the popup helper loosely typed against the shape we use.
type MapGEOJSONFeatureCompat = {
  id?: number | string
  properties?: Record<string, unknown>
  layer: { id: string }
}
