'use client'

import { useEffect, useRef, useState } from 'react'
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
import Panel from '@/components/map/Panel'
import {
  ChartBarIcon,
  ChevronDownIcon,
  CompassIcon,
  LayersIcon,
  RulerIcon,
  SearchIcon,
  TagIcon,
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
    button.style.background = active ? '#2563eb' : '#fff'
    button.style.color = active ? '#fff' : '#333'
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
      background: '#fff',
      color: '#333',
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
const POI_LAYERS_EXPANDED_STORAGE_KEY = 'tcsticket:mapView:poiLayersExpanded'

function defaultVisibility(): Record<string, boolean> {
  return {
    sector_plan: true,
    sector_boundary: true,
    ...Object.fromEntries(ROAD_TYPE_DEFS.map((d) => [d.key, true])),
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

function loadStoredPoiLayersExpanded(): boolean {
  try {
    return localStorage.getItem(POI_LAYERS_EXPANDED_STORAGE_KEY) === 'true'
  } catch {
    return false
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

  const [sectors, setSectors] = useState<Sector[]>([])
  const [selectedSector, setSelectedSector] = useState<number | 'all'>(
    initialParcel?.sectorNo ?? 'all',
  )
  const [visibility, setVisibility] = useState<Record<string, boolean>>(loadStoredVisibility)
  const [classFilter, setClassFilter] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [classSearch, setClassSearch] = useState('')
  const [classDropdownOpen, setClassDropdownOpen] = useState(false)
  const [sectorDropdownOpen, setSectorDropdownOpen] = useState(false)
  const [poiLayersExpanded, setPoiLayersExpanded] = useState(loadStoredPoiLayersExpanded)
  const [measuring, setMeasuring] = useState(false)
  const [measureDistanceM, setMeasureDistanceM] = useState<number | null>(null)
  /** Mirrors measurePointsRef.current.length purely so the "Click 1st/2nd point…" hint text
   *  re-renders -- refs don't trigger renders, and the click handler that mutates the ref lives
   *  in a one-time 'load' callback that can't call other state setters' closures directly. */
  const [measurePointCount, setMeasurePointCount] = useState(0)
  const classDropdownRef = useRef<HTMLDivElement>(null)
  const sectorDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!classDropdownOpen) return
    function onPointerDown(e: PointerEvent) {
      if (!classDropdownRef.current?.contains(e.target as Node)) setClassDropdownOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [classDropdownOpen])

  useEffect(() => {
    if (!sectorDropdownOpen) return
    function onPointerDown(e: PointerEvent) {
      if (!sectorDropdownRef.current?.contains(e.target as Node)) setSectorDropdownOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [sectorDropdownOpen])

  useEffect(() => {
    fetch('/api/sectors')
      .then((r) => r.json())
      .then(setSectors)
      .catch(() => {})
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(visibility))
    } catch {}
  }, [visibility])

  useEffect(() => {
    try {
      localStorage.setItem(POI_LAYERS_EXPANDED_STORAGE_KEY, String(poiLayersExpanded))
    } catch {}
  }, [poiLayersExpanded])

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
    const accentColor = poiDef?.color ?? '#2563eb'

    return `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:14px 16px 12px;border-bottom:1px solid #f1f5f9">
        <span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border-radius:9px;background:${accentColor}18;color:${accentColor}">
          <svg viewBox="0 0 24 24" fill="none" width="17" height="17">${POPUP_ICON_PATHS[kind]}</svg>
        </span>
        <div style="min-width:0">
          <div style="font-size:13.5px;font-weight:700;color:#0f172a;line-height:1.3;overflow-wrap:anywhere">${escapeHtml(title)}</div>
          ${subtitle ? `<div style="margin-top:1px;font-size:11.5px;color:#64748b">${escapeHtml(subtitle)}</div>` : ''}
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
          `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:5px 0;${i > 0 ? 'border-top:1px solid #f8fafc' : ''}">
            <span style="font-size:11.5px;color:#94a3b8">${escapeHtml(k)}</span>
            <span style="font-size:12.5px;font-weight:600;color:#1e293b;text-align:right;overflow-wrap:anywhere">${
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

    return `<div style="margin:12px 16px 14px;padding-top:12px;border-top:1px solid #f1f5f9">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap">
        ${ticket.status ? badge(ticket.status.name, ticket.status.color) : ''}
        ${ticket.priority ? badge(ticket.priority.name, ticket.priority.color) : ''}
      </div>
      <p style="margin:0 0 9px;font-size:12.5px;line-height:1.45;color:#334155;overflow-wrap:anywhere">${escapeHtml(ticket.subject)}</p>
      <a href="/tickets/${ticket.number}" style="display:inline-flex;align-items:center;gap:4px;color:#2563eb;font-weight:700;text-decoration:none;font-size:12px">Show the ticket <span style="font-size:13px">→</span></a>
    </div>`
  }

  function showPopup(map: MLMap, feature: MapGEOJSONFeatureCompat, lngLat: LngLat) {
    popupRef.current?.remove()
    popupParcelIdRef.current = null

    const baseHtml = (ticketHtml: string) =>
      `<div style="font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;width:240px;background:#fff;border-radius:16px">${popupHeaderHtml(feature)}${propertyRowsHtml(feature)}${ticketHtml}</div>`

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

      // Measure-distance line -- plain client-side GeoJSON (not a vector
      // tile source like everything else here), rewritten in place each
      // time a measurement point is placed/cleared. See the measure-mode
      // click handling below and the effect that resets it when `measuring`
      // toggles off.
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

      // Distance label -- a separate point source at the line's midpoint
      // (computed alongside the line itself in updateMeasureLine), rather
      // than trying to place text along the line geometry directly, which
      // MapLibre doesn't give precise placement control over for a plain
      // 2-point segment.
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

      function updateMeasureLine(coords: [number, number][]) {
        const lineSrc = map.getSource('measure-line')
        const labelSrc = map.getSource('measure-label')
        if (coords.length !== 2) {
          if (lineSrc && 'setData' in lineSrc) {
            ;(lineSrc as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] })
          }
          if (labelSrc && 'setData' in labelSrc) {
            ;(labelSrc as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] })
          }
          return
        }

        if (lineSrc && 'setData' in lineSrc) {
          ;(lineSrc as GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: coords },
              },
            ],
          })
        }

        if (labelSrc && 'setData' in labelSrc) {
          const midpoint: [number, number] = [
            (coords[0][0] + coords[1][0]) / 2,
            (coords[0][1] + coords[1][1]) / 2,
          ]
          const label = formatDistance(haversineDistanceM(coords[0], coords[1]))
          ;(labelSrc as GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { label },
                geometry: { type: 'Point', coordinates: midpoint },
              },
            ],
          })
        }
      }

      // Apply the initial layer visibility (POI layers default to off) right
      // away, synchronously with layer creation -- every layer above is
      // added with MapLibre's default 'visible' layout, so without this the
      // POI dots/lines/fills would render (or stay rendered indefinitely, if
      // the separate visibility-syncing effect below never re-runs) despite
      // the sidebar's toggles showing off.
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
        // stale value forever.
        if (measuringRef.current) {
          const point: [number, number] = [e.lngLat.lng, e.lngLat.lat]
          // A 3rd click starts a fresh measurement rather than extending
          // past two points -- this feature is two-point-only by design.
          if (measurePointsRef.current.length >= 2) {
            measureMarkersRef.current.forEach((m) => m.remove())
            measureMarkersRef.current = []
            measurePointsRef.current = []
            setMeasureDistanceM(null)
            updateMeasureLine([])
          }

          measurePointsRef.current = [...measurePointsRef.current, point]
          setMeasurePointCount(measurePointsRef.current.length)
          const marker = new Marker({ element: makeMeasurePointElement() })
            .setLngLat(point)
            .addTo(map)
          measureMarkersRef.current = [...measureMarkersRef.current, marker]

          if (measurePointsRef.current.length === 2) {
            updateMeasureLine(measurePointsRef.current)
            setMeasureDistanceM(
              haversineDistanceM(measurePointsRef.current[0], measurePointsRef.current[1]),
            )
          }
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

      // Live rubber-band: once the first measure point is placed but before
      // the second click, the line and distance track the cursor
      // continuously instead of only appearing after the 2nd click --
      // reads as "measuring toward" a destination rather than a static
      // after-the-fact result.
      map.on('mousemove', (e) => {
        if (!measuringRef.current || measurePointsRef.current.length !== 1) return
        const live: [number, number] = [e.lngLat.lng, e.lngLat.lat]
        const coords: [number, number][] = [measurePointsRef.current[0], live]
        updateMeasureLine(coords)
        setMeasureDistanceM(haversineDistanceM(coords[0], coords[1]))
      })
    })

    return () => {
      marker?.remove()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial-view-only prop, map is created once
  }, [])

  // Removes any in-progress measurement's markers/line from the map --
  // pure external-system cleanup, no state updates (callers that also need
  // to reset the React-side measureDistanceM/measurePointCount call those
  // setters themselves alongside this).
  function clearMeasurement() {
    measureMarkersRef.current.forEach((m) => m.remove())
    measureMarkersRef.current = []
    measurePointsRef.current = []
    const map = mapRef.current
    const lineSrc = map?.getSource('measure-line')
    if (lineSrc && 'setData' in lineSrc) {
      ;(lineSrc as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] })
    }
    const labelSrc = map?.getSource('measure-label')
    if (labelSrc && 'setData' in labelSrc) {
      ;(labelSrc as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] })
    }
  }

  // Keeps measuringRef in sync for the click handler above (registered once
  // on mount, so it can't read `measuring` state directly) and swaps the
  // cursor to a crosshair while active. Clearing in-progress state when
  // measure mode turns off happens in the toggle button's onClick instead of
  // here, since that's a real user action rather than external-system sync.
  useEffect(() => {
    measuringRef.current = measuring
    const map = mapRef.current
    if (map) map.getCanvas().style.cursor = measuring ? 'crosshair' : ''
  }, [measuring])

  // Layer visibility -- reacts to toggling the sidebar's switches. The
  // initial state (POI layers off) is also applied synchronously at
  // layer-creation time inside the map's 'load' handler above, since this
  // effect is keyed on `visibility` identity and a value that's merely
  // *present* on mount (never *changed*) doesn't trigger it.
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

    const classCondition =
      classFilter === 'all' ? null : ['==', ['get', 'class_group'], classFilter]

    const combined = [sectorFilter, classCondition].filter(Boolean) as unknown[]
    const finalFilter =
      combined.length === 0 ? null : combined.length === 1 ? combined[0] : ['all', ...combined]

    map.setFilter('sector-plan-fill', finalFilter as FilterSpecification | null)

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
      const parkingFilter =
        classFilter !== 'all' && classFilter !== 'Parking'
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
          { padding: 60, duration: 800 },
        )
      }
    }
  }, [selectedSector, classFilter, sectors, visibility])

  const classGroups = Object.keys(CLASS_GROUP_COLORS).sort((a, b) => a.localeCompare(b))
  const filteredSectors = search.trim()
    ? sectors.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()))
    : sectors
  const filteredClassGroups = classSearch.trim()
    ? classGroups.filter((c) => c.toLowerCase().includes(classSearch.trim().toLowerCase()))
    : classGroups

  function goToSearch() {
    if (filteredSectors.length > 0) {
      setSelectedSector(filteredSectors[0].sector_no)
      setSectorDropdownOpen(false)
    }
  }

  function goToClassSearch() {
    if (filteredClassGroups.length > 0) {
      setClassFilter(filteredClassGroups[0])
      setClassDropdownOpen(false)
    }
  }

  const selectedSectorObj =
    selectedSector !== 'all' ? sectors.find((s) => s.sector_no === selectedSector) : undefined
  const sectorInputValue = selectedSectorObj ? formatSectorLabel(selectedSectorObj) : search
  const classInputValue = classFilter !== 'all' ? classFilter : classSearch

  const baseLayerRows: Array<{ key: string; label: string; color?: string }> = [
    { key: 'sector_plan', label: 'Sector plan' },
    { key: 'sector_boundary', label: 'Boundaries' },
  ]
  // "More layers" list -- the 16 POI layers plus the 3 road types, merged
  // into one alphabetically-sorted list (POI_LAYER_DEFS itself stays grouped
  // by geometry type since that order also drives map paint order, see
  // byGeomType usage above, so this is a sorted copy just for the sidebar).
  const moreLayerDefs = [
    ...POI_LAYER_DEFS.map((d) => ({
      key: d.key,
      label: d.label,
      color: d.color,
      isRoad: false as const,
    })),
    ...ROAD_TYPE_DEFS.map((d) => ({
      key: d.key,
      label: d.label,
      color: d.color,
      isRoad: true as const,
      dash: d.dash,
    })),
  ].sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="kumbh-map relative h-screen w-full">
      <div ref={mapContainer} className="h-full w-full" />

      {/* Measure distance -- floating button beside the hamburger menu
          (SidebarToggle sits at left-4 top-4, h-10 w-10) rather than inside
          the left panel, so it's reachable without opening the panel. */}
      <button
        type="button"
        onClick={() => {
          setMeasuring((v) => {
            const next = !v
            if (!next) {
              clearMeasurement()
              setMeasureDistanceM(null)
              setMeasurePointCount(0)
            }
            return next
          })
        }}
        aria-pressed={measuring}
        aria-label="Measure distance"
        title="Measure distance"
        className={`fixed left-16 top-4 z-30 inline-flex h-10 items-center gap-1.5 rounded-lg border px-2.5 shadow-lg backdrop-blur-md transition-colors ${
          measuring
            ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
            : 'border-slate-900/8 bg-white/92 text-slate-700 hover:bg-white hover:text-slate-900'
        }`}
      >
        <RulerIcon className="h-4 w-4 shrink-0" />
        {measuring && (
          <span className="text-[11.5px] font-semibold whitespace-nowrap">
            {measureDistanceM !== null
              ? formatDistance(measureDistanceM)
              : measurePointCount === 1
                ? 'Click 2nd point…'
                : 'Click 1st point…'}
          </span>
        )}
      </button>

      <Panel
        icon={<CompassIcon className="h-full w-full" />}
        title="Kumbh Mela"
        subtitle="Sector plan · Haridwar–Rishikesh"
        side="left"
        overlayOpen={sectorDropdownOpen || classDropdownOpen}
      >
        <div className="flex flex-col gap-4">
          {/* Sector search / select combobox */}
          <div ref={sectorDropdownRef} className="relative">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <LayersIcon className="h-3.5 w-3.5" />
              Sector
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={sectorInputValue}
                onFocus={() => {
                  // Re-entering the box after a sector is selected starts a
                  // fresh search rather than editing the "N. Name" label.
                  if (selectedSectorObj) setSearch('')
                  setSectorDropdownOpen(true)
                }}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setSectorDropdownOpen(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') goToSearch()
                  if (e.key === 'Escape') setSectorDropdownOpen(false)
                }}
                placeholder="All sectors"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
              />
            </div>
            {sectorDropdownOpen && (
              <ul
                role="listbox"
                className="absolute z-10 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
              >
                <li role="option" aria-selected={selectedSector === 'all'}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSector('all')
                      setSearch('')
                      setSectorDropdownOpen(false)
                    }}
                    className={`w-full cursor-pointer px-2.5 py-1.5 text-left text-[13px] text-slate-900 hover:bg-slate-50 ${selectedSector === 'all' ? 'bg-slate-100' : ''}`}
                  >
                    All sectors
                  </button>
                </li>
                {filteredSectors.length === 0 && (
                  <li className="px-2.5 py-1.5 text-[12.5px] text-slate-400">No sectors match</li>
                )}
                {filteredSectors.map((s) => (
                  <li
                    key={s.sector_no}
                    role="option"
                    aria-selected={selectedSector === s.sector_no}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSector(s.sector_no)
                        setSearch('')
                        setSectorDropdownOpen(false)
                      }}
                      className={`w-full cursor-pointer px-2.5 py-1.5 text-left text-[13px] text-slate-900 hover:bg-slate-50 ${selectedSector === s.sector_no ? 'bg-slate-100' : ''}`}
                    >
                      {formatSectorLabel(s)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Class search / select combobox */}
          <div ref={classDropdownRef} className="relative">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <TagIcon className="h-3.5 w-3.5" />
              Class
            </div>
            <div className="relative">
              {classFilter !== 'all' ? (
                <span
                  className="pointer-events-none absolute left-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
                  style={{ background: CLASS_GROUP_COLORS[classFilter] }}
                />
              ) : (
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              )}
              <input
                type="text"
                value={classInputValue}
                onFocus={() => {
                  // Re-entering the box after a class is selected starts a
                  // fresh search rather than editing the selected label.
                  if (classFilter !== 'all') setClassSearch('')
                  setClassDropdownOpen(true)
                }}
                onChange={(e) => {
                  setClassSearch(e.target.value)
                  setClassDropdownOpen(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') goToClassSearch()
                  if (e.key === 'Escape') setClassDropdownOpen(false)
                }}
                placeholder="All classes"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
              />
            </div>
            {classDropdownOpen && (
              <ul
                role="listbox"
                className="absolute z-10 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
              >
                <li role="option" aria-selected={classFilter === 'all'}>
                  <button
                    type="button"
                    onClick={() => {
                      setClassFilter('all')
                      setClassSearch('')
                      setClassDropdownOpen(false)
                    }}
                    className={`w-full cursor-pointer px-2.5 py-1.5 text-left text-[13px] text-slate-900 hover:bg-slate-50 ${classFilter === 'all' ? 'bg-slate-100' : ''}`}
                  >
                    All classes
                  </button>
                </li>
                {filteredClassGroups.length === 0 && (
                  <li className="px-2.5 py-1.5 text-[12.5px] text-slate-400">No classes match</li>
                )}
                {filteredClassGroups.map((c) => (
                  <li key={c} role="option" aria-selected={classFilter === c}>
                    <button
                      type="button"
                      onClick={() => {
                        setClassFilter(c)
                        setClassSearch('')
                        setClassDropdownOpen(false)
                      }}
                      className={`flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-slate-900 hover:bg-slate-50 ${classFilter === c ? 'bg-slate-100' : ''}`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: CLASS_GROUP_COLORS[c] }}
                      />
                      <span className="truncate">{c}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Layers */}
          <div className="border-t border-slate-100 pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Layers
            </div>

            {/* Basics -- always visible, one per row like before */}
            <div className="flex flex-col gap-2.5">
              {baseLayerRows.map(({ key, label, color }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {color && (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ background: color }}
                      />
                    )}
                    <span className="truncate text-[13px] font-medium text-slate-800">{label}</span>
                  </span>
                  <label className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={visibility[key]}
                      onChange={(e) => setVisibility((v) => ({ ...v, [key]: e.target.checked }))}
                    />
                    <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/40" />
                    <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                  </label>
                </div>
              ))}
            </div>

            {/* POI layers -- collapsed behind a disclosure so the 16-item
                list doesn't force long scrolling by default. Expanded view
                keeps the same single-column, full-width-row, switch-control
                pattern as the basics above (rather than a cramped 2-col grid
                of native checkboxes) so labels never truncate and every row
                stays a comfortable touch target. */}
            <button
              type="button"
              onClick={() => setPoiLayersExpanded((v) => !v)}
              aria-expanded={poiLayersExpanded}
              className="mt-2.5 flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 text-left hover:bg-slate-100/70"
            >
              <span className="text-[13px] font-medium text-slate-800">
                More layers
                <span className="ml-1.5 text-[11.5px] font-normal text-slate-400">
                  {moreLayerDefs.filter((d) => visibility[d.key]).length}/{moreLayerDefs.length} on
                </span>
              </span>
              <ChevronDownIcon
                className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${poiLayersExpanded ? 'rotate-180' : ''}`}
              />
            </button>
            {poiLayersExpanded && (
              <div className="mt-2">
                <div className="mb-1.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      const nextValue = !moreLayerDefs.every((d) => visibility[d.key])
                      setVisibility((v) => {
                        const next = { ...v }
                        for (const { key } of moreLayerDefs) next[key] = nextValue
                        return next
                      })
                    }}
                    className="cursor-pointer text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {moreLayerDefs.every((d) => visibility[d.key]) ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="kumbh-scroll flex max-h-72 flex-col gap-1 overflow-y-auto pr-0.5">
                  {moreLayerDefs.map((def) => {
                    const { key, label, color, isRoad } = def
                    const signageCode = POI_SIGNAGE_CODES[key]
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {isRoad ? (
                            <span
                              className="h-0 w-3 shrink-0"
                              style={{
                                borderTopWidth: 2,
                                borderTopColor: color,
                                borderTopStyle: def.dash ? 'dashed' : 'solid',
                              }}
                            />
                          ) : signageCode ? (
                            <span
                              className="flex h-3.5 shrink-0 items-center justify-center rounded-[3px] px-1 text-[8.5px] font-bold leading-none text-white"
                              style={{ background: color }}
                            >
                              {signageCode}
                            </span>
                          ) : (
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                              style={{ background: color }}
                            />
                          )}
                          <span className="text-[12.5px] leading-snug text-slate-700">{label}</span>
                        </span>
                        <label className="relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center">
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={visibility[key]}
                            onChange={(e) =>
                              setVisibility((v) => ({ ...v, [key]: e.target.checked }))
                            }
                          />
                          <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/40" />
                          <span className="absolute left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-3.5" />
                        </label>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
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
        classFilter={classFilter}
        onClassFilterChange={setClassFilter}
        poiVisibility={visibility}
        onTogglePoiLayer={(key) => setVisibility((v) => ({ ...v, [key]: !v[key] }))}
        roadTypeVisibility={visibility}
        onToggleRoadType={(key) => setVisibility((v) => ({ ...v, [key]: !v[key] }))}
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
