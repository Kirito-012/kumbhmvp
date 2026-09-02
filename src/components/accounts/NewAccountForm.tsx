'use client'

import { useActionState, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { createAccountAction, type ActionState } from '@/server/actions/account.actions'

type RoleOption = { id: string; name: string }

export function NewAccountForm({ roles }: { roles: RoleOption[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createAccountAction,
    undefined,
  )
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '')

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="fullname" className="mb-1.5 block text-xs font-medium text-muted-strong">
          Full name
        </label>
        <input
          id="fullname"
          name="fullname"
          required
          maxLength={120}
          placeholder="Jane Doe"
          className="h-10 w-full rounded-lg border border-border-strong bg-overlay px-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/50 focus:bg-overlay-strong focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-muted-strong">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="jane@company.com"
          className="h-10 w-full rounded-lg border border-border-strong bg-overlay px-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/50 focus:bg-overlay-strong focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-muted-strong">
          Temporary password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="At least 8 characters"
          className="h-10 w-full rounded-lg border border-border-strong bg-overlay px-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/50 focus:bg-overlay-strong focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div>
        <label htmlFor="roleId" className="mb-1.5 block text-xs font-medium text-muted-strong">
          Role
        </label>
        <Select
          name="roleId"
          value={roleId}
          onChange={setRoleId}
          options={roles.map((r) => ({ value: r.id, label: r.name }))}
        />
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Creating…' : 'Create account'}
        </Button>
      </div>
    </form>
  )
}
