'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { StatusSelect } from '@/components/tickets/StatusSelect'
import { AssigneeDropdown } from '@/components/tickets/AssigneeDropdown'
import { updateTicketFieldAction } from '@/server/actions/ticket.actions'
import { timeAgo } from '@/lib/utils'

type Option = { id: string; name: string }
type ColoredOption = { id: string; name: string; color: string }
type UserOption = { id: string; name: string }
type PersonView = { id: string; name: string; initials: string } | null

export function TicketDetailSidebar({
  ticketNumber,
  statusId,
  assignee,
  priorityId,
  typeId,
  dueDate,
  statuses,
  priorities,
  types,
  users,
  canUpdate,
  canAssign,
}: {
  ticketNumber: number
  statusId: string | null
  assignee: PersonView
  priorityId: string | null
  typeId: string | null
  dueDate: string | null
  statuses: ColoredOption[]
  priorities: ColoredOption[]
  types: Option[]
  users: UserOption[]
  canUpdate: boolean
  canAssign: boolean
}) {
  const [values, setValues] = useState({ priorityId, typeId, dueDate })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function update(field: string, value: string | null) {
    setValues((prev) => ({ ...prev, [field]: value }))
    setError(null)
    startTransition(async () => {
      try {
        await updateTicketFieldAction(ticketNumber, { [field]: value })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update')
      }
    })
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-danger">{error}</p>}
      {pending && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </p>
      )}

      <Field label="Status">
        <StatusSelect
          ticketNumber={ticketNumber}
          statusId={statusId}
          statuses={statuses}
          disabled={!canUpdate}
        />
      </Field>

      <Field label="Assignee">
        <AssigneeDropdown
          ticketNumber={ticketNumber}
          assignee={assignee}
          users={users}
          disabled={!canAssign}
        />
      </Field>

      <Field label="Priority">
        <Select
          value={values.priorityId ?? ''}
          disabled={!canUpdate}
          onChange={(v) => update('priorityId', v)}
          variant="pill"
          size="sm"
          options={priorities.map((p) => ({ value: p.id, label: p.name, color: p.color }))}
        />
      </Field>

      <Field label="Type">
        <Select
          value={values.typeId ?? ''}
          disabled={!canUpdate}
          onChange={(v) => update('typeId', v)}
          size="sm"
          options={types.map((t) => ({ value: t.id, label: t.name }))}
        />
      </Field>

      <Field label="Due date">
        <input
          type="date"
          disabled={!canUpdate}
          value={values.dueDate ? values.dueDate.slice(0, 10) : ''}
          onChange={(e) =>
            update('dueDate', e.target.value ? new Date(e.target.value).toISOString() : null)
          }
          className="h-9 w-full rounded-lg border border-border-strong bg-white/[0.03] px-2.5 text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        {values.dueDate && (
          <p className="mt-1 text-[11px] text-muted">Due {timeAgo(values.dueDate)}</p>
        )}
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted/70">
        {label}
      </p>
      {children}
    </div>
  )
}
