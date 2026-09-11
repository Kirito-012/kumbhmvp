'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { QuestionnaireForm } from '@/components/tickets/questionnaire/QuestionnaireForm'
import type { QuestionnaireView } from '@/lib/ticket-view'

export function QuestionnaireEntry({
  ticketNumber,
  hasExistingResponse,
  resolvedStatusId,
  canUpdateStatus,
  previousQuestionnaire,
}: {
  ticketNumber: number
  hasExistingResponse: boolean
  resolvedStatusId: string | null
  canUpdateStatus: boolean
  /** The ticket's most recent submitted response, if any — used to prefill a new submission. */
  previousQuestionnaire: QuestionnaireView | null
}) {
  const [open, setOpen] = useState(false)
  // This entry point renders inside the header Card, which has `backdrop-blur-sm` -- a
  // containing-block trigger for `position: fixed` descendants (same class of bug documented in
  // Sheet.tsx). Without portaling, the mobile CTA bar below ends up fixed relative to that Card
  // instead of the viewport, so it scrolls away with the page instead of staying pinned to the
  // bottom of the screen.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const label = hasExistingResponse ? 'Submit another response' : 'Fill questionnaire'

  return (
    <>
      <Button
        type="button"
        variant={hasExistingResponse ? 'secondary' : 'primary'}
        size="lg"
        className="hidden min-h-12 w-full sm:inline-flex"
        onClick={() => setOpen(true)}
      >
        <ClipboardList className="h-4 w-4" />
        {label}
      </Button>

      {mounted &&
        createPortal(
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:hidden">
            <Button
              type="button"
              size="lg"
              className={cn('min-h-12 w-full', hasExistingResponse && 'shadow-none')}
              variant={hasExistingResponse ? 'secondary' : 'primary'}
              onClick={() => setOpen(true)}
            >
              <ClipboardList className="h-4 w-4" />
              {label}
            </Button>
          </div>,
          document.body,
        )}

      <QuestionnaireForm
        open={open}
        onClose={() => setOpen(false)}
        ticketNumber={ticketNumber}
        resolvedStatusId={resolvedStatusId}
        canUpdateStatus={canUpdateStatus}
        previousQuestionnaire={previousQuestionnaire}
      />
    </>
  )
}
