import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

// Land Summary area stat classes shown in the Sector Report drawer -- these
// are the class_group buckets the source report calls out by name (Mela
// land = every class_group summed, the rest are one specific class_group
// each). Not every sector has every one of these; missing ones just report 0.
const LAND_SUMMARY_CLASSES = [
  'Parking',
  'Commercial',
  'Religious Camping',
  'Police Camping',
  'Administrative Camping',
  'Health Camping',
] as const

export async function GET(req: NextRequest) {
  const sectorParam = req.nextUrl.searchParams.get('sector')
  const sectorNo =
    sectorParam !== null && Number.isInteger(Number(sectorParam)) ? Number(sectorParam) : null
  if (sectorNo === null) {
    return Response.json({ error: 'A numeric ?sector= is required' }, { status: 400 })
  }

  const pool = getPool()

  const [boundary, byClass, meNoLand, road, dustbins, transformers, toilets, ghats, activities] =
    await Promise.all([
      pool.query(
        `SELECT sector_no, name, round(area_hac::numeric, 2) AS area_hac
         FROM kumbh.sector_boundary WHERE sector_no = $1`,
        [sectorNo],
      ),
      pool.query(
        `SELECT class_group, round((sum(area))::numeric, 2) AS hectares
         FROM kumbh.sector_plan WHERE sector_no = $1 AND class_group = ANY($2)
         GROUP BY class_group`,
        [sectorNo, LAND_SUMMARY_CLASSES],
      ),
      pool.query(
        `SELECT round((sum(area))::numeric, 2) AS hectares
         FROM kumbh.sector_plan WHERE sector_no = $1`,
        [sectorNo],
      ),
      pool.query(
        `SELECT round((sum(shape_leng_src) / 1000)::numeric, 2) AS km
         FROM kumbh.road WHERE sector_no = $1`,
        [sectorNo],
      ),
      // dustbins/transformer carry no sector_no column -- spatial join
      // against the boundary polygon, same pattern as stats/route.ts's
      // poiByLayer.
      pool.query(
        `SELECT count(*) AS count FROM kumbh.dustbins d
         JOIN kumbh.sector_boundary b ON ST_Intersects(b.geom, d.geom)
         WHERE b.sector_no = $1`,
        [sectorNo],
      ),
      pool.query(
        `SELECT count(*) AS count FROM kumbh.transformer t
         JOIN kumbh.sector_boundary b ON ST_Intersects(b.geom, t.geom)
         WHERE b.sector_no = $1`,
        [sectorNo],
      ),
      // "Toilets" in the source report is a seat count (Male + Female +
      // Urinal), not a count of toilet-block points -- each sanitation row's
      // name is free text like "Toilet - M-30, F-30, Urinal - 20", so every
      // number in the name is summed and every row's sum added together.
      pool.query(
        `SELECT s.name FROM kumbh.sanitation s
         JOIN kumbh.sector_boundary b ON ST_Intersects(b.geom, s.geom)
         WHERE b.sector_no = $1 AND s.subclass = 'Toilet'`,
        [sectorNo],
      ),
      pool.query(
        `SELECT count(*) AS count FROM kumbh.kumbh_mela_2027_ghat g
         JOIN kumbh.sector_boundary b ON ST_Intersects(b.geom, g.geom)
         WHERE b.sector_no = $1`,
        [sectorNo],
      ),
      // Key Activities: every sector_plan row for this sector, grouped by
      // class_group, each row's display name resolved to whichever field
      // actually carries a distinguishing label (remark is a free-text
      // description when present, remark_1 a plot/block code otherwise,
      // subclass as the last resort for a row with neither).
      pool.query(
        `SELECT class_group, subclass, remark, remark_1
         FROM kumbh.sector_plan WHERE sector_no = $1
         ORDER BY class_group, subclass`,
        [sectorNo],
      ),
    ])

  if (boundary.rows.length === 0) {
    return Response.json({ error: `Sector ${sectorNo} not found` }, { status: 404 })
  }

  const landSummary: Record<string, number> = {}
  for (const row of byClass.rows) {
    landSummary[row.class_group] = Number(row.hectares)
  }

  // Sums every digit run in a sanitation row's free-text name (e.g.
  // "Toilet - M-30, F-30, Urinal - 20" -> 30+30+20 = 80 seats), skipping
  // blank/null names (no seat breakdown recorded for that row). Each row's
  // own name/seat-count is kept too so the drawer can show its math instead
  // of just the final total.
  const toiletBlocks = toilets.rows.map((row: { name: string | null }) => {
    const matches = (row.name ?? '').match(/\d+/g)
    const seats = matches ? matches.reduce((s, n) => s + Number(n), 0) : 0
    return { name: row.name, seats }
  })
  const toiletSeats = toiletBlocks.reduce((sum, b) => sum + b.seats, 0)

  const activityGroups = new Map<string, { subclass: string; label: string }[]>()
  for (const row of activities.rows as {
    class_group: string
    subclass: string
    remark: string | null
    remark_1: string | null
  }[]) {
    const label = (
      row.remark?.trim() ||
      row.remark_1?.trim() ||
      row.subclass ||
      row.class_group
    ).trim()
    const list = activityGroups.get(row.class_group) ?? []
    list.push({ subclass: row.subclass, label })
    activityGroups.set(row.class_group, list)
  }

  return Response.json({
    sectorNo: boundary.rows[0].sector_no,
    name: boundary.rows[0].name,
    landSummary: {
      totalGeographicHectares: Number(boundary.rows[0].area_hac),
      totalMelaLandHectares: Number(meNoLand.rows[0].hectares ?? 0),
      byClass: landSummary,
    },
    keyActivities: Array.from(activityGroups.entries()).map(([classGroup, items]) => ({
      classGroup,
      items,
    })),
    utilityInfrastructure: {
      roadLengthKm: Number(road.rows[0].km ?? 0),
      dustBins: Number(dustbins.rows[0].count),
      transformers: Number(transformers.rows[0].count),
      toilets: toiletSeats,
      toiletBlockCount: toiletBlocks.length,
      toiletBlocks,
      ghats: Number(ghats.rows[0].count),
    },
  })
}
