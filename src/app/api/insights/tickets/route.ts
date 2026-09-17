import { getCurrentUser } from '@/server/auth/session'
import { defineAbilityFor } from '@/server/auth/ability'
import { getInsightsTicketData } from '@/server/services/insights.service'

export const runtime = 'nodejs'

/**
 * Heatmap/Ticket mode data feed — the full located-ticket set, loaded once per mode-entry (see
 * PLAN-heatmap.md §3.3). Session-authenticated like /api/search, not the api/v1 shared-secret
 * pattern, since this is called from the browser's own map session.
 *
 * Gated on `ticket:read:all` (Admin/Manager only) rather than any ticket:read grant — a Surveyor
 * has `ticket:read:own` and is never meant to see workspace-wide hotspot/status data, even though
 * MapView itself already hides the mode switcher for them (see MapView's canUseInsights prop).
 * This check is the actual security boundary; the UI gate is just convenience.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ability = defineAbilityFor(user.grants)
  if (!ability.can('read:all', 'ticket')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const data = await getInsightsTicketData()
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}
