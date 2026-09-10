import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

// Whitelist of layer -> (table, MVT layer name, columns). Never interpolate
// the layer param straight into SQL.
//
// minzoom/lowZoomWhere/filterBelowZoom/simplify are optional and exist for
// kumbh.tertiary_road alone (21k+ nameless OSM street centrelines -- see
// PLAN-deferred-roads.md): every other layer here is small enough that a raw
// ST_AsMVTGeom over the tile's bbox is already fast and small. lowZoomWhere is
// always a literal authored in this file, never request input, so splicing it
// into the SQL string doesn't reopen the "never interpolate the layer param"
// rule below.
const LAYERS: Record<
  string,
  {
    table: string
    columns: string
    /** Below this zoom the layer returns an empty tile outright. */
    minzoom?: number
    /** SQL predicate applied only below filterBelowZoom. */
    lowZoomWhere?: string
    /** Zoom threshold below which lowZoomWhere is applied. */
    filterBelowZoom?: number
    /** Simplify geometry (in tile units, post-clip) to shrink dense layers. */
    simplify?: boolean
  }
> = {
  road: {
    table: 'kumbh.road',
    columns: 'id, road_name, type, road_class, row_width_m, sector_no, kumbh_land',
  },
  sector_boundary: {
    table: 'kumbh.sector_boundary',
    columns: 'id, name, sector_no, area_hac',
  },
  sector_plan: {
    table: 'kumbh.sector_plan',
    columns: 'id, class, class_group, subclass, plot_no, block, sector_no, label, area',
  },
  amenities: {
    table: 'kumbh.amenities',
    columns: 'id, class, subclass, sector, remark',
  },
  ashram: {
    table: 'kumbh.ashram',
    columns: 'id, name, sub_class, land_use, plu_2025, rd_rly_nam',
  },
  bridge: {
    table: 'kumbh.bridge',
    columns: 'id, remark, type, mode, is_temporary',
  },
  bus_stop: {
    table: 'kumbh.bus_stop',
    columns: 'id, name, remark',
  },
  bus_terminal: {
    table: 'kumbh.bus_terminal',
    columns: 'id, name',
  },
  core_parking: {
    table: 'kumbh.core_parking',
    columns: 'id, name, kumbh_land, sector, purpose, type, area',
  },
  dustbins: {
    table: 'kumbh.dustbins',
    columns: 'id, type, sector',
  },
  fh_location: {
    table: 'kumbh.fh_location',
    columns: 'id, fh_name, type',
  },
  ghat_area: {
    table: 'kumbh.ghat_area',
    columns: 'id, name',
  },
  kumbh_mela_2027_ghat: {
    table: 'kumbh.kumbh_mela_2027_ghat',
    columns: 'id, name, remark, number',
  },
  kumbh_land: {
    table: 'kumbh.kumbh_land',
    columns: 'id, name, kumbh_land, sector, purpose, type, area',
  },
  public_service_facilities: {
    table: 'kumbh.public_service_facilities',
    columns: 'id, name, type, subclass, services, category, bed',
  },
  river: {
    table: 'kumbh.river',
    columns: 'id, name, type',
  },
  sanitation: {
    table: 'kumbh.sanitation',
    columns: 'id, name, class, subclass, sector, remark',
  },
  transformer: {
    table: 'kumbh.transformer',
    columns: 'id, name, sector, remark',
  },
  trench_line: {
    table: 'kumbh.trench_line',
    columns: 'id, name, remark',
  },
  hotel: {
    table: 'kumbh.hotel',
    columns: 'id, name, category',
  },
  railway_line: {
    table: 'kumbh.railway_line',
    columns: 'id, name, type',
  },
  railway_station: {
    table: 'kumbh.railway_station',
    columns: 'id, descriptio, sector_name, remark, type',
  },
  railway_station_area: {
    table: 'kumbh.railway_station_area',
    columns: 'id, name',
  },
  traffic_route: {
    table: 'kumbh.traffic_route',
    columns:
      'id, name, entry_exit, plan, direction, weekend, normal, peak_day, deh_dir, naj_dir, sah_dir, meer_dir',
  },
  tentcity: {
    table: 'kumbh.tentcity',
    columns: 'id, class, subclass, plot_no, block, sector, remark, label',
  },
  ht_line: {
    table: 'kumbh.ht_line',
    columns: 'id, name, buffer_m',
  },
  ht_line_buffer: {
    table: 'kumbh.ht_line_buffer',
    columns: 'id, name, buffer_m',
  },
  water_line: {
    table: 'kumbh.water_line',
    columns: 'id, sector, water_line_type, remark',
  },
  water_point: {
    table: 'kumbh.water_point',
    columns: 'id, type, dia, remarks, sector',
  },
  landuse: {
    table: 'kumbh.landuse',
    columns: 'id, name, type, class',
  },
  dam: {
    table: 'kumbh.dam',
    columns: 'id, name',
  },
  uk_district_boundary: {
    table: 'kumbh.uk_district_boundary',
    columns: 'id, dtname, stname',
  },
  religious_place: {
    table: 'kumbh.religious_place',
    columns: 'id, descriptio, sector_name, remark, type',
  },
  landmark: {
    table: 'kumbh.landmark',
    columns: 'id, name, type',
  },
  thematic_gate: {
    table: 'kumbh.thematic_gate',
    columns: 'id, remark',
  },
  entry_exit_line: {
    table: 'kumbh.entry_exit_line',
    columns: 'id, remark, sector',
  },
  junction: {
    table: 'kumbh.junction',
    columns: 'id, name, remark',
  },
  direction_line: {
    table: 'kumbh.direction_line',
    columns: 'id, remark, sector',
  },
  footpath: {
    table: 'kumbh.footpath',
    columns: 'id, name, remark',
  },
  ropeway: {
    table: 'kumbh.ropeway',
    columns: 'id, name',
  },
  parking: {
    table: 'kumbh.parking',
    columns: 'id, name_of_parking, sector, ecs, subclass',
  },
  parking_line: {
    table: 'kumbh.parking_line',
    columns: 'id, sector_name',
  },
  peripheral_parking: {
    table: 'kumbh.peripheral_parking',
    columns: 'id, name, land_name',
  },
  sector_point: {
    table: 'kumbh.sector_point',
    columns: 'id, class, plot_no, block, sector, subclass, remark, label, remark_1, area',
  },
  ropeway_area: {
    table: 'kumbh.ropeway_area',
    columns: 'id, name',
  },
  other_transport: {
    table: 'kumbh.other_transport',
    columns: 'id, name',
  },
  tertiary_road: {
    table: 'kumbh.tertiary_road',
    columns: 'id, osm_id, name, fclass, ref, oneway, maxspeed, bridge, tunnel, in_sector',
    // 21k nameless OSM centrelines: a whole-region tile of ALL of them at low
    // zoom would be megabytes and illegible. But the ~1,192 arterial-class
    // rows (trunk/primary/secondary/tertiary) region-wide are cheap at any
    // zoom, so unlike the original all-or-nothing z12 cutoff, this now shows
    // arterials from whole-region view (matching how Google Maps itself
    // reveals road classes progressively) and only gates the dense
    // residential/service/track/path clutter to closer zooms.
    minzoom: 6,
    filterBelowZoom: 13,
    lowZoomWhere:
      "fclass IN ('trunk','primary','secondary','tertiary'," +
      "'trunk_link','primary_link','secondary_link','tertiary_link')",
    simplify: true,
  },
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ layer: string; z: string; x: string; y: string }> },
) {
  const { layer, z, x, y } = await params
  const def = LAYERS[layer]
  if (!def) {
    return new Response(`Unknown layer: ${layer}`, { status: 404 })
  }

  const zi = Number(z)
  const xi = Number(x)
  const yi = Number(y)
  if (![zi, xi, yi].every(Number.isInteger)) {
    return new Response('Invalid tile coordinates', { status: 400 })
  }

  // Bulk reference layers (tertiary_road) don't even hit the pool below their
  // minzoom -- an empty MVT response is what MapLibre expects for "no data at
  // this zoom", same as a real query that happened to match nothing.
  if (def.minzoom !== undefined && zi < def.minzoom) {
    return new Response(new Uint8Array(), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
      },
    })
  }

  const extraWhere =
    def.filterBelowZoom !== undefined && def.lowZoomWhere && zi < def.filterBelowZoom
      ? `AND (${def.lowZoomWhere})`
      : ''

  // ST_AsMVTGeom already clips to the tile; simplifying afterwards (in tile-unit
  // space) is what actually shrinks the payload for dense line layers like
  // tertiary_road. ST_Simplify can drop very short segments to empty/NULL, hence
  // the `geom IS NOT NULL` guard in the outer query below.
  const geomExpr = def.simplify
    ? `ST_Simplify(ST_AsMVTGeom(ST_Transform(geom, 3857), ST_TileEnvelope($2, $3, $4), 4096, 64, true), 2.0)`
    : `ST_AsMVTGeom(ST_Transform(geom, 3857), ST_TileEnvelope($2, $3, $4), 4096, 64, true)`

  const sql = `
    SELECT ST_AsMVT(t, $1, 4096, 'geom') AS mvt FROM (
      SELECT ${def.columns},
             ${geomExpr} AS geom
      FROM ${def.table}
      WHERE geom && ST_Transform(ST_TileEnvelope($2, $3, $4, margin => (64.0 / 4096)), 4326)
      ${extraWhere}
    ) t
    WHERE t.geom IS NOT NULL;
  `

  const pool = getPool()
  const { rows } = await pool.query(sql, [layer, zi, xi, yi])
  const mvt: Buffer | null = rows[0]?.mvt ?? null

  return new Response(new Uint8Array(mvt ?? Buffer.alloc(0)), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
    },
  })
}
