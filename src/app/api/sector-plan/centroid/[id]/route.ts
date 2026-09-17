import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'

export const runtime = 'nodejs'

// A single parcel's centroid, in the same ST_Centroid(geom) terms as the
// locate list's per-feature centroids (see /api/sector-plan/locate) -- used
// to fly to a specific parcel by id (e.g. from a ticket-number search) so the
// destination lines up with the parcel's actual geometry rather than
// whatever lng/lat happened to be recorded on the ticket at creation time.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sectorPlanId = Number(id)
  if (!Number.isInteger(sectorPlanId)) {
    return Response.json({ error: 'invalid id' }, { status: 400 })
  }

  const pool = getPool()
  const result = await pool.query(
    `SELECT ST_X(ST_Centroid(geom)) AS lng, ST_Y(ST_Centroid(geom)) AS lat
     FROM kumbh.sector_plan
     WHERE id = $1;`,
    [sectorPlanId],
  )

  const row = result.rows[0]
  if (!row) {
    return Response.json({ lng: null, lat: null })
  }
  return Response.json({ lng: Number(row.lng), lat: Number(row.lat) })
}
