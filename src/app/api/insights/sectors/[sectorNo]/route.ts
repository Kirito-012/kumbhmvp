import { getCurrentUser } from '@/server/auth/session'
import { defineAbilityFor } from '@/server/auth/ability'
import { getSectorInsights } from '@/server/services/insights.service'

export const runtime = 'nodejs'

/**
 * Per-sector Insights panel detail, fetched on demand when a sector is selected in Heatmap/
 * Ticket mode. `sectorNo` is either an integer sector number or the literal "peripheral" —
 * parcels with no numbered sector (location.sectorNo: null) still need a way to be inspected.
 * Same gating as /api/insights/tickets — see that route for why it's ticket:read:all, not any
 * ticket:read grant.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ sectorNo: string }> }) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ability = defineAbilityFor(user.grants)
  if (!ability.can('read:all', 'ticket')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { sectorNo: raw } = await params
  const sectorNo = raw === 'peripheral' ? null : Number(raw)
  if (sectorNo !== null && !Number.isInteger(sectorNo)) {
    return Response.json({ error: 'sectorNo must be an integer or "peripheral"' }, { status: 400 })
  }

  const data = await getSectorInsights(sectorNo)
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}
