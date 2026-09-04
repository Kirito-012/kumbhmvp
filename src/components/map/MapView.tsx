'use client'

import { useEffect, useRef, useState } from 'react'
import type { Feature } from 'geojson'
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

// Fixed emphasis color for the active class/sub-class filter's glow+outline
// (sector-plan-filter-glow/-outline below) -- deliberately NOT any class's
// own color, since several classes are themselves greys/neutrals that
// nearly vanish against the dimmed basemap those layers render over. Warm
// gold reads clearly against both the light and dark dimmed basemap and
// doesn't collide with the map's other fixed accent colors (blue = general
// UI accent, violet = selected-sector outline, red = measure tool).
const FILTER_EMPHASIS_COLOR = '#f59e0b'

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
  })),
  ...Object.keys(POLYGON_LAYER_COLORS).map((key) => ({
    key,
    label: POLYGON_LAYER_LABELS[key] ?? key,
    color: POLYGON_LAYER_COLORS[key],
    geomType: 'polygon' as const,
  })),
]

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

// Shared by both the initial layer-creation sync (so POI layers default to
// hidden with no flash of visible-then-hidden) and the visibility-toggle
// effect below, so the id/visibility-key mapping only lives in one place.
function applyLayerVisibility(map: MLMap, visibility: Record<string, boolean>) {
  ;(
    [
      ['sector-plan-fill', visibility.sector_plan],
      ['sector-plan-peripheral-outline', visibility.sector_plan],
      ['sector-plan-parking-label', visibility.sector_plan],
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
      ...POI_LAYER_DEFS.flatMap(
        (d) =>
          [
            [`poi-${d.key}`, visibility[d.key]],
            [`poi-${d.key}-hit`, visibility[d.key]],
            [`poi-${d.key}-label`, visibility[d.key]],
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
    { class_group: string; subclass: string; features: number }[]
  >([])
  // Bounding box + per-feature centroids for the *single* class or
  // sub-class the filter currently narrows to -- powers both the map's
  // auto zoom-to-fit and the Stats panel's locator list under the selected
  // row. Only ever populated for a single-target selection (one class with
  // nothing else selected, or one (class, subclass) pair): with multiple
  // classes selected there's no one meaningful place to fly to, so this
  // stays null and the map just leaves the view where it was.
  const [locateResult, setLocateResult] = useState<{
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
  } | null>(null)
  // Which POI layer to fetch bbox/feature centroids for -- set explicitly by
  // clicking a "Points of interest" row in the Stats panel (not by flipping
  // a visibility checkbox alone, since several POI layers can be visible at
  // once and toggling one on shouldn't yank the viewport out from under an
  // already-visible layer the user was looking at).
  const [poiLocateTarget, setPoiLocateTarget] = useState<string | null>(null)
  const [poiLocateResult, setPoiLocateResult] = useState<{
    layer: string
    total: number
    bbox: [number, number, number, number] | null
    features: { id: number; label: string | null; lng: number; lat: number }[]
  } | null>(null)
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
  // Single search query driving the unified sector/class/road/POI combobox
  // below (merges what used to be two separate `search`/`classSearch` text
  // states now that there's one input for all four taxonomies).
  const [query, setQuery] = useState('')
  const [panelDropdownOpen, setPanelDropdownOpen] = useState(false)
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

  useEffect(() => {
    const url = selectedSector !== 'all' ? `/api/stats?sector=${selectedSector}` : '/api/stats'
    fetch(url)
      .then((r) => r.json())
      .then((data) => setSubclassStats(data.bySubclass ?? []))
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

  function propertyRowsHtml(feature: MapGEOJSONFeatureCompat) {
    const p = feature.properties ?? {}
    const poiDef = poiLayerDef(feature.layer.id)
    const rows: [string, unknown][] = poiDef
      ? Object.entries(p)
          // name/label already shown in the header -- id and raw geometry
          // fields aren't meaningful to a viewer, so both are dropped here.
          .filter(([k]) => !['id', 'name', 'geom'].includes(k))
          .map(([k, v]) => [poiPropertyLabel(k), v])
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

    return `<div style="margin:12px 16px 14px;padding-top:12px;border-top:1px solid var(--map-popup-row-border)">
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
      `<div style="font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;width:240px;background:var(--map-popup-bg);border-radius:16px">${popupHeaderHtml(feature)}${propertyRowsHtml(feature)}${ticketHtml}</div>`

    const popup = new Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(lngLat)
      .setHTML(baseHtml(''))
      .addTo(map)
    popupRef.current = popup

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

    const map = new MLMap({
      container: mapContainer.current,
      style: {
        version: 8,
        // Needed for any 'symbol'/text-field layer (the P/BS/G signage
        // labels below) -- MapLibre renders text from server-supplied SDF
        // glyph PBFs, not local system fonts. Public, no-key demo endpoint,
        // same tier of dependency as the OSM raster tiles below.
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: initialParcel ? [initialParcel.lng, initialParcel.lat] : CENTER,
      zoom: initialParcel ? 16 : INITIAL_ZOOM,
      // OSM's tile usage policy requires attribution to stay visible, but
      // the default control collapses it behind an "i" toggle button --
      // compact: false keeps it as plain always-visible text instead.
      attributionControl: { compact: false },
    })
    mapRef.current = map
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

      // Render order: sector_plan fill (bottom) -> roads -> boundaries (top)
      map.addLayer({
        id: 'sector-plan-fill',
        type: 'fill',
        source: 'sector_plan',
        'source-layer': 'sector_plan',
        paint: {
          'fill-color': matchExpr('class_group', CLASS_GROUP_COLORS, '#cbd5e1'),
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0.75],
        },
      })
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
      // Signage: a centered "P" on every Parking parcel in the sector plan.
      map.addLayer({
        id: 'sector-plan-parking-label',
        type: 'symbol',
        source: 'sector_plan',
        'source-layer': 'sector_plan',
        filter: ['==', ['get', 'class_group'], 'Parking'],
        layout: {
          'text-field': 'P',
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 18, 20],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#1f2937',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
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
          'line-color': '#111827',
          'line-width': 1,
        },
      })

      // Remaining POI layers (Aug 2026 JSON drop) -- one vector source + one
      // visual layer per entry in POI_LAYER_DEFS (river excluded -- it was
      // already added above, beneath sector_plan), rendered on top of the
      // sector plan/roads/boundaries above. Sources are created up front so
      // add-layer order below (which controls paint/z-order) doesn't have to
      // match POI_LAYER_DEFS's array order.
      const remainingPoiDefs = POI_LAYER_DEFS.filter((d) => d.key !== 'river')
      for (const def of remainingPoiDefs) {
        map.addSource(def.key, {
          type: 'vector',
          tiles: [`${location.origin}/api/tiles/${def.key}/{z}/{x}/{y}`],
          promoteId: 'id',
        })
      }

      // Paint polygons first (bottom), then lines, then points (top) --
      // otherwise area layers like kumbh_land/ashram would cover the point
      // markers (dustbins, sanitation, etc.) drawn before them.
      const byGeomType = (t: PoiGeomType) => remainingPoiDefs.filter((d) => d.geomType === t)

      for (const def of byGeomType('polygon')) {
        map.addLayer({
          id: `poi-${def.key}`,
          type: 'fill',
          source: def.key,
          'source-layer': def.key,
          paint: {
            'fill-color': def.color,
            'fill-opacity': 0.25,
            'fill-outline-color': def.color,
          },
        })
      }
      for (const def of byGeomType('line')) {
        map.addLayer({
          id: `poi-${def.key}`,
          type: 'line',
          source: def.key,
          'source-layer': def.key,
          paint: {
            'line-color': def.color,
            'line-width': 2,
          },
        })
      }
      for (const def of byGeomType('point')) {
        // Any POI with a signage code (Ghat points, bus stops, fire
        // hydrants -- "G"/"BS"/"FH") shows only that label, not the dot
        // underneath -- still add the circle layer (kept as the hit-target
        // for hover/click and the Layers-panel visibility toggle) but
        // render it fully transparent.
        const hideCircle = Boolean(POI_SIGNAGE_CODES[def.key])
        // The visible dot's own radius (2.5-6px) is too small a target to
        // reliably click/tap -- queryRenderedFeatures hit-tests against the
        // actual rendered geometry, so a miss just falls through to the
        // sector-selection click handler underneath instead of opening this
        // point's popup. A wider fully-transparent circle underneath widens
        // the real click area without changing how the dot/badge looks.
        map.addLayer({
          id: `poi-${def.key}-hit`,
          type: 'circle',
          source: def.key,
          'source-layer': def.key,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 14],
            'circle-opacity': 0,
          },
        })
        map.addLayer({
          id: `poi-${def.key}`,
          type: 'circle',
          source: def.key,
          'source-layer': def.key,
          paint: {
            'circle-color': def.color,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 6],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
            ...(hideCircle ? { 'circle-opacity': 0, 'circle-stroke-opacity': 0 } : {}),
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
            'source-layer': def.key,
            layout: {
              'icon-image': iconId,
              'icon-anchor': 'bottom',
              'icon-offset': [0, -6],
              'icon-allow-overlap': false,
            },
          })
        }
      }

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
      map.addLayer({
        id: 'sector-hover-fill',
        type: 'fill',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: { 'fill-color': '#475569', 'fill-opacity': 0.08 },
      })
      map.addLayer({
        id: 'sector-hover-glow',
        type: 'line',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: {
          'line-color': '#475569',
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
        paint: { 'line-color': '#475569', 'line-width': 2.5, 'line-opacity': 0.9 },
      })
      // Selected-sector outline (violet) -- sector-plan-fill/road-line are
      // already filtered down to just this sector elsewhere; this outline
      // is the extra visual anchor for which one that is. Deliberately not
      // blue: ROAD_TYPE_COLORS['Proposed Road'] is #2563eb, and a thick
      // outline in that same hue was indistinguishable from proposed-road
      // segments running along/near the boundary.
      map.addLayer({
        id: 'sector-selected-outline',
        type: 'line',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: { 'line-color': '#7c3aed', 'line-width': 5, 'line-opacity': 1 },
      })

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

      // Apply the initial layer visibility (POI layers default to off) right
      // away, synchronously with layer creation -- every layer above is
      // added with MapLibre's default 'visible' layout, so without this the
      // POI dots/lines/fills would render (or stay rendered indefinitely, if
      // the separate visibility-syncing effect below never re-runs) despite
      // the sidebar's toggles showing off. `visibility` here is always the
      // SSR-safe defaults (not yet the localStorage-restored value -- see the
      // mount effect near the other localStorage effects), so a user with
      // customized visibility may see one frame of defaults before the
      // visibility-syncing effect below reconciles it once storage loads.
      applyLayerVisibility(map, visibility)

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

      for (const layerId of poiLayerIds) {
        map.on('mouseenter', layerId, () => {
          if (measuringRef.current) return
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layerId, () => {
          if (measuringRef.current) return
          map.getCanvas().style.cursor = ''
        })
      }

      // Single map-wide click handler drives selection: clicking any
      // feature inside a sector (a parcel, a road, or just bare sector
      // area via the hit-target) selects that sector everywhere -- the
      // dropdown, the map filter/fly-to, and the Stats panel all key off
      // the same selectedSector state. Clicking outside every sector
      // deselects back to "All sectors". The popup, though, only makes
      // sense for a real feature (a parcel or a road) -- sector-hit-target
      // is an invisible catch-all just for selection, so a click that only
      // lands on bare sector area (no parcel/road underneath) selects the
      // sector but shows no popup instead of one full of the boundary's own
      // properties, which isn't what was clicked.
      //
      // POI markers/lines/areas are a separate concern -- clicking one shows
      // its own popup but never changes sector selection, so they're checked
      // first and, when hit, short-circuit the sector-selecting logic below.
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

        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['sector-plan-fill', 'road-line', 'sector-hit-target'],
        })
        if (hits.length === 0) {
          setSelectedSector('all')
          popupRef.current?.remove()
          popupParcelIdRef.current = null
          return
        }
        const detail = hits.find(
          (f) => f.layer.id === 'sector-plan-fill' || f.layer.id === 'road-line',
        )
        const raw = (detail ?? hits[0]).properties?.sector_no
        setSelectedSector(typeof raw === 'number' ? raw : 'all')
        if (detail) {
          showPopup(map, detail as unknown as MapGEOJSONFeatureCompat, e.lngLat)
        } else {
          popupRef.current?.remove()
          popupParcelIdRef.current = null
        }
      })

      // Right-click: undoes the last committed point while measuring, or --
      // otherwise -- deselects the current sector, mirroring the "click an
      // empty area to deselect" gesture without having to find empty area.
      // Suppresses both MapLibre's own default handling and the browser's
      // native context menu either way.
      map.on('contextmenu', (e) => {
        if (measuringRef.current) {
          e.preventDefault()
          e.originalEvent?.preventDefault?.()
          undoMeasurePoint()
          clearPreview()
          return
        }
        if (selectedSectorRef.current === 'all') return
        e.preventDefault()
        e.originalEvent?.preventDefault?.()
        setSelectedSector('all')
        popupRef.current?.remove()
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

    return () => {
      marker?.remove()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial-view-only prop, map is created once
  }, [])

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
    // Dim the basemap so the (now outlined/glowing) matched parcels read as
    // the obvious focus instead of competing with road/label clutter --
    // fill-opacity alone stops being a distinguishing signal once the map is
    // already filtered down to a single class.
    if (map.getLayer('osm')) {
      map.setPaintProperty('osm', 'raster-opacity', emphasisActive ? 0.45 : 1)
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

    // The "P" parking signage shares sector_plan's source but has its own
    // permanent class_group=Parking filter, so it needs the sector filter
    // layered on top explicitly -- otherwise selecting a sector hides the
    // grey Parking fill (sector-plan-fill) but leaves every "P" on the map
    // still showing, since this layer was never included in finalFilter.
    // It's also hidden outright when a different class is selected, same as
    // any other class's parcels would be.
    if (map.getLayer('sector-plan-parking-label')) {
      const NEVER_MATCH: FilterSpecification = ['==', ['get', 'class_group'], '__none__']
      const anyFilterActive = classFilter.length > 0 || subclassPairs.length > 0
      const parkingReachable =
        classFilter.includes('Parking') || subclassPairs.some(([cls]) => cls === 'Parking')
      const parkingFilter =
        anyFilterActive && !parkingReachable
          ? NEVER_MATCH
          : sectorFilter
            ? ([
                'all',
                ['==', ['get', 'class_group'], 'Parking'],
                sectorFilter,
              ] as unknown as FilterSpecification)
            : (['==', ['get', 'class_group'], 'Parking'] as FilterSpecification)
      map.setFilter('sector-plan-parking-label', parkingFilter)
    }

    if (map.getLayer('sector-selected-outline')) {
      map.setFilter(
        'sector-selected-outline',
        (selectedSector === 'all'
          ? ['==', ['get', 'sector_no'], -1]
          : ['==', ['get', 'sector_no'], selectedSector]) as FilterSpecification,
      )
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

  // Resolves the current filter down to a single (class, subclass|null)
  // "locate target", when there is exactly one -- i.e. exactly one class
  // selected with nothing else, whether that's the whole class or a
  // partial selection of exactly one of its sub-classes. Anything broader
  // (multiple classes, no selection at all) has no single place to zoom to.
  const partialEntries = Object.entries(subclassFilter).filter(([, subs]) => subs.length > 0)
  const locateTarget: { classGroup: string; subclass: string | null } | null =
    classFilter.length === 1 && partialEntries.length === 0
      ? { classGroup: classFilter[0], subclass: null }
      : classFilter.length === 0 && partialEntries.length === 1 && partialEntries[0][1].length === 1
        ? { classGroup: partialEntries[0][0], subclass: partialEntries[0][1][0] }
        : null

  // Auto zoom-to-fit + locator list data: fetches the bbox/feature
  // centroids for the resolved single-target selection above and flies the
  // map to it, but only when the user hasn't already manually picked a
  // sector -- a sector selection already drives its own fitBounds above,
  // and re-flying on top of that would fight the user's explicit choice.
  useEffect(() => {
    if (!locateTarget || selectedSector !== 'all') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing derived state that's no longer valid once its own dependency (locateTarget/selectedSector) stops supporting a single locate target, not state driven by an external system
      setLocateResult(null)
      return
    }
    let cancelled = false
    const params = new URLSearchParams({ class_group: locateTarget.classGroup })
    if (locateTarget.subclass !== null) params.set('subclass', locateTarget.subclass)
    fetch(`/api/sector-plan/locate?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setLocateResult({
          classGroup: locateTarget.classGroup,
          subclass: locateTarget.subclass,
          total: data.total ?? 0,
          bbox: data.bbox ?? null,
          features: data.features ?? [],
        })
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
        if (!cancelled) setLocateResult(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locateTarget is derived fresh each render from classFilter/subclassFilter, which are already tracked
  }, [locateTarget?.classGroup, locateTarget?.subclass, selectedSector])

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

  // Fetches bbox/feature centroids for poiLocateTarget and flies the map to
  // fit it -- same shape as the class/sub-class locate effect above, but
  // fires from an explicit click (see onPoiRowClick below) rather than
  // whenever visibility changes, since several POI layers can be on at once
  // and there's no single "the selection" to auto-fit the way there is for
  // classFilter/subclassFilter narrowing to one target.
  useEffect(() => {
    if (!poiLocateTarget) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing derived state that's no longer valid once its own dependency (poiLocateTarget) goes null, not state driven by an external system
      setPoiLocateResult(null)
      return
    }
    let cancelled = false
    fetch(`/api/poi/locate?layer=${encodeURIComponent(poiLocateTarget)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setPoiLocateResult({
          layer: poiLocateTarget,
          total: data.total ?? 0,
          bbox: data.bbox ?? null,
          features: data.features ?? [],
        })
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
        if (!cancelled) setPoiLocateResult(null)
      })
    return () => {
      cancelled = true
    }
  }, [poiLocateTarget])

  /** Stats panel POI row click -- toggles the layer's visibility (existing
   *  behavior) and, when that turns it on, also sets it as the locate
   *  target so the map flies to fit it and the panel shows its locator
   *  list. Clicking an already-visible row just turns it off, same as
   *  before, and clears any locate result for it. */
  function handlePoiRowClick(layerKey: string) {
    const turningOn = !visibility[layerKey]
    setVisibility((v) => ({ ...v, [layerKey]: !v[layerKey] }))
    setPoiLocateTarget(turningOn ? layerKey : null)
  }

  const classGroups = Object.keys(CLASS_GROUP_COLORS).sort((a, b) => a.localeCompare(b))

  function toggleClassFilter(c: string) {
    setClassFilter((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
    // Checking/unchecking the whole class supersedes any partial sub-class
    // picks within it -- drop them so the two selection modes never fight
    // (e.g. a class re-checked after being partially selected shouldn't
    // silently stay pinned to its old partial subset).
    setSubclassFilter((prev) => {
      if (!(c in prev)) return prev
      const next = { ...prev }
      delete next[c]
      return next
    })
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
    setClassFilter((prev) => prev.filter((x) => x !== cls))
    setSubclassFilter((prev) => {
      const current = prev[cls] ?? (wasFullyChecked ? classSubclassNames(cls) : [])
      const next = current.includes(sub) ? current.filter((x) => x !== sub) : [...current, sub]
      return { ...prev, [cls]: next }
    })
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
    return subclassStats.filter((r) => r.class_group === cls).map((r) => r.subclass)
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
  const matchedPois = POI_LAYER_DEFS.filter((d) => matchesQuery(d.label))
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
    <div className="kumbh-map relative h-screen w-full">
      <div ref={mapContainer} className="h-full w-full" />

      {/* Measure distance -- floating button cluster beside the hamburger
          menu (SidebarToggle sits at left-4 top-4, h-10 w-10) rather than
          inside the left panel, so it's reachable without opening the
          panel. Undo/redo appear beside it only while measuring. */}
      <div className="fixed left-16 top-4 z-30 flex items-center gap-1.5">
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
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-2.5 shadow-lg backdrop-blur-md transition-colors hover:brightness-95"
        >
          <RulerIcon className="h-4 w-4 shrink-0" />
          {measuring && (
            <span className="text-[11.5px] font-semibold whitespace-nowrap">
              {measure.points.length >= 2
                ? formatDistance(measureTotalM)
                : measure.points.length === 1
                  ? 'Click to add points…'
                  : 'Click to start measuring'}
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
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border shadow-lg backdrop-blur-md transition-colors hover:brightness-95 disabled:pointer-events-none disabled:opacity-40"
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
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border shadow-lg backdrop-blur-md transition-colors hover:brightness-95 disabled:pointer-events-none disabled:opacity-40"
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
              <div className="mb-1.5 flex flex-wrap gap-1">
                {classFilter.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleClassFilter(c)}
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
                    const total = subclassStats.filter((r) => r.class_group === c).length
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
                        <span className="truncate max-w-[9rem]">
                          {c} ({subs.length}/{total})
                        </span>
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
                {POI_LAYER_DEFS.filter((d) => visibility[d.key]).map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setVisibility((v) => ({ ...v, [d.key]: false }))}
                    style={{ background: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full py-0.5 pl-2 pr-1.5 text-[11.5px] font-medium transition-colors hover:brightness-95"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: d.color }}
                    />
                    <span className="truncate max-w-[9rem]">{d.label}</span>
                    <XIcon className="h-2.5 w-2.5 shrink-0" />
                  </button>
                ))}
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
                style={{
                  borderColor: 'var(--map-border)',
                  background: 'var(--map-input-bg)',
                  color: 'var(--map-fg)',
                }}
                className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-[14px] placeholder:text-[var(--map-fg-faint)] outline-none transition-shadow focus:border-[var(--map-accent)] focus:ring-2 focus:ring-[var(--map-accent)]/25"
              />
            </div>
            {panelDropdownOpen && (
              <ul
                role="listbox"
                aria-multiselectable="true"
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
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleCollapsedGroup(group)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleCollapsedGroup(group)
                          }
                        }}
                        aria-expanded={!collapsed}
                        className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-[var(--map-surface-hover)]"
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
                          className="flex-1 text-[10.5px] font-bold uppercase tracking-wide"
                          style={{ color: 'var(--map-fg-muted)' }}
                        >
                          {group}
                        </span>
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
                            <li
                              key={s.sector_no}
                              role="option"
                              aria-selected={selectedSector === s.sector_no}
                            >
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
                            const subclasses = subclassStats
                              .filter((r) => r.class_group === c)
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
                            const subclassNameMatches =
                              q !== '' &&
                              subclasses.some((s) => s.subclass.toLowerCase().includes(q))
                            const isExpanded = expandedFilterClasses.has(c) || subclassNameMatches
                            // While actively searching, only show the subclasses that
                            // themselves match the query -- a class can match via one
                            // subclass (e.g. "hospital" -> Health Camping, because "4
                            // Bedded Hospital" matches) without dumping its whole
                            // unrelated subclass list ("Firstaid Center", etc.) into
                            // view. Once the query is cleared/manually expanded, the
                            // full list comes back.
                            const visibleSubclasses = subclassNameMatches
                              ? subclasses.filter((s) => s.subclass.toLowerCase().includes(q))
                              : subclasses
                            return (
                              <li key={c} role="option" aria-selected={isChecked}>
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
                                        <li
                                          key={row.subclass}
                                          role="option"
                                          aria-selected={subChecked}
                                        >
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
                            <li key={d.key} role="option" aria-selected={visibility[d.key]}>
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
                          {matchedPois.map((d) => {
                            const signageCode = POI_SIGNAGE_CODES[d.key]
                            return (
                              <li key={d.key} role="option" aria-selected={visibility[d.key]}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setVisibility((v) => ({ ...v, [d.key]: !v[d.key] }))
                                  }
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
                                      borderColor: visibility[d.key]
                                        ? d.color
                                        : 'var(--map-border)',
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
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {!collapsed && group === 'Base layers' && (
                        <ul>
                          {matchedBaseLayers.map(({ key, label, icon: Icon }) => (
                            <li key={key} role="option" aria-selected={visibility[key]}>
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
        locateResult={locateResult}
        onLocateFeatureClick={flyToLocateFeature}
        poiVisibility={visibility}
        onTogglePoiLayer={handlePoiRowClick}
        poiLocateResult={poiLocateResult}
        onPoiLocateFeatureClick={flyToLocateFeature}
        roadTypeVisibility={visibility}
        onToggleRoadType={(key) => setVisibility((v) => ({ ...v, [key]: !v[key] }))}
        onWidthChange={(w) => {
          statsPanelWidthRef.current = w
        }}
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
