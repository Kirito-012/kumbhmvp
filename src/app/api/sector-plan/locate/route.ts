import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

// Individual matched features are capped server-side -- the Stats panel's
// locator list only ever shows a handful before "Show N more" anyway, and a
// sparse-but-large sub-class (e.g. "Other") has no reason to ship hundreds
// of rows down the wire just to display four of them.
const MAX_FEATURES = 50

// Bounding box + per-feature centroids for a class/sub-class selection --
// backs both the Stats panel's fly-to-feature locator list and the map's
// auto zoom-to-fit, since neither can rely on vector-tile state (tiles for
// features outside the current viewport/zoom may never have loaded, so
// map.querySourceFeatures() can't be trusted to see them). Same
// ST_XMin/YMin/XMax/YMax(geom) shape as /api/sectors -- geom is stored
// native EPSG:4326, so these are plain lng/lat, ready for maplibre's
// fitBounds with no transform.
export async function GET(req: NextRequest) {
  const classGroup = req.nextUrl.searchParams.get('class_group')
  const subclass = req.nextUrl.searchParams.get('subclass')
  const sectorParam = req.nextUrl.searchParams.get('sector')
  const sectorNo =
    sectorParam !== null && Number.isInteger(Number(sectorParam)) ? Number(sectorParam) : null

  if (!classGroup) {
    return Response.json({ error: 'class_group is required' }, { status: 400 })
  }

  const pool = getPool()
  const conditions = ['class_group = $1']
  const params: (string | number)[] = [classGroup]
  if (subclass !== null) {
    conditions.push(`subclass = $${params.length + 1}`)
    params.push(subclass)
  }
  if (sectorNo !== null) {
    conditions.push(`sector_no = $${params.length + 1}`)
    params.push(sectorNo)
  }
  const where = conditions.join(' AND ')

  const [extent, features] = await Promise.all([
    pool.query(
      `
      SELECT count(*) AS total,
             ST_XMin(ST_Extent(geom)) AS xmin, ST_YMin(ST_Extent(geom)) AS ymin,
             ST_XMax(ST_Extent(geom)) AS xmax, ST_YMax(ST_Extent(geom)) AS ymax
      FROM kumbh.sector_plan
      WHERE ${where};
      `,
      params,
    ),
    pool.query(
      `
      SELECT id, sector_no, plot_no, block, label,
             ST_X(ST_Centroid(geom)) AS lng, ST_Y(ST_Centroid(geom)) AS lat
      FROM kumbh.sector_plan
      WHERE ${where}
      ORDER BY sector_no, plot_no
      LIMIT ${MAX_FEATURES};
      `,
      params,
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
