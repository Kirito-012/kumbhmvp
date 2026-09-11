'use client'

import { useState, useTransition } from 'react'
import { Loader2, Pencil } from 'lucide-react'
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
    <div className="space-y-5">
      {(canUpdate || canAssign) && (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-overlay/50 px-3 py-2 text-sm text-muted-strong">
          <Pencil className="h-3.5 w-3.5 shrink-0 text-accent-strong" />
          Select a field below to edit
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {pending && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
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
          className="h-11 w-full rounded-lg border border-border-strong bg-overlay px-3 text-sm text-foreground outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
        {values.dueDate && (
          <p className="mt-1.5 text-sm text-muted">Due {timeAgo(values.dueDate)}</p>
        )}
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-muted-strong">{label}</p>
      {children}
    </div>
  )
}
