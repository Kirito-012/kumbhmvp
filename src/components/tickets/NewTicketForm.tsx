'use client'

import { useMemo, useState, useActionState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { createTicketAction, type ActionState } from '@/server/actions/ticket.actions'

type TypeOption = {
  id: string
  name: string
  allowedPriorityIds: string[]
  defaultPriorityId: string | null
}
type PriorityOption = { id: string; name: string }

export function NewTicketForm({
  types,
  priorities,
}: {
  types: TypeOption[]
  priorities: PriorityOption[]
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createTicketAction,
    undefined,
  )
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const [issue, setIssue] = useState('')

  const selectedType = types.find((t) => t.id === typeId)
  const allowedPriorities = useMemo(
    () =>
      selectedType && selectedType.allowedPriorityIds.length > 0
        ? priorities.filter((p) => selectedType.allowedPriorityIds.includes(p.id))
        : priorities,
    [selectedType, priorities],
  )
  const [priorityId, setPriorityId] = useState(
    selectedType?.defaultPriorityId ?? priorities[0]?.id ?? '',
  )

  function handleTypeChange(nextTypeId: string) {
    setTypeId(nextTypeId)
    const nextType = types.find((t) => t.id === nextTypeId)
    const nextAllowed =
      nextType && nextType.allowedPriorityIds.length > 0
        ? priorities.filter((p) => nextType.allowedPriorityIds.includes(p.id))
        : priorities
    if (!nextAllowed.some((p) => p.id === priorityId)) {
      setPriorityId(nextType?.defaultPriorityId ?? nextAllowed[0]?.id ?? '')
    }
  }

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="subject" className="mb-1.5 block text-xs font-medium text-muted-strong">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          required
          minLength={3}
          maxLength={200}
          placeholder="Briefly describe the issue"
          className="h-10 w-full rounded-lg border border-border-strong bg-overlay px-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/50 focus:bg-overlay-strong focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="typeId" className="mb-1.5 block text-xs font-medium text-muted-strong">
            Type
          </label>
          <Select
            name="typeId"
            value={typeId}
            onChange={handleTypeChange}
            options={types.map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>

        <div>
          <label
            htmlFor="priorityId"
            className="mb-1.5 block text-xs font-medium text-muted-strong"
          >
            Priority
          </label>
          <Select
            name="priorityId"
            value={priorityId}
            onChange={setPriorityId}
            options={allowedPriorities.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-strong">Description</label>
        <RichTextEditor
          content={issue}
          onChange={setIssue}
          placeholder="Describe the issue in detail…"
        />
        <input type="hidden" name="issue" value={issue} />
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Creating…' : 'Create ticket'}
        </Button>
      </div>
    </form>
  )
}
