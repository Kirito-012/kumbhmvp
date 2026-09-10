import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

// Individual matched features are capped server-side, same rationale as
// /api/sector-plan/locate -- the Stats panel's locator list only ever shows
// a handful before it is expanded.
//
// 200 rather than 50: at 50 the cap silently swallowed whole sectors (the
// 114 Toilets span sectors 5-16, but the first 50 in sector order stop at
// sector 9, so half the sectors simply were not in the response and nothing
// in the UI said so). 200 covers every layer/sub-class combination actually
// present in the 2027 data, so the "showing N of M" hint the panel renders
// is the only truncation the user ever meets.
const MAX_FEATURES = 200

// Whitelist of POI layer -> (table, a human-readable label column if one
// exists). Mirrors the LAYERS whitelist in the tiles route (never
// interpolate the layer param straight into SQL) but only needs a name-ish
// column here, not the full column list tiles serves.
// Subset of LAYERS with a categorical "subclass" column, and its exact name
// per table (ashram spells it sub_class) -- mirrors POI_SUBCLASS_COLUMNS in
// MapView.tsx / POI_SUBCLASS_TABLES in /api/stats. Lets ?subclass= scope the
// bbox/feature query down to one sub-class instead of always covering the
// whole layer.
const SUBCLASS_COLUMNS: Record<string, string> = {
  amenities: 'subclass',
  ashram: 'sub_class',
  public_service_facilities: 'subclass',
  sanitation: 'subclass',
  tentcity: 'subclass',
  parking: 'subclass',
  sector_point: 'subclass',
}

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
  // Only 121 of 21k rows have a name -- safe to expose here since locate is
  // just a name-ish lookup, unlike /api/poi/points/[layer] which this table
  // deliberately stays out of (see PLAN-deferred-roads.md: too large for the
  // whole-layer-as-GeoJSON path, it stays on vector tiles only).
  tertiary_road: { table: 'kumbh.tertiary_road', nameColumn: 'name' },
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

  const subclass = req.nextUrl.searchParams.get('subclass')
  const subclassColumn = layer ? SUBCLASS_COLUMNS[layer] : undefined
  // A subclass param is only honoured for layers that actually have that
  // column -- otherwise silently falls back to the whole-layer query rather
  // than erroring, same tolerance /api/stats gives an unrecognised layer.
  const sectorParam = req.nextUrl.searchParams.get('sector')
  const sectorNo =
    sectorParam !== null && Number.isInteger(Number(sectorParam)) ? Number(sectorParam) : null

  // Built as a parameterised list so `sector` and `subclass` compose. Without
  // sector support here the Stats panel could not honour its own "(this
  // sector)" heading for POI rows: the counts were sector-scoped by
  // /api/stats but the locator list underneath them covered the whole mela,
  // so clicking a result flew the planner out of the sector they had
  // filtered to. The sector test is spatial (ST_Intersects against
  // sector_boundary) because POI tables have no sector_no column -- same
  // approach /api/stats uses to scope these very counts.
  const conditions: string[] = []
  const queryParams: (string | number)[] = []
  if (subclass && subclassColumn) {
    conditions.push(`p.${subclassColumn} = $${queryParams.length + 1}`)
    queryParams.push(subclass)
  }
  if (sectorNo !== null) {
    conditions.push(
      `EXISTS (SELECT 1 FROM kumbh.sector_boundary b
               WHERE b.sector_no = $${queryParams.length + 1}
                 AND ST_Intersects(b.geom, p.geom))`,
    )
    queryParams.push(sectorNo)
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const pool = getPool()
  // Qualified with the `p` alias since the feature query below joins
  // sector_boundary -- an unqualified column would be ambiguous if a POI
  // table ever grows a column the boundary table also has.
  const labelSelect = def.nameColumn ? `p.${def.nameColumn} AS label` : 'NULL AS label'

  // POI tables carry no sector_no of their own (only kumbh.sector_plan and
  // kumbh.road do -- verified against information_schema), so the sector a
  // feature sits in has to come from a spatial join, the same ST_Intersects
  // against sector_boundary that /api/stats already uses to scope POI counts.
  // Worth the ~300ms: POI labels are frequently non-unique to the point of
  // uselessness as identifiers (kumbh.sanitation has 114 Toilets sharing 7
  // capacity-spec strings; all 1022 ashram rows share a single name), so
  // without a sector the locator list is an undifferentiated wall of
  // identical entries and the user cannot tell one result from another.
  // LATERAL + LIMIT 1 rather than a plain LEFT JOIN so a feature straddling
  // two sector boundaries yields one row, not a duplicate per sector.

  const [extent, features] = await Promise.all([
    pool.query(
      `
      SELECT count(*) AS total,
             ST_XMin(ST_Extent(p.geom)) AS xmin, ST_YMin(ST_Extent(p.geom)) AS ymin,
             ST_XMax(ST_Extent(p.geom)) AS xmax, ST_YMax(ST_Extent(p.geom)) AS ymax
      FROM ${def.table} p
      ${whereClause};
    `,
      queryParams,
    ),
    pool.query(
      `
      SELECT p.id, ${labelSelect},
             s.sector_no,
             ST_X(ST_Centroid(p.geom)) AS lng, ST_Y(ST_Centroid(p.geom)) AS lat
      FROM ${def.table} p
      LEFT JOIN LATERAL (
        SELECT b.sector_no
        FROM kumbh.sector_boundary b
        WHERE ST_Intersects(b.geom, p.geom)
        LIMIT 1
      ) s ON TRUE
      ${whereClause}
      ORDER BY s.sector_no NULLS LAST, p.id
      LIMIT ${MAX_FEATURES};
    `,
      queryParams,
    ),
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
