'use client'

import { useState, useTransition } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { deleteTicketAction } from '@/server/actions/ticket.actions'

/** Soft-deletes the ticket (sets `deletedAt`, logs a 'deleted' event) and returns to the list.
 *  Only rendered for roles holding `ticket:delete`; the action re-checks that server-side. */
export function DeleteTicketButton({ ticketNumber }: { ticketNumber: number }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    if (!window.confirm(`Delete ticket #${ticketNumber}? It will be removed from all lists.`)) {
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await deleteTicketAction(ticketNumber)
      } catch (e) {
        // redirect() inside the action surfaces as NEXT_REDIRECT, which the framework handles
        // itself -- only a real failure should reach here.
        if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e
        setError('Could not delete this ticket.')
      }
    })
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-sm text-danger">{error}</span>}
      <Button type="button" variant="danger" size="md" onClick={onClick} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        Delete ticket
      </Button>
    </div>
  )
}
