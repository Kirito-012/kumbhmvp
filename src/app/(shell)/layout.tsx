import { AppShell } from '@/components/layout/AppShell'
import { requireTicketScope } from '@/server/auth/session'
import { countTicketsByStatus } from '@/server/services/ticket.service'
import { listPendingUsers } from '@/server/services/user.service'

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const { user, ability, forcedAssigneeId } = await requireTicketScope()
  const canApproveAccounts = ability.can('update', 'account')
  const [ticketCounts, pendingUsers] = await Promise.all([
    countTicketsByStatus(forcedAssigneeId),
    canApproveAccounts ? listPendingUsers() : Promise.resolve([]),
  ])

  return (
    <AppShell
      user={user}
      ticketCount={ticketCounts.total}
      pendingAccountsCount={pendingUsers.length}
      variant="overlay"
    >
      {children}
    </AppShell>
  )
}
