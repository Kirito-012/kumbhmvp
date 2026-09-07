import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

// The 7 point-geometry POI layers (mirrors POINT_LAYER_COLORS in
// src/lib/classColors.ts) -- the only ones MapView clusters client-side, so
// this endpoint only needs to serve those, not every POI table the tiles
// route knows about. Columns match what /api/tiles/[layer]/... serves for
// the same table, so a clustered point's popup shows the same property rows
// as before the switch from vector tiles to GeoJSON. Never interpolate the
// layer param straight into SQL.
const LAYERS: Record<string, { table: string; columns: string; subclassColumn?: string }> = {
  amenities: {
    table: 'kumbh.amenities',
    columns: 'id, class, subclass, sector, remark',
    subclassColumn: 'subclass',
  },
  bus_stop: { table: 'kumbh.bus_stop', columns: 'id, name, remark' },
  dustbins: { table: 'kumbh.dustbins', columns: 'id, type, sector' },
  fh_location: { table: 'kumbh.fh_location', columns: 'id, fh_name, type' },
  kumbh_mela_2027_ghat: {
    table: 'kumbh.kumbh_mela_2027_ghat',
    columns: 'id, name, remark, number',
  },
  sanitation: {
    table: 'kumbh.sanitation',
    columns: 'id, name, class, subclass, sector, remark',
    subclassColumn: 'subclass',
  },
  transformer: { table: 'kumbh.transformer', columns: 'id, name, sector, remark' },
  // Added with the 2027 gdb refresh -- every point-geometry entry in
  // POINT_LAYER_COLORS (src/lib/classColors.ts) MUST have an entry here:
  // MapView routes ALL point-geomType POI_LAYER_DEFS through this endpoint's
  // geojson+client-clustering path, never through /api/tiles (that path is
  // reserved for line/polygon POI layers) -- see the geomType === 'point'
  // branch in initMap. All of these are well under the ~1,400-row volume
  // note above.
  hotel: { table: 'kumbh.hotel', columns: 'id, name, category' },
  railway_station: {
    table: 'kumbh.railway_station',
    columns: 'id, descriptio, sector_name, remark, type',
  },
  religious_place: {
    table: 'kumbh.religious_place',
    columns: 'id, descriptio, sector_name, remark, type',
  },
  landmark: { table: 'kumbh.landmark', columns: 'id, name, type' },
  thematic_gate: { table: 'kumbh.thematic_gate', columns: 'id, remark' },
  entry_exit: { table: 'kumbh.entry_exit', columns: 'id, remark, sector' },
  junction: { table: 'kumbh.junction', columns: 'id, name, remark' },
  ropeway: { table: 'kumbh.ropeway', columns: 'id, name' },
  parking: {
    table: 'kumbh.parking',
    columns: 'id, name_of_parking, sector, ecs, subclass',
    subclassColumn: 'subclass',
  },
  peripheral_parking: {
    table: 'kumbh.peripheral_parking',
    columns: 'id, name, land_name',
  },
  water_point: { table: 'kumbh.water_point', columns: 'id, type, dia, remarks, sector' },
  sector_point: {
    table: 'kumbh.sector_point',
    columns: 'id, class, plot_no, block, sector, subclass, remark, label, remark_1, area',
    subclassColumn: 'subclass',
  },
  bridge_point: { table: 'kumbh.bridge_point', columns: 'id, name' },
  bus_terminal_point: { table: 'kumbh.bus_terminal_point', columns: 'id, name' },
  location_entry: { table: 'kumbh.location_entry', columns: 'id, name' },
  other_transport_point: { table: 'kumbh.other_transport_point', columns: 'id, name' },
}

// Full GeoJSON FeatureCollection for one point POI layer, used as a MapLibre
// 'geojson' source with cluster: true -- MapLibre's built-in clustering only
// works on geojson sources, not the vector-tile sources every other layer
// here uses, and switching to a single full-dataset fetch is only safe
// because these 7 tables are small (under ~1,400 rows each as of Sept 2026
// -- re-check row counts before adding a new point layer here).
//
// Optional repeated ?subclass= params (only meaningful for amenities/
// sanitation, the 2 layers with a sub-class column -- see
// POI_SUBCLASS_COLUMNS in MapView.tsx) narrow the result to just those
// sub-classes. This exists so MapView can re-fetch a clustered layer's
// source data already filtered server-side and swap it in via setData(),
// rather than filtering client-side with a style `filter` -- MapLibre
// clusters a geojson source's full raw data before any style filter runs,
// so a style-level filter alone can't make a cluster's point_count exclude
// filtered-out points, but a narrower dataset naturally does.
export async function GET(req: NextRequest, { params }: { params: Promise<{ layer: string }> }) {
  const { layer } = await params
  const def = LAYERS[layer]
  if (!def) {
    return Response.json({ error: `Unknown point layer: ${layer}` }, { status: 404 })
  }

  const subclasses = req.nextUrl.searchParams.getAll('subclass')
  const subclassClause =
    subclasses.length > 0 && def.subclassColumn ? `WHERE ${def.subclassColumn} = ANY($1)` : ''

  const pool = getPool()
  const sql = `
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
    ) AS fc
    FROM (
      SELECT jsonb_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(geom)::jsonb,
        'properties', to_jsonb(t) - 'geom'
      ) AS feature
      FROM (SELECT ${def.columns}, geom FROM ${def.table} ${subclassClause}) t
    ) f;
  `
  const { rows } = await pool.query(sql, subclassClause ? [subclasses] : [])
  const fc = rows[0]?.fc ?? { type: 'FeatureCollection', features: [] }

  return Response.json(fc, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
    },
  })
}
