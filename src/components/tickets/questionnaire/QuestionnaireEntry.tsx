'use client'

import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { QuestionnaireForm } from '@/components/tickets/questionnaire/QuestionnaireForm'

export function QuestionnaireEntry({
  ticketNumber,
  hasExistingResponse,
  resolvedStatusId,
  canUpdateStatus,
}: {
  ticketNumber: number
  hasExistingResponse: boolean
  resolvedStatusId: string | null
  canUpdateStatus: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        // Primary treatment when there's no response yet — this is the main action the page
        // exists for a Surveyor to take, so it needs to visually outrank the ticket's other
        // controls (it previously used the low-contrast `secondary` style, which read as an
        // inert/disabled gray pill rather than the page's main call to action). Once a response
        // already exists, "submit another" is a secondary, occasional action.
        variant={hasExistingResponse ? 'secondary' : 'primary'}
        size="lg"
        className="min-h-12 w-full"
        onClick={() => setOpen(true)}
      >
        <ClipboardList className="h-4 w-4" />
        {hasExistingResponse ? 'Submit another response' : 'Fill Questionnaire'}
      </Button>

      <QuestionnaireForm
        open={open}
        onClose={() => setOpen(false)}
        ticketNumber={ticketNumber}
        resolvedStatusId={resolvedStatusId}
        canUpdateStatus={canUpdateStatus}
      />
    </>
  )
}
