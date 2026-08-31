import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

export async function GET() {
  const pool = getPool()
  const { rows } = await pool.query(`
    SELECT sector_no, name, round(area_hac::numeric, 1) AS area_hac,
           ST_X(ST_Centroid(geom)) AS lng, ST_Y(ST_Centroid(geom)) AS lat,
           ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin,
           ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax
    FROM kumbh.sector_boundary
    ORDER BY sector_no;
  `)
  return Response.json(rows)
}
