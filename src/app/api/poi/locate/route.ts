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
