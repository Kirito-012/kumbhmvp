import { getPool } from '@/server/db/postgres'
import { getCurrentUser } from '@/server/auth/session'
import { defineAbilityFor } from '@/server/auth/ability'

export const runtime = 'nodejs'

/**
 * Arrow midpoints + bearings for traffic_route/direction_line (PLAN-evacuation.md §6.2 items 5/7).
 *
 * Why a bearing computed from spatial position rather than "follow the line's own vertex order"
 * (the originally-sketched approach, and every earlier phase's reason for deferring arrows
 * entirely): checked against real data, a route/signage line's stored start/end order has no
 * reliable relationship to its Entry/Exit label -- distance-to-nearest-sector-centroid splits
 * roughly 60/40 either way for both directions, meaning trusting raw vertex order (or reversing
 * it) would point a large minority of arrows backwards with no way to tell which ones. Surveyors
 * traced these lines in whatever order was convenient in the source GIS software, not in the
 * direction of travel.
 *
 * So the arrow's DIRECTION (which of the two possible tangent headings it points) is decided from
 * geometry that IS reliable: the azimuth from the line's midpoint to (Entry) or from (Exit) its
 * nearest sector's centroid -- i.e. "into the sector" for an entry route, "away from the sector"
 * for an exit route. But that centroid azimuth is only used to PICK a side, not as the rendered
 * angle itself -- rendering it directly pointed the arrow off at whatever angle the sector
 * centroid happened to be from the midpoint, which is almost never the line's own local heading,
 * so the arrow looked disconnected/offset from the line under it even though it sat exactly on
 * the line's midpoint. Instead we compute the line's own local tangent bearing (from a point
 * just before the midpoint to a point just after it, i.e. the two headings the line could
 * plausibly be pointing at that spot) and pick whichever of those two matches the centroid
 * azimuth's general side (within 90 degrees) -- so the rendered arrow always follows the line's
 * own visual slope, using the centroid only to disambiguate which end is "forward".
 */

type ArrowFeature = {
  type: 'Feature'
  id: number
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: Record<string, unknown>
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const ability = defineAbilityFor(user.grants)
  if (!ability.can('read:all', 'ticket')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const pool = getPool()

  // traffic_route also carries plan/corridor flags so the arrows layer can be filtered by
  // applyEvacFilters exactly like evac-traffic-route-peak/-normal -- an arrow whose base route is
  // hidden by a filter would otherwise float on the map with no line under it.
  const [trafficRoute, directionLine] = await Promise.all([
    pool.query(`
      SELECT r.id,
             ST_X(r.mid) AS lng, ST_Y(r.mid) AS lat,
             degrees(
               CASE WHEN abs(mod((degrees(r.tangent) - degrees(r.ref_bearing) + 540)::numeric, 360::numeric) - 180) > 90
                    THEN r.tangent + radians(180)
                    ELSE r.tangent
               END
             ) AS bearing,
             r.entry_exit, r.plan, r.deh_dir, r.naj_dir, r.sah_dir, r.meer_dir
      FROM (
        SELECT t.id, t.entry_exit, t.plan, t.deh_dir, t.naj_dir, t.sah_dir, t.meer_dir, t.mid,
               COALESCE(ST_Azimuth(t.before, t.after), rb.ref_bearing) AS tangent,
               rb.ref_bearing
        FROM (
          SELECT id, entry_exit, plan, deh_dir, naj_dir, sah_dir, meer_dir,
                 ST_LineInterpolatePoint(ST_GeometryN(geom, 1), 0.5) AS mid,
                 ST_LineInterpolatePoint(ST_GeometryN(geom, 1), 0.45) AS before,
                 ST_LineInterpolatePoint(ST_GeometryN(geom, 1), 0.55) AS after,
                 geom
          FROM kumbh.traffic_route
          WHERE upper(entry_exit) IN ('ENTRY', 'EXIT')
        ) t
        LEFT JOIN LATERAL (
          SELECT CASE WHEN upper(t.entry_exit) = 'ENTRY' THEN ST_Azimuth(t.mid, b.centroid)
                      ELSE ST_Azimuth(b.centroid, t.mid)
                 END AS ref_bearing
          FROM (
            SELECT ST_Centroid(b.geom) AS centroid
            FROM kumbh.sector_boundary b
            ORDER BY b.geom <-> t.geom
            LIMIT 1
          ) b
        ) rb ON TRUE
      ) r;
    `),
    pool.query(`
      SELECT r.id,
             ST_X(r.mid) AS lng, ST_Y(r.mid) AS lat,
             degrees(
               CASE WHEN abs(mod((degrees(r.tangent) - degrees(r.ref_bearing) + 540)::numeric, 360::numeric) - 180) > 90
                    THEN r.tangent + radians(180)
                    ELSE r.tangent
               END
             ) AS bearing,
             r.remark
      FROM (
        SELECT t.id, t.remark, t.mid,
               COALESCE(ST_Azimuth(t.before, t.after), rb.ref_bearing) AS tangent,
               rb.ref_bearing
        FROM (
          SELECT id, remark,
                 ST_LineInterpolatePoint(ST_GeometryN(geom, 1), 0.5) AS mid,
                 ST_LineInterpolatePoint(ST_GeometryN(geom, 1), 0.45) AS before,
                 ST_LineInterpolatePoint(ST_GeometryN(geom, 1), 0.55) AS after,
                 geom
          FROM kumbh.direction_line
          WHERE upper(remark) IN ('ENTRY', 'EXIT')
        ) t
        LEFT JOIN LATERAL (
          SELECT CASE WHEN upper(t.remark) = 'ENTRY' THEN ST_Azimuth(t.mid, b.centroid)
                      ELSE ST_Azimuth(b.centroid, t.mid)
                 END AS ref_bearing
          FROM (
            SELECT ST_Centroid(b.geom) AS centroid
            FROM kumbh.sector_boundary b
            ORDER BY b.geom <-> t.geom
            LIMIT 1
          ) b
        ) rb ON TRUE
      ) r;
    `),
  ])

  const toFeatures = (rows: Record<string, unknown>[], extraProps: (r: Record<string, unknown>) => Record<string, unknown>): ArrowFeature[] =>
    rows.map((r) => ({
      type: 'Feature',
      id: Number(r.id),
      geometry: { type: 'Point', coordinates: [Number(r.lng), Number(r.lat)] },
      properties: { bearing: Number(r.bearing), ...extraProps(r) },
    }))

  return Response.json(
    {
      trafficRoute: {
        type: 'FeatureCollection',
        features: toFeatures(trafficRoute.rows, (r) => ({
          entry_exit: r.entry_exit,
          plan: r.plan,
          deh_dir: r.deh_dir,
          naj_dir: r.naj_dir,
          sah_dir: r.sah_dir,
          meer_dir: r.meer_dir,
        })),
      },
      directionLine: {
        type: 'FeatureCollection',
        features: toFeatures(directionLine.rows, (r) => ({ remark: r.remark })),
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600' } },
  )
}
