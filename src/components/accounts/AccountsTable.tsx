'use client'

import { useTransition } from 'react'
import { updateUserRoleAction, setUserActiveAction } from '@/server/actions/account.actions'
import { cn, initialsFor, timeAgo } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { Select } from '@/components/ui/Select'

export type AccountRow = {
  id: string
  fullname: string
  email: string
  roleId: string
  roleName: string
  isActive: boolean
  createdAt: string
}

export type RoleOption = { id: string; name: string }

export const ROLE_COLOR: Record<string, string> = {
  Admin: '#818cf8',
  Manager: '#f59e0b',
  Agent: '#10b981',
}

export function AccountsTable({
  users,
  roles,
  canEdit,
  canEditRole,
}: {
  users: AccountRow[]
  roles: RoleOption[]
  canEdit: boolean
  canEditRole: boolean
}) {
  const [pending, startTransition] = useTransition()

  function handleRoleChange(userId: string, roleId: string) {
    startTransition(() => updateUserRoleAction(userId, roleId))
  }

  function handleToggleActive(userId: string, next: boolean) {
    startTransition(() => setUserActiveAction(userId, next))
  }

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="text-sm font-medium text-foreground">No accounts yet</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-5 py-3 font-medium">Name</th>
            <th className="px-3 py-3 font-medium">Role</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">Joined</th>
            {canEdit && <th className="px-5 py-3" />}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-border last:border-b-0">
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <Avatar
                    person={{
                      name: u.fullname,
                      initials: initialsFor(u.fullname),
                      color: ROLE_COLOR[u.roleName] ?? '#3f3f46',
                    }}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{u.fullname}</p>
                    <p className="truncate text-xs text-muted">{u.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3.5">
                {canEditRole ? (
                  <div className="w-32">
                    <Select
                      value={u.roleId}
                      disabled={pending}
                      onChange={(roleId) => handleRoleChange(u.id, roleId)}
                      size="sm"
                      options={roles.map((r) => ({ value: r.id, label: r.name }))}
                    />
                  </div>
                ) : (
                  <span
                    className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: `${ROLE_COLOR[u.roleName] ?? '#3f3f46'}22`,
                      color: ROLE_COLOR[u.roleName] ?? '#9aa1ac',
                    }}
                  >
                    {u.roleName}
                  </span>
                )}
              </td>
              <td className="px-3 py-3.5">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-xs font-medium',
                    u.isActive ? 'text-accent-strong' : 'text-muted',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      u.isActive ? 'bg-accent-strong' : 'bg-muted',
                    )}
                  />
                  {u.isActive ? 'Active' : 'Deactivated'}
                </span>
              </td>
              <td className="px-3 py-3.5 text-xs text-muted">{timeAgo(u.createdAt)}</td>
              {canEdit && (
                <td className="px-5 py-3.5 text-right">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleToggleActive(u.id, !u.isActive)}
                    className="cursor-pointer text-xs font-medium text-muted-strong transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {u.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
