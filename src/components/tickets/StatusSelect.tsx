'use client'

import { useState, useTransition } from 'react'
import { Select } from '@/components/ui/Select'
import { updateTicketFieldAction } from '@/server/actions/ticket.actions'

type StatusOption = { id: string; name: string; color: string }

export function StatusSelect({
  ticketNumber,
  statusId,
  statuses,
  disabled,
}: {
  ticketNumber: number
  statusId: string | null
  statuses: StatusOption[]
  disabled: boolean
}) {
  const [value, setValue] = useState(statusId)
  const [pending, startTransition] = useTransition()
  const current = statuses.find((s) => s.id === value)

  function onChange(next: string) {
    setValue(next)
    startTransition(async () => {
      try {
        await updateTicketFieldAction(ticketNumber, { statusId: next })
      } catch {
        setValue(statusId)
      }
    })
  }

  if (disabled) {
    return current ? (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
        style={{ backgroundColor: `${current.color}22`, color: current.color }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: current.color }}
          aria-hidden
        />
        {current.name}
      </span>
    ) : null
  }

  return (
    <Select
      value={value ?? ''}
      onChange={onChange}
      disabled={pending}
      variant="pill"
      size="sm"
      options={statuses.map((s) => ({ value: s.id, label: s.name, color: s.color }))}
    />
  )
}
