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
  POINT_LAYER_COLORS,
  POINT_LAYER_LABELS,
  LINE_LAYER_COLORS,
  LINE_LAYER_LABELS,
  POLYGON_LAYER_COLORS,
  POLYGON_LAYER_LABELS,
} from '@/lib/classColors'
import StatsPanel from '@/components/map/StatsPanel'
import Panel from '@/components/map/Panel'
import {
  ChartBarIcon,
  ChevronDownIcon,
  CompassIcon,
  LayersIcon,
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

function matchExpr(
  field: string,
  colors: Record<string, string>,
  fallback: string,
): ExpressionSpecification {
  const pairs = Object.entries(colors).flat()
  return ['match', ['get', field], ...pairs, fallback] as unknown as ExpressionSpecification
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

// Short signage codes shown as an on-map text label for a few POI point
// layers, per user request -- not every layer needs one.
const POI_SIGNAGE_CODES: Record<string, string> = {
  bus_stop: 'BS',
  kumbh_mela_2027_ghat: 'G',
}

type InitialParcel = {
  sectorPlanId: number
  lng: number
  lat: number
  sectorNo: number | null
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

  const [sectors, setSectors] = useState<Sector[]>([])
  const [selectedSector, setSelectedSector] = useState<number | 'all'>(
    initialParcel?.sectorNo ?? 'all',
  )
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => ({
    sector_plan: true,
    road: true,
    sector_boundary: true,
    ...Object.fromEntries(POI_LAYER_DEFS.map((d) => [d.key, true])),
  }))
  const [classFilter, setClassFilter] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [showStats, setShowStats] = useState(true)
  const [classDropdownOpen, setClassDropdownOpen] = useState(false)
  const classDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!classDropdownOpen) return
    function onPointerDown(e: PointerEvent) {
      if (!classDropdownRef.current?.contains(e.target as Node)) setClassDropdownOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [classDropdownOpen])

  useEffect(() => {
    fetch('/api/sectors')
      .then((r) => r.json())
      .then(setSectors)
      .catch(() => {})
  }, [])

  function propertyRowsHtml(feature: MapGEOJSONFeatureCompat) {
    const p = feature.properties ?? {}
    const rows: [string, unknown][] =
      feature.layer.id === 'road-line'
        ? [
            ['Road name', p.road_name],
            ['Type', p.type],
            ['ROW width (m)', p.row_width_m],
            ['Sector', p.sector_no],
          ]
        : feature.layer.id === 'sector-boundary-line' || feature.layer.id === 'sector-hit-target'
          ? [
              ['Name', p.name],
              ['Sector no.', p.sector_no],
              ['Area (ha)', p.area_hac],
            ]
          : [
              ['Label', p.label],
              ['Class', p.class],
              ['Subclass', p.subclass],
              ['Plot No.', p.plot_no],
              ['Block', p.block],
              ['Sector', p.sector_no ?? 'Peripheral'],
              ['Area (ha)', typeof p.area === 'number' ? p.area.toFixed(3) : p.area],
            ]

    return rows
      .filter(([, v]) => v !== undefined)
      .map(
        ([k, v]) =>
          `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;color:#111827"><b>${k}</b><span>${
            v === null || v === '' ? '—' : v
          }</span></div>`,
      )
      .join('')
  }

  function ticketRowsHtml(ticket: {
    number: number
    subject: string
    status: { name: string; color: string } | null
    priority: { name: string; color: string } | null
  }) {
    return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
        ${
          ticket.status
            ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:${ticket.status.color}"><span style="height:6px;width:6px;border-radius:999px;background:${ticket.status.color}"></span>${ticket.status.name}</span>`
            : ''
        }
        ${
          ticket.priority
            ? `<span style="font-size:11px;font-weight:600;color:${ticket.priority.color}">${ticket.priority.name}</span>`
            : ''
        }
      </div>
      <p style="margin:0 0 6px;font-size:12.5px;color:#374151">${ticket.subject}</p>
      <a href="/tickets/${ticket.number}" style="color:#2563eb;font-weight:600;text-decoration:none;font-size:12.5px">Show the Ticket →</a>
    </div>`
  }

  function showPopup(map: MLMap, feature: MapGEOJSONFeatureCompat, lngLat: LngLat) {
    popupRef.current?.remove()
    popupParcelIdRef.current = null

    const html = `<div style="font:13px system-ui;min-width:180px;color:#111827">${propertyRowsHtml(feature)}</div>`
    const popup = new Popup({ closeButton: true }).setLngLat(lngLat).setHTML(html).addTo(map)
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
        popup.setHTML(
          `<div style="font:13px system-ui;min-width:180px;color:#111827">${propertyRowsHtml(feature)}${ticketRowsHtml(data.ticket)}</div>`,
        )
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
    })
    mapRef.current = map
    map.addControl(new NavigationControl(), 'top-right')

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
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            1,
            16,
            ['max', 1, ['/', ['coalesce', ['get', 'row_width_m'], 6], 3]],
          ],
        },
      })
      map.addLayer({
        id: 'sector-boundary-line',
        type: 'line',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        paint: {
          'line-color': '#111827',
          'line-width': 2,
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
          },
        })

        const signageCode = POI_SIGNAGE_CODES[def.key]
        if (signageCode) {
          map.addLayer({
            id: `poi-${def.key}-label`,
            type: 'symbol',
            source: def.key,
            'source-layer': def.key,
            layout: {
              'text-field': signageCode,
              'text-font': ['Noto Sans Bold'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 18, 14],
              'text-offset': [0, 1.1],
              'text-anchor': 'top',
              'text-allow-overlap': false,
            },
            paint: {
              'text-color': def.color,
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.2,
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

      // Whole-sector hover highlight (amber) -- filter-driven rather than
      // per-feature feature-state, since a sector spans hundreds of small
      // sector_plan parcels that would be expensive to track individually.
      map.addLayer({
        id: 'sector-hover-fill',
        type: 'fill',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'sector-hover-outline',
        type: 'line',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: { 'line-color': '#f59e0b', 'line-width': 4, 'line-opacity': 0.95 },
      })
      // Selected-sector outline (blue) -- sector-plan-fill/road-line are
      // already filtered down to just this sector elsewhere; this outline
      // is the extra visual anchor for which one that is.
      map.addLayer({
        id: 'sector-selected-outline',
        type: 'line',
        source: 'sector_boundary',
        'source-layer': 'sector_boundary',
        filter: NO_MATCH,
        paint: { 'line-color': '#2563eb', 'line-width': 3.5, 'line-opacity': 1 },
      })

      function setHoverFilter(sectorNo: number | null) {
        const filter: FilterSpecification =
          sectorNo === null ? NO_MATCH : ['==', ['get', 'sector_no'], sectorNo]
        map.setFilter('sector-hover-fill', filter)
        map.setFilter('sector-hover-outline', filter)
      }

      map.on('mousemove', 'sector-hit-target', (e: MapLayerMouseEvent) => {
        const raw = e.features?.[0]?.properties?.sector_no
        const sectorNo = typeof raw === 'number' ? raw : null
        if (hoveredSectorRef.current !== sectorNo) {
          hoveredSectorRef.current = sectorNo
          setHoverFilter(sectorNo)
        }
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'sector-hit-target', () => {
        hoveredSectorRef.current = null
        setHoverFilter(null)
        map.getCanvas().style.cursor = ''
      })

      // Single map-wide click handler drives selection: clicking any
      // feature inside a sector (a parcel, a road, or just bare sector
      // area via the hit-target) selects that sector everywhere -- the
      // dropdown, the map filter/fly-to, and the Stats panel all key off
      // the same selectedSector state. Clicking outside every sector
      // deselects back to "All sectors".
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['sector-plan-fill', 'road-line', 'sector-hit-target'],
        })
        if (hits.length === 0) {
          setSelectedSector('all')
          popupRef.current?.remove()
          popupParcelIdRef.current = null
          return
        }
        const detail =
          hits.find((f) => f.layer.id === 'sector-plan-fill' || f.layer.id === 'road-line') ??
          hits[0]
        const raw = detail.properties?.sector_no
        setSelectedSector(typeof raw === 'number' ? raw : 'all')
        showPopup(map, detail as unknown as MapGEOJSONFeatureCompat, e.lngLat)
      })
    })

    return () => {
      marker?.remove()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial-view-only prop, map is created once
  }, [])

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(
      [
        ['sector-plan-fill', visibility.sector_plan],
        ['sector-plan-peripheral-outline', visibility.sector_plan],
        ['sector-plan-parking-label', visibility.sector_plan],
        ['road-line', visibility.road],
        ['sector-boundary-line', visibility.sector_boundary],
        ['sector-hover-fill', visibility.sector_boundary],
        ['sector-hover-outline', visibility.sector_boundary],
        ['sector-selected-outline', visibility.sector_boundary],
        ...POI_LAYER_DEFS.flatMap(
          (d) =>
            [
              [`poi-${d.key}`, visibility[d.key]],
              [`poi-${d.key}-label`, visibility[d.key]],
            ] as [string, boolean][],
        ),
      ] as const
    ).forEach(([id, visible]) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      }
    })
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
    map.setFilter('road-line', sectorFilter as FilterSpecification | null)

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
  }, [selectedSector, classFilter, sectors])

  const classGroups = Object.keys(CLASS_GROUP_COLORS)
  const filteredSectors = search.trim()
    ? sectors.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()))
    : sectors

  function goToSearch() {
    if (filteredSectors.length > 0) {
      setSelectedSector(filteredSectors[0].sector_no)
    }
  }

  const layerRows: Array<{ key: string; label: string; color?: string }> = [
    { key: 'sector_plan', label: 'Sector plan' },
    { key: 'road', label: 'Roads' },
    { key: 'sector_boundary', label: 'Boundaries' },
    ...POI_LAYER_DEFS.map((d) => ({ key: d.key, label: d.label, color: d.color })),
  ]

  return (
    <div className="kumbh-map relative h-screen w-full">
      <div ref={mapContainer} className="h-full w-full" />

      <Panel
        icon={<CompassIcon className="h-full w-full" />}
        title="Kumbh Mela"
        subtitle="Sector plan · Haridwar–Rishikesh"
        side="left"
      >
        <div className="flex flex-col gap-4">
          {/* Search */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <SearchIcon className="h-3.5 w-3.5" />
              Search sector
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') goToSearch()
                }}
                placeholder="e.g. Rishikesh"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
              />
            </div>
          </div>

          {/* Sector + class filters */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <LayersIcon className="h-3.5 w-3.5" />
                Sector
              </label>
              <select
                value={selectedSector}
                onChange={(e) =>
                  setSelectedSector(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
                className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-900 outline-none transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
              >
                <option value="all">All sectors</option>
                {filteredSectors.map((s) => (
                  <option key={s.sector_no} value={s.sector_no}>
                    {s.sector_no}. {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div ref={classDropdownRef} className="relative">
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <TagIcon className="h-3.5 w-3.5" />
                Class
              </label>
              <button
                type="button"
                onClick={() => setClassDropdownOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={classDropdownOpen}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[13px] text-slate-900 outline-none transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {classFilter !== 'all' && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: CLASS_GROUP_COLORS[classFilter] }}
                    />
                  )}
                  <span className="truncate">
                    {classFilter === 'all' ? 'All classes' : classFilter}
                  </span>
                </span>
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${classDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {classDropdownOpen && (
                <ul
                  role="listbox"
                  className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <li role="option" aria-selected={classFilter === 'all'}>
                    <button
                      type="button"
                      onClick={() => {
                        setClassFilter('all')
                        setClassDropdownOpen(false)
                      }}
                      className={`w-full cursor-pointer px-2.5 py-1.5 text-left text-[13px] text-slate-900 hover:bg-slate-50 ${classFilter === 'all' ? 'bg-slate-100' : ''}`}
                    >
                      All classes
                    </button>
                  </li>
                  {classGroups.map((c) => (
                    <li key={c} role="option" aria-selected={classFilter === c}>
                      <button
                        type="button"
                        onClick={() => {
                          setClassFilter(c)
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
          </div>

          {/* Layers */}
          <div className="border-t border-slate-100 pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Layers
              </span>
              <button
                type="button"
                onClick={() => {
                  const nextValue = !layerRows.every(({ key }) => visibility[key])
                  setVisibility((v) => {
                    const next = { ...v }
                    for (const { key } of layerRows) next[key] = nextValue
                    return next
                  })
                }}
                className="cursor-pointer text-[11px] font-semibold text-blue-600 hover:text-blue-700"
              >
                {layerRows.every(({ key }) => visibility[key]) ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              {layerRows.map(({ key, label, color }) => (
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
          </div>

          {/* Legend */}
          <div className="border-t border-slate-100 pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Legend
            </div>
            <div className="grid grid-cols-1 gap-1">
              {classGroups.map((c) => (
                <div key={c} className="flex items-center gap-2 text-[12.5px] text-slate-700">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ background: CLASS_GROUP_COLORS[c] }}
                  />
                  {c}
                </div>
              ))}
              <div className="flex items-center gap-2 text-[12.5px] text-slate-700">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] border-[1.5px] border-dashed border-orange-500" />
                Peripheral (outside numbered sectors)
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {showStats && (
        <StatsPanel
          icon={<ChartBarIcon className="h-full w-full" />}
          onClose={() => setShowStats(false)}
          sectorNo={selectedSector === 'all' ? null : selectedSector}
          sectorLabel={
            selectedSector !== 'all'
              ? (() => {
                  const s = sectors.find((x) => x.sector_no === selectedSector)
                  return s ? `${s.sector_no}. ${s.name}` : `Sector ${selectedSector}`
                })()
              : undefined
          }
          onClearSector={() => setSelectedSector('all')}
        />
      )}

      {!showStats && (
        <button
          onClick={() => setShowStats(true)}
          aria-label="Show stats panel"
          className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-xl border border-slate-900/8 bg-white/92 px-3 py-2 text-[12.5px] font-medium text-slate-700 shadow-[0_8px_30px_rgba(15,23,42,0.14)] backdrop-blur-md transition-colors hover:bg-white cursor-pointer"
        >
          <ChartBarIcon className="h-4 w-4" />
          Stats
        </button>
      )}
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
