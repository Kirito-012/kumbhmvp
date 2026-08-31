import { Topbar } from '@/components/layout/Topbar'
import { Card } from '@/components/ui/Card'
import { AccountsTable } from '@/components/accounts/AccountsTable'
import { PendingApprovals } from '@/components/accounts/PendingApprovals'
import { CurrentUserCard } from '@/components/accounts/CurrentUserCard'
import { requireAbility } from '@/server/auth/session'
import * as userService from '@/server/services/user.service'

export default async function AccountsPage() {
  const { user: sessionUser, ability } = await requireAbility({
    action: 'read',
    subject: 'account',
  })
  const canEdit = ability.can('update', 'account')
  // Anyone with account:update can deactivate/reactivate and approve accounts, but reassigning
  // roles is a step above that — reserved for Admins so a Manager can't promote themselves (or
  // anyone else) to Admin.
  const canEditRole = sessionUser.roleKey === 'admin'

  const [usersRaw, pendingRaw, rolesRaw] = await Promise.all([
    userService.listUsers(),
    canEdit ? userService.listPendingUsers() : Promise.resolve([]),
    userService.listRoles(),
  ])

  const users = usersRaw.map((u) => {
    const role = u.roleId as unknown as { _id: unknown; key: string; name: string } | null
    return {
      id: String(u._id),
      fullname: u.fullname || u.email,
      email: u.email,
      roleId: role ? String(role._id) : '',
      roleName: role?.name ?? 'Unknown',
      isActive: u.isActive,
      createdAt: new Date(u.createdAt as Date).toISOString(),
    }
  })
  const pending = pendingRaw.map((u) => {
    const role = u.roleId as unknown as { key: string; name: string } | null
    return {
      id: String(u._id),
      fullname: u.fullname || u.email,
      email: u.email,
      roleName: role?.name ?? 'Unknown',
      requestedAt: new Date(u.createdAt as Date).toISOString(),
    }
  })
  const roles = rolesRaw.map((r) => ({ id: String(r._id), name: r.name }))

  const currentUser = users.find((u) => u.id === sessionUser.id)
  const otherUsers = users.filter((u) => u.id !== sessionUser.id)

  return (
    <>
      <Topbar
        title="Accounts"
        description={`${users.length} people in your workspace`}
        primaryAction={canEdit ? { label: 'New account', href: '/accounts/new' } : undefined}
      />

      <main className="flex-1 px-8 py-6 animate-fade-in">
        {currentUser && (
          <CurrentUserCard
            fullname={currentUser.fullname}
            email={currentUser.email}
            roleName={currentUser.roleName}
            isActive={currentUser.isActive}
            createdAt={currentUser.createdAt}
          />
        )}

        {canEdit && <PendingApprovals users={pending} />}

        <Card>
          <AccountsTable
            users={otherUsers}
            roles={roles}
            canEdit={canEdit}
            canEditRole={canEditRole}
          />
        </Card>
      </main>
    </>
  )
}
