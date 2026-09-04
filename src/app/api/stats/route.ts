import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

// POI layers loaded from the Aug 2026 JSON drop (scripts/load_kumbh_json_layers.py).
// Most don't carry a reliable numeric sector_no, so per-sector counts are
// computed spatially (ST_Intersects against sector_boundary) rather than by
// joining on an attribute column.
const POI_TABLES = [
  'amenities',
  'ashram',
  'bridge',
  'bus_stop',
  'bus_terminal',
  'core_parking',
  'dustbins',
  'fh_location',
  'ghat_area',
  'kumbh_mela_2027_ghat',
  'kumbh_land',
  'public_service_facilities',
  'river',
  'sanitation',
  'transformer',
  'trench_line',
] as const

// Subset of POI_TABLES whose geometry is a polygon (matches
// POLYGON_LAYER_COLORS in src/lib/classColors.ts) -- only these get an
// ST_Area computation in poiByLayer below. Point tables have no meaningful
// area, and ST_Area on a point/linestring geometry errors, so the hectares
// column is left null for every other table rather than attempted.
const POI_POLYGON_TABLES = new Set([
  'ashram',
  'bus_terminal',
  'core_parking',
  'ghat_area',
  'kumbh_land',
  'public_service_facilities',
  'river',
])

export async function GET(req: NextRequest) {
  const sectorParam = req.nextUrl.searchParams.get('sector')
  const sectorNo =
    sectorParam !== null && Number.isInteger(Number(sectorParam)) ? Number(sectorParam) : null

  const pool = getPool()

  const poiByLayerSql = POI_TABLES.map((t) => {
    const hectaresExpr = POI_POLYGON_TABLES.has(t)
      ? `round((sum(ST_Area(geom::geography)) / 10000)::numeric, 1)`
      : `null`
    return `SELECT '${t}' AS layer, count(*) AS features, ${hectaresExpr} AS hectares FROM kumbh.${t}
      WHERE $1::int IS NULL OR EXISTS (
        SELECT 1 FROM kumbh.sector_boundary b
        WHERE b.sector_no = $1 AND ST_Intersects(b.geom, kumbh.${t}.geom)
      )`
  }).join('\n      UNION ALL\n      ')

  const [byClass, bySubclass, roadByType, perSector, poiByLayer] = await Promise.all([
    // Cross-joins every class_group that exists anywhere against the current
    // sector filter (rather than a plain GROUP BY on the filtered rows) so a
    // class with zero features in this sector still comes back as a 0 row
    // instead of silently disappearing -- same "always show every known
    // value" contract as poiByLayer below, extended here to sector scoping.
    pool.query(
      `
      SELECT g.class_group,
             coalesce(s.features, 0) AS features,
             coalesce(s.hectares, 0) AS hectares
      FROM (SELECT DISTINCT class_group FROM kumbh.sector_plan) g
      LEFT JOIN (
        SELECT class_group, count(*) AS features,
               round((sum(ST_Area(geom::geography)) / 10000)::numeric, 1) AS hectares
        FROM kumbh.sector_plan
        WHERE $1::int IS NULL OR sector_no = $1
        GROUP BY class_group
      ) s ON s.class_group = g.class_group
      ORDER BY g.class_group;
      `,
      [sectorNo],
    ),
    pool.query(
      `
      SELECT g.class_group, g.subclass,
             coalesce(s.features, 0) AS features,
             coalesce(s.hectares, 0) AS hectares
      FROM (SELECT DISTINCT class_group, subclass FROM kumbh.sector_plan) g
      LEFT JOIN (
        SELECT class_group, subclass, count(*) AS features,
               round((sum(ST_Area(geom::geography)) / 10000)::numeric, 1) AS hectares
        FROM kumbh.sector_plan
        WHERE $1::int IS NULL OR sector_no = $1
        GROUP BY class_group, subclass
      ) s ON s.class_group = g.class_group AND s.subclass = g.subclass
      ORDER BY g.class_group, coalesce(s.features, 0) DESC;
      `,
      [sectorNo],
    ),
    pool.query(
      `
      SELECT g.type,
             coalesce(s.segments, 0) AS segments,
             coalesce(s.metres, 0) AS metres
      FROM (SELECT DISTINCT type FROM kumbh.road) g
      LEFT JOIN (
        SELECT type, count(*) AS segments,
               round((sum(ST_Length(geom::geography)))::numeric, 0) AS metres
        FROM kumbh.road
        WHERE $1::int IS NULL OR sector_no = $1
        GROUP BY type
      ) s ON s.type = g.type
      ORDER BY coalesce(s.metres, 0) DESC;
      `,
      [sectorNo],
    ),
    pool.query(
      `
      SELECT b.sector_no, b.name,
             round(b.area_hac::numeric, 1) AS boundary_hectares,
             count(p.id) AS plan_features,
             round((coalesce(sum(ST_Area(p.geom::geography)), 0) / 10000)::numeric, 1) AS plan_hectares
      FROM kumbh.sector_boundary b
      LEFT JOIN kumbh.sector_plan p ON p.sector_no = b.sector_no
      WHERE $1::int IS NULL OR b.sector_no = $1
      GROUP BY b.sector_no, b.name, b.area_hac
      ORDER BY b.sector_no;
      `,
      [sectorNo],
    ),
    pool.query(
      `
      ${poiByLayerSql}
      ORDER BY features DESC;
      `,
      [sectorNo],
    ),
  ])

  return Response.json({
    byClass: byClass.rows,
    bySubclass: bySubclass.rows,
    roadByType: roadByType.rows,
    perSector: perSector.rows,
    poiByLayer: poiByLayer.rows,
  })
}
