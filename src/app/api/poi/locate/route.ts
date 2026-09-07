import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

// Individual matched features are capped server-side, same rationale as
// /api/sector-plan/locate -- the Stats panel's locator list only ever shows
// a handful before "Show N more" anyway.
const MAX_FEATURES = 50

// Whitelist of POI layer -> (table, a human-readable label column if one
// exists). Mirrors the LAYERS whitelist in the tiles route (never
// interpolate the layer param straight into SQL) but only needs a name-ish
// column here, not the full column list tiles serves.
const LAYERS: Record<string, { table: string; nameColumn: string | null }> = {
  amenities: { table: 'kumbh.amenities', nameColumn: null },
  ashram: { table: 'kumbh.ashram', nameColumn: 'name' },
  bridge: { table: 'kumbh.bridge', nameColumn: null },
  bus_stop: { table: 'kumbh.bus_stop', nameColumn: 'name' },
  bus_terminal: { table: 'kumbh.bus_terminal', nameColumn: 'name' },
  core_parking: { table: 'kumbh.core_parking', nameColumn: 'name' },
  dustbins: { table: 'kumbh.dustbins', nameColumn: null },
  fh_location: { table: 'kumbh.fh_location', nameColumn: 'fh_name' },
  ghat_area: { table: 'kumbh.ghat_area', nameColumn: 'name' },
  kumbh_mela_2027_ghat: { table: 'kumbh.kumbh_mela_2027_ghat', nameColumn: 'name' },
  kumbh_land: { table: 'kumbh.kumbh_land', nameColumn: 'name' },
  public_service_facilities: { table: 'kumbh.public_service_facilities', nameColumn: 'name' },
  river: { table: 'kumbh.river', nameColumn: 'name' },
  sanitation: { table: 'kumbh.sanitation', nameColumn: 'name' },
  transformer: { table: 'kumbh.transformer', nameColumn: 'name' },
  trench_line: { table: 'kumbh.trench_line', nameColumn: 'name' },
  // 2027 gdb refresh additions -- table/column names mirror the tiles route's
  // LAYERS whitelist (src/app/api/tiles/[layer]/[z]/[x]/[y]/route.ts). These
  // were previously missing here entirely, so clicking one of these rows in
  // the Stats panel toggled its visibility but the locate fetch 400'd
  // ("Unknown or missing layer") and silently swallowed the error -- no
  // fly-to, no locator list, with nothing in the UI showing why.
  hotel: { table: 'kumbh.hotel', nameColumn: 'name' },
  railway_line: { table: 'kumbh.railway_line', nameColumn: 'name' },
  railway_station: { table: 'kumbh.railway_station', nameColumn: 'descriptio' },
  railway_station_area: { table: 'kumbh.railway_station_area', nameColumn: 'name' },
  traffic_route: { table: 'kumbh.traffic_route', nameColumn: 'name' },
  tentcity: { table: 'kumbh.tentcity', nameColumn: 'label' },
  ht_line: { table: 'kumbh.ht_line', nameColumn: 'name' },
  ht_line_buffer: { table: 'kumbh.ht_line_buffer', nameColumn: 'name' },
  water_line: { table: 'kumbh.water_line', nameColumn: null },
  water_point: { table: 'kumbh.water_point', nameColumn: null },
  landuse: { table: 'kumbh.landuse', nameColumn: 'name' },
  dam: { table: 'kumbh.dam', nameColumn: 'name' },
  uk_district_boundary: { table: 'kumbh.uk_district_boundary', nameColumn: 'dtname' },
  religious_place: { table: 'kumbh.religious_place', nameColumn: 'descriptio' },
  landmark: { table: 'kumbh.landmark', nameColumn: 'name' },
  thematic_gate: { table: 'kumbh.thematic_gate', nameColumn: null },
  entry_exit_line: { table: 'kumbh.entry_exit_line', nameColumn: null },
  junction: { table: 'kumbh.junction', nameColumn: 'name' },
  direction_line: { table: 'kumbh.direction_line', nameColumn: null },
  footpath: { table: 'kumbh.footpath', nameColumn: 'name' },
  ropeway: { table: 'kumbh.ropeway', nameColumn: 'name' },
  parking: { table: 'kumbh.parking', nameColumn: 'name_of_parking' },
  parking_line: { table: 'kumbh.parking_line', nameColumn: 'sector_name' },
  peripheral_parking: { table: 'kumbh.peripheral_parking', nameColumn: 'name' },
  sector_point: { table: 'kumbh.sector_point', nameColumn: 'label' },
  ropeway_area: { table: 'kumbh.ropeway_area', nameColumn: 'name' },
  other_transport: { table: 'kumbh.other_transport', nameColumn: 'name' },
  // These 5 exist as DB tables (see POI_TABLES in /api/stats) but aren't in
  // the tiles route's whitelist, so they never actually draw on the map --
  // toggling their Stats panel row just flips inert visibility state. Out of
  // scope to fix that gap here, but the locate endpoint should still work
  // for them (no name column assumed, same as other nameless point tables
  // above) so fly-to/zoom-to-fit isn't silently broken for these rows too.
  entry_exit: { table: 'kumbh.entry_exit', nameColumn: null },
  bridge_point: { table: 'kumbh.bridge_point', nameColumn: null },
  bus_terminal_point: { table: 'kumbh.bus_terminal_point', nameColumn: null },
  location_entry: { table: 'kumbh.location_entry', nameColumn: null },
  other_transport_point: { table: 'kumbh.other_transport_point', nameColumn: null },
}

// Bounding box + per-feature centroids for one POI layer -- same purpose as
// /api/sector-plan/locate (auto zoom-to-fit + the Stats panel's fly-to
// locator list) but for the POI tables, which live outside kumbh.sector_plan
// and don't share its class_group/subclass columns.
export async function GET(req: NextRequest) {
  const layer = req.nextUrl.searchParams.get('layer')
  const def = layer ? LAYERS[layer] : undefined
  if (!def) {
    return Response.json({ error: 'Unknown or missing layer' }, { status: 400 })
  }

  const pool = getPool()
  const labelSelect = def.nameColumn ? `${def.nameColumn} AS label` : 'NULL AS label'

  const [extent, features] = await Promise.all([
    pool.query(`
      SELECT count(*) AS total,
             ST_XMin(ST_Extent(geom)) AS xmin, ST_YMin(ST_Extent(geom)) AS ymin,
             ST_XMax(ST_Extent(geom)) AS xmax, ST_YMax(ST_Extent(geom)) AS ymax
      FROM ${def.table};
    `),
    pool.query(`
      SELECT id, ${labelSelect},
             ST_X(ST_Centroid(geom)) AS lng, ST_Y(ST_Centroid(geom)) AS lat
      FROM ${def.table}
      ORDER BY id
      LIMIT ${MAX_FEATURES};
    `),
  ])

  const row = extent.rows[0]
  const total = Number(row?.total ?? 0)
  const bbox =
    total > 0 && row.xmin !== null
      ? [Number(row.xmin), Number(row.ymin), Number(row.xmax), Number(row.ymax)]
      : null

  return Response.json({
    total,
    bbox,
    features: features.rows,
  })
}
