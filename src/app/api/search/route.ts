import { getCurrentUser } from '@/server/auth/session'
import { defineAbilityFor } from '@/server/auth/ability'
import { searchTickets } from '@/server/services/ticket.service'
import { searchUsers } from '@/server/services/user.service'

export const runtime = 'nodejs'

/**
 * Global (Topbar) search. Session-authenticated JSON endpoint, not the x-api-key service-to-
 * service pattern api/v1 uses -- this is called from the browser, so it relies on the normal
 * session cookie the way Server Components do. Mirrors the exact visibility rules the rest of
 * the app already enforces rather than introducing new ones:
 *   - Tickets: a Surveyor (no ticket:read:all grant) only ever gets their own assigned tickets,
 *     same as requireTicketScope() forces on the Tickets page.
 *   - People: only returned to callers with the account:read grant (same as the Accounts page),
 *     since there's no separate "can search for a person" permission.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (query.length < 2) return Response.json({ tickets: [], people: [] })

  const ability = defineAbilityFor(user.grants)
  const forcedAssigneeId = ability.can('read:all', 'ticket') ? undefined : user.id
  const canSearchPeople = ability.can('read', 'account')

  const [tickets, people] = await Promise.all([
    searchTickets(query, forcedAssigneeId),
    canSearchPeople ? searchUsers(query) : Promise.resolve([]),
  ])

  return Response.json({
    tickets: tickets.map((t) => ({
      number: t.number,
      subject: t.subject,
      status: t.statusId
        ? {
            name: (t.statusId as { name: string }).name,
            color: (t.statusId as { color: string }).color,
          }
        : null,
    })),
    people: people.map((p) => ({
      id: String(p._id),
      name: p.fullname,
      email: p.email,
    })),
  })
}
