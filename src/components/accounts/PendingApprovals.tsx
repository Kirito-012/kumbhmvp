'use client'

import { useTransition } from 'react'
import { Clock, Check, X } from 'lucide-react'
import { approveUserAction, rejectUserAction } from '@/server/actions/account.actions'
import { initialsFor } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'

export type PendingRow = {
  id: string
  fullname: string
  email: string
  roleName: string
  requestedAt: string
}

export function PendingApprovals({ users }: { users: PendingRow[] }) {
  const [pending, startTransition] = useTransition()

  if (users.length === 0) return null

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-warning/25 bg-warning-soft/40">
      <div className="flex items-center gap-2.5 border-b border-warning/20 px-5 py-3.5">
        <Clock className="h-4 w-4 text-warning" />
        <p className="text-sm font-semibold text-foreground">
          {users.length} account{users.length === 1 ? '' : 's'} awaiting approval
        </p>
      </div>
      <div className="divide-y divide-warning/10">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-5 py-3.5">
            <Avatar
              person={{ name: u.fullname, initials: initialsFor(u.fullname), color: '#f59e0b' }}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {u.fullname} <span className="font-normal text-muted">requesting {u.roleName}</span>
              </p>
              <p className="truncate text-xs text-muted">{u.email}</p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => approveUserAction(u.id))}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-black transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => rejectUserAction(u.id))}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong bg-white/[0.03] px-3 text-xs font-medium text-muted-strong transition-colors hover:bg-white/[0.07] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
