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

export async function GET(req: NextRequest) {
  const sectorParam = req.nextUrl.searchParams.get('sector')
  const sectorNo =
    sectorParam !== null && Number.isInteger(Number(sectorParam)) ? Number(sectorParam) : null

  const pool = getPool()

  const poiByLayerSql = POI_TABLES.map(
    (t) => `SELECT '${t}' AS layer, count(*) AS features FROM kumbh.${t}
      WHERE $1::int IS NULL OR EXISTS (
        SELECT 1 FROM kumbh.sector_boundary b
        WHERE b.sector_no = $1 AND ST_Intersects(b.geom, kumbh.${t}.geom)
      )`,
  ).join('\n      UNION ALL\n      ')

  const [byClass, roadByType, perSector, poiByLayer] = await Promise.all([
    pool.query(
      `
      SELECT class_group, count(*) AS features,
             round((sum(ST_Area(geom::geography)) / 10000)::numeric, 1) AS hectares
      FROM kumbh.sector_plan
      WHERE $1::int IS NULL OR sector_no = $1
      GROUP BY class_group
      ORDER BY class_group;
      `,
      [sectorNo],
    ),
    pool.query(
      `
      SELECT type, count(*) AS segments,
             round((sum(ST_Length(geom::geography)))::numeric, 0) AS metres
      FROM kumbh.road
      WHERE $1::int IS NULL OR sector_no = $1
      GROUP BY type
      ORDER BY metres DESC;
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
    roadByType: roadByType.rows,
    perSector: perSector.rows,
    poiByLayer: poiByLayer.rows,
  })
}
