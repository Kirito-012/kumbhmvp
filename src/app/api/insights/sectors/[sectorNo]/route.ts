import { getCurrentUser } from '@/server/auth/session'
import { defineAbilityFor } from '@/server/auth/ability'
import { getSectorInsights } from '@/server/services/insights.service'

export const runtime = 'nodejs'

/**
 * Per-sector Insights panel detail, fetched on demand when a sector is selected in Heatmap/
 * Ticket mode. `sectorNo` is an integer sector number, the literal "peripheral" — parcels with no
 * numbered sector (location.sectorNo: null) still need a way to be inspected — or the literal
 * "all", for the workspace overview shown while no sector is selected (Phase 5, PLAN-heatmap.md
 * §6.2). Same gating as /api/insights/tickets — see that route for why it's ticket:read:all, not
 * any ticket:read grant.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ sectorNo: string }> }) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ability = defineAbilityFor(user.grants)
  if (!ability.can('read:all', 'ticket')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { sectorNo: raw } = await params
  const target = raw === 'peripheral' || raw === 'all' ? raw : Number(raw)
  if (typeof target === 'number' && !Number.isInteger(target)) {
    return Response.json(
      { error: 'sectorNo must be an integer, "peripheral", or "all"' },
      { status: 400 },
    )
  }

  const data = await getSectorInsights(target)
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}
