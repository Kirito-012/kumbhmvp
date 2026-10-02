import 'server-only'

import { getPool } from '@/server/db/postgres'

/**
 * Pre-projected sector outlines for the dashboard's small reference map.
 *
 * The dashboard draws this as plain SVG rather than a MapLibre instance: there are only 32 sector
 * polygons (~3.7k points raw, ~1k simplified), nothing to pan or zoom, and a GL map would drag the
 * whole map bundle onto a page that otherwise ships none of it (the ticket-detail thumbnail was
 * moved off MapLibre for the same reason — see CONTEXT.md §16). Projecting on the server means the
 * client receives ready-to-render `d` strings and never touches GeoJSON or a projection library.
 */

export type SectorShape = {
  sectorNo: number
  name: string | null
  zone: string | null
  /** SVG path data, in the map's viewBox coordinates. */
  d: string
  /** A point guaranteed to lie *inside* the sector (ST_PointOnSurface, not the centroid — a
   *  crescent-shaped sector's centroid can fall outside it), in viewBox coordinates. */
  cx: number
  cy: number
  /** Projected bounding-box size in viewBox units — lets the client decide whether a sector is big
   *  enough to label directly or needs a point marker to stay visible and clickable. */
  w: number
  h: number
}

export type SectorMapData = {
  width: number
  height: number
  /** River outline as one SVG path, drawn under the sectors purely for orientation. */
  river: string
  sectors: SectorShape[]
}

const VIEW_WIDTH = 600
const PAD = 10
/** Simplification tolerances in degrees (~0.0003° ≈ 33 m). At the map's ~65 m per viewBox unit
 *  both are sub-pixel, so the outlines look unchanged and the payload shrinks ~4x. */
const SECTOR_SIMPLIFY_DEG = 0.0003
const RIVER_SIMPLIFY_DEG = 0.001
/** River fragments smaller than this (deg², ~2,400 m²) are dropped — specks, not orientation. */
const RIVER_MIN_AREA_DEG2 = 0.0000002
/** How far past the sector extent to still fetch river, so the channel runs off the map edge
 *  instead of stopping short of it. */
const RIVER_MARGIN_DEG = 0.004

type Ring = number[][]
type PolygonalGeometry =
  { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }

type SectorRow = {
  sector_no: number
  name: string | null
  zone: string | null
  geom: PolygonalGeometry
  lng: number
  lat: number
}

function ringsOf(g: PolygonalGeometry): Ring[] {
  return g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
}

async function load(): Promise<SectorMapData> {
  const pool = getPool()
  const [sectorRes, riverRes] = await Promise.all([
    pool.query<SectorRow>(
      `SELECT sector_no, name, zone,
              ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $1), 6)::json AS geom,
              ST_X(ST_PointOnSurface(geom)) AS lng, ST_Y(ST_PointOnSurface(geom)) AS lat
         FROM kumbh.sector_boundary
        ORDER BY sector_no`,
      [SECTOR_SIMPLIFY_DEG],
    ),
    pool.query<{ geom: PolygonalGeometry }>(
      `WITH env AS (SELECT ST_Expand(ST_Extent(geom), $3::float8) AS e FROM kumbh.sector_boundary)
       SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(r.geom, $1), 5)::json AS geom
         FROM kumbh.river r, env
        WHERE r.geom && env.e AND ST_Area(r.geom) > $2`,
      [RIVER_SIMPLIFY_DEG, RIVER_MIN_AREA_DEG2, RIVER_MARGIN_DEG],
    ),
  ])

  // Frame the map on the sectors themselves (not the river, which runs far past them).
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const row of sectorRes.rows) {
    for (const ring of ringsOf(row.geom)) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  if (!Number.isFinite(minLng)) throw new Error('kumbh.sector_boundary returned no geometry')

  // Equirectangular with longitude shrunk by cos(mid-latitude): keeps shapes undistorted at this
  // latitude (~30°N) without a projection library, and the region is only ~35 km across.
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const scale = (VIEW_WIDTH - 2 * PAD) / ((maxLng - minLng) * kx)
  const px = (lng: number) => PAD + (lng - minLng) * kx * scale
  const py = (lat: number) => PAD + (maxLat - lat) * scale
  const height = Math.ceil(2 * PAD + (maxLat - minLat) * scale)

  const fmt = (n: number) => n.toFixed(1)

  /** Rings -> one path string, plus the projected bbox. Consecutive points that round to the same
   *  1-decimal coordinate are dropped, which is most of what simplification left behind. */
  const toPath = (rings: Ring[]) => {
    let d = ''
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const ring of rings) {
      let prev = ''
      let started = false
      for (const [lng, lat] of ring) {
        const x = px(lng)
        const y = py(lat)
        const key = `${fmt(x)} ${fmt(y)}`
        if (key === prev) continue
        prev = key
        d += started ? `L${key}` : `M${key}`
        started = true
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      if (started) d += 'Z'
    }
    return { d, w: x1 - x0, h: y1 - y0 }
  }

  const sectors: SectorShape[] = sectorRes.rows.map((row) => {
    const { d, w, h } = toPath(ringsOf(row.geom))
    return {
      sectorNo: row.sector_no,
      name: row.name,
      zone: row.zone,
      d,
      cx: Number(fmt(px(row.lng))),
      cy: Number(fmt(py(row.lat))),
      w: Math.round(w),
      h: Math.round(h),
    }
  })

  const river = riverRes.rows.map((row) => toPath(ringsOf(row.geom)).d).join('')

  return { width: VIEW_WIDTH, height, river, sectors }
}

// Sector boundaries are static reference data (see CONTEXT.md §3), so one load per server process
// is enough. The promise is cached rather than the value so concurrent first requests share a
// single query — and cleared on failure so a transient pooler hiccup can't poison every later
// render for the life of the process.
let cached: Promise<SectorMapData> | null = null

/** `null` when Postgres is unreachable: the dashboard then simply omits the map and keeps the
 *  ranked lists, the same degrade-don't-fail contract `getSectorNames()` has. */
export async function getSectorMapData(): Promise<SectorMapData | null> {
  if (!cached) {
    cached = load().catch((err) => {
      cached = null
      throw err
    })
  }
  try {
    return await cached
  } catch {
    return null
  }
}
