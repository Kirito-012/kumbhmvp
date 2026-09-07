import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

// Whitelist of layer -> (table, MVT layer name, columns). Never interpolate
// the layer param straight into SQL.
const LAYERS: Record<string, { table: string; columns: string }> = {
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

  const sql = `
    SELECT ST_AsMVT(t, $1, 4096, 'geom') AS mvt FROM (
      SELECT ${def.columns},
             ST_AsMVTGeom(
               ST_Transform(geom, 3857),
               ST_TileEnvelope($2, $3, $4),
               4096, 64, true
             ) AS geom
      FROM ${def.table}
      WHERE geom && ST_Transform(ST_TileEnvelope($2, $3, $4, margin => (64.0 / 4096)), 4326)
    ) t;
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
