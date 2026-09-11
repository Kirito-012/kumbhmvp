'use client'

import { useEffect, useRef, useState, useActionState } from 'react'
import { AlertCircle, Lock } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { QuestionnaireResponseCard } from '@/components/tickets/questionnaire/QuestionnaireResponseCard'
import { cn, timeAgo } from '@/lib/utils'
import { addCommentAction, type ActionState } from '@/server/actions/ticket.actions'
import type { CommentView, QuestionnaireView } from '@/lib/ticket-view'

export function CommentThread({
  ticketNumber,
  comments,
  questionnairesById,
  canComment,
  canNote,
}: {
  ticketNumber: number
  comments: CommentView[]
  /** Keyed by TicketQuestionnaire id — looked up via each comment's `questionnaireId`. */
  questionnairesById: Record<string, QuestionnaireView>
  canComment: boolean
  canNote: boolean
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    addCommentAction,
    undefined,
  )
  const [body, setBody] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const wasPending = useRef(false)

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      setBody('')
      setIsInternal(false)
      setEditorKey((k) => k + 1)
    }
    wasPending.current = pending
  }, [pending, state])

  return (
    <div className="space-y-5">
      {comments.length === 0 && (
        <p className="text-sm text-muted">No comments yet — be the first to reply.</p>
      )}

      {comments.map((c) => {
        if (
          c.kind === 'questionnaire' &&
          c.questionnaireId &&
          questionnairesById[c.questionnaireId]
        ) {
          return (
            <QuestionnaireResponseCard
              key={c.id}
              questionnaire={questionnairesById[c.questionnaireId]}
              surveyorName={c.author?.name ?? 'Unknown'}
            />
          )
        }

        return (
          <div
            key={c.id}
            className={cn('flex gap-3', c.isInternal && 'rounded-lg bg-warning-soft/40 p-3')}
          >
            <Avatar
              person={
                c.author
                  ? { name: c.author.name, initials: c.author.initials, color: '#818cf8' }
                  : { name: 'Unknown', initials: '?', color: '#4b5563' }
              }
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">{c.author?.name ?? 'Unknown'}</p>
                {c.isInternal && (
                  <span className="flex items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">
                    <Lock className="h-2.5 w-2.5" /> Internal note
                  </span>
                )}
                <span className="text-[11px] text-muted">{timeAgo(c.createdAt)}</span>
              </div>
              <div
                className="mt-1 text-sm text-muted-strong [&_p]:my-1"
                dangerouslySetInnerHTML={{ __html: c.bodyHtml }}
              />
            </div>
          </div>
        )
      })}

      {(canComment || canNote) && (
        <form action={formAction} className="space-y-3 border-t border-border pt-4">
          <input type="hidden" name="ticketNumber" value={ticketNumber} />
          <input type="hidden" name="isInternal" value={String(isInternal)} />
          <input type="hidden" name="body" value={body} />

          {state?.error && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {state.error}
            </div>
          )}

          <RichTextEditor
            key={editorKey}
            content={body}
            onChange={setBody}
            placeholder={isInternal ? 'Write an internal note…' : 'Write a reply…'}
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {canNote ? (
              <label className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2.5 rounded-lg px-1 py-2 text-sm leading-5 text-muted-strong sm:items-center">
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border-strong bg-transparent accent-amber-500 sm:mt-0"
                />
                <span className="min-w-0">Internal note (not visible to the requester)</span>
              </label>
            ) : (
              <span />
            )}
            <Button
              type="submit"
              size="sm"
              className="min-h-11 w-full shrink-0 sm:w-auto"
              disabled={pending || !body.trim()}
            >
              {pending ? 'Posting…' : isInternal ? 'Add note' : 'Reply'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
