'use client'

import { useEffect, useMemo, useState, useActionState, useTransition } from 'react'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Check,
  SkipForward,
} from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { GENERAL_CAMPING, type Question } from '@/lib/questionnaire/general-camping'
import type { QuestionnaireAnswer } from '@/lib/schemas/questionnaire'
import type { QuestionnaireView } from '@/lib/ticket-view'
import { AnswerInput } from '@/components/tickets/questionnaire/AnswerInput'
import {
  submitQuestionnaireAction,
  type QuestionnaireActionState,
} from '@/server/actions/questionnaire.actions'
import { updateTicketFieldAction } from '@/server/actions/ticket.actions'

const TEMPLATE = GENERAL_CAMPING

function emptyAnswer(questionId: string): QuestionnaireAnswer {
  return { questionId, skipped: false }
}

function isAnswered(question: Question, answer: QuestionnaireAnswer | undefined) {
  if (!answer || answer.skipped) return false
  switch (question.kind) {
    case 'yes_no':
    case 'yes_no_na':
      return answer.choice != null
    case 'yes_no_measure':
      return answer.choice != null || answer.required != null || answer.actual != null
    case 'required_actual':
      return answer.required != null || answer.actual != null
    case 'dimensions':
      return answer.length != null || answer.width != null
    case 'measurement':
      return answer.value != null
    case 'text':
      return !!answer.text?.trim()
  }
}

function isSkipped(answer: QuestionnaireAnswer | undefined) {
  return !!answer?.skipped
}

/** A question is "handled" once the surveyor has either answered it or deliberately skipped it —
 *  distinct from isAnswered() above, which only counts real answers. Every question in this form
 *  is designed to be skippable, so treating "skipped" the same as "never looked at" in the
 *  progress UI would make the one number meant to reassure a surveyor of their progress actively
 *  misleading for the form's primary use case. */
function isHandled(question: Question, answer: QuestionnaireAnswer | undefined) {
  return isSkipped(answer) || isAnswered(question, answer)
}

function draftKey(ticketNumber: number) {
  return `questionnaire-draft:${ticketNumber}:${TEMPLATE.key}:v${TEMPLATE.version}`
}

function loadDraft(
  ticketNumber: number,
): { answers: Record<string, QuestionnaireAnswer>; remarks: string } | null {
  try {
    const raw = localStorage.getItem(draftKey(ticketNumber))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveDraft(
  ticketNumber: number,
  answers: Record<string, QuestionnaireAnswer>,
  remarks: string,
) {
  try {
    localStorage.setItem(draftKey(ticketNumber), JSON.stringify({ answers, remarks }))
  } catch {
    // localStorage can throw (private mode, quota, disabled) — draft autosave is a convenience,
    // not a requirement, so failures here are silently ignored.
  }
}

function clearDraft(ticketNumber: number) {
  try {
    localStorage.removeItem(draftKey(ticketNumber))
  } catch {
    // see saveDraft
  }
}

/** Seeds the form with the ticket's most recent submitted response, so resubmitting doesn't mean
 *  re-answering everything from scratch. Field shapes line up 1:1 with QuestionnaireAnswer — the
 *  view type is just the persisted-data twin (`T | null` vs. `T | null | undefined`). */
function answersFromPrevious(view: QuestionnaireView): Record<string, QuestionnaireAnswer> {
  const out: Record<string, QuestionnaireAnswer> = {}
  for (const a of view.answers) {
    out[a.questionId] = {
      questionId: a.questionId,
      skipped: a.skipped,
      choice: a.choice,
      required: a.required,
      actual: a.actual,
      length: a.length,
      width: a.width,
      value: a.value,
      text: a.text,
    }
  }
  return out
}

/** remarksHtml is sanitized markup (see sanitizeHtml in questionnaire.actions), but the remarks
 *  field here is a plain textarea — strip tags back down to text for prefill. */
function remarksFromPrevious(view: QuestionnaireView): string {
  if (!view.remarksHtml) return ''
  return view.remarksHtml
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

export function QuestionnaireForm({
  open,
  onClose,
  ticketNumber,
  resolvedStatusId,
  canUpdateStatus,
  previousQuestionnaire,
}: {
  open: boolean
  onClose: () => void
  ticketNumber: number
  /** First status row with isResolved:true, if any — offered as the one-tap post-submit action. */
  resolvedStatusId: string | null
  canUpdateStatus: boolean
  /** The ticket's most recent submitted response, if any — used to prefill a new submission. */
  previousQuestionnaire: QuestionnaireView | null
}) {
  const [answers, setAnswers] = useState<Record<string, QuestionnaireAnswer>>({})
  const [remarks, setRemarks] = useState('')
  const [step, setStep] = useState(0) // section index; sections.length === review step
  const [resolvePrompt, setResolvePrompt] = useState(false)
  const [isResolving, startResolving] = useTransition()

  const [state, formAction, pending] = useActionState<QuestionnaireActionState, FormData>(
    submitQuestionnaireAction,
    undefined,
  )

  const sections = TEMPLATE.sections
  const totalQuestions = useMemo(
    () => sections.reduce((n, s) => n + s.questions.length, 0),
    [sections],
  )
  const allQuestionsFlat = useMemo(() => sections.flatMap((s) => s.questions), [sections])
  const answeredCount = useMemo(
    () => allQuestionsFlat.filter((q) => isAnswered(q, answers[q.id])).length,
    [allQuestionsFlat, answers],
  )
  const skippedCount = useMemo(
    () => allQuestionsFlat.filter((q) => isSkipped(answers[q.id])).length,
    [allQuestionsFlat, answers],
  )

  // Two render-time state transitions below, following React's documented "storing information
  // from previous renders" pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // instead of useEffect: the previous trigger value is kept in *state* (refs can't be read/written
  // during render under the React Compiler) and compared on every render; a mismatch means the
  // trigger just changed, so the state update happens directly in the render body. This keeps the
  // update synchronous with the triggering render and avoids an effect for what's actually a
  // derived-state transition, not a sync-with-an-external-system concern.

  // 1) Sheet opened for the first time (or reopened after a full close) -> offer to resume a draft;
  //    otherwise seed the form from the ticket's last submitted response, if any.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      const draft = loadDraft(ticketNumber)
      const resumed = draft && Object.keys(draft.answers).length > 0
      const resume = resumed && window.confirm('Resume your saved draft for this questionnaire?')
      if (resume) {
        setAnswers(draft.answers)
        setRemarks(draft.remarks)
      } else {
        if (resumed) clearDraft(ticketNumber)
        setAnswers(previousQuestionnaire ? answersFromPrevious(previousQuestionnaire) : {})
        setRemarks(previousQuestionnaire ? remarksFromPrevious(previousQuestionnaire) : '')
      }
    }
  }

  // 2) The submit action just settled successfully -> clear the draft and advance past the form.
  const [prevPending, setPrevPending] = useState(pending)
  if (pending !== prevPending) {
    const wasPending = prevPending
    setPrevPending(pending)
    if (wasPending && !pending && state?.success) {
      clearDraft(ticketNumber)
      if (canUpdateStatus && resolvedStatusId) setResolvePrompt(true)
      else handleFullClose()
    }
  }

  // Debounced autosave — this one *is* a genuine effect (synchronizing React state to an
  // external system, localStorage, on a timer), which is exactly what useEffect is for.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => saveDraft(ticketNumber, answers, remarks), 500)
    return () => clearTimeout(t)
  }, [open, ticketNumber, answers, remarks])

  function handleFullClose() {
    setStep(0)
    setResolvePrompt(false)
    // Answers/remarks are intentionally left as-is here — the next open-transition above reseeds
    // them (from a resumed draft, the previous submission, or blank), so resetting to blank now
    // would just be undone a moment later and would fight the "prefill on resubmit" behavior.
    onClose()
  }

  function setAnswer(questionId: string, next: QuestionnaireAnswer) {
    setAnswers((prev) => ({ ...prev, [questionId]: next }))
  }

  function toggleSkip(questionId: string) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] ?? emptyAnswer(questionId)),
        skipped: !prev[questionId]?.skipped,
      },
    }))
  }

  const isReview = step === sections.length
  const currentSection = sections[step]

  const sectionProgress = useMemo(
    () =>
      sections.map((s) => {
        const handled = s.questions.filter((q) => isHandled(q, answers[q.id])).length
        return { handled, total: s.questions.length }
      }),
    [sections, answers],
  )

  // Split into "not reached" (genuinely untouched — worth a nudge before submitting) vs.
  // "skipped" (a deliberate choice, not an oversight) so the review screen doesn't lump a
  // surveyor's intentional skips in with questions they simply never got to.
  const notReached = useMemo(
    () =>
      sections.flatMap((s, sIdx) =>
        s.questions
          .filter((q) => !isHandled(q, answers[q.id]))
          .map((q) => ({ question: q, sectionIndex: sIdx })),
      ),
    [sections, answers],
  )
  const skipped = useMemo(
    () =>
      sections.flatMap((s, sIdx) =>
        s.questions
          .filter((q) => isSkipped(answers[q.id]))
          .map((q) => ({ question: q, sectionIndex: sIdx })),
      ),
    [sections, answers],
  )

  const answersPayload = useMemo(
    () => sections.flatMap((s) => s.questions).map((q) => answers[q.id] ?? emptyAnswer(q.id)),
    [sections, answers],
  )

  function handleResolveNow() {
    startResolving(async () => {
      await updateTicketFieldAction(ticketNumber, { statusId: resolvedStatusId! })
      handleFullClose()
    })
  }

  return (
    <Sheet
      open={open}
      onClose={handleFullClose}
      title={resolvePrompt ? 'Questionnaire submitted' : TEMPLATE.title}
      compact={resolvePrompt}
      sidebar={
        resolvePrompt ? undefined : (
          <div className="flex flex-1 flex-col overflow-y-auto p-3">
            <p className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted">
              Sections
            </p>
            <div className="space-y-0.5">
              {sections.map((s, idx) => {
                const { handled, total } = sectionProgress[idx]
                const complete = handled === total
                const active = step === idx
                return (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => setStep(idx)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-accent-soft text-accent-strong'
                        : 'text-muted-strong hover:bg-overlay-strong hover:text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                        complete
                          ? 'border-accent/40 bg-accent text-background'
                          : active
                            ? 'border-accent-strong text-accent-strong'
                            : 'border-border-strong text-muted',
                      )}
                    >
                      {complete ? <Check className="h-3 w-3" /> : idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {handled}/{total}
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setStep(sections.length)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                  isReview
                    ? 'bg-accent-soft text-accent-strong'
                    : 'text-muted-strong hover:bg-overlay-strong hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                    isReview
                      ? 'border-accent-strong text-accent-strong'
                      : 'border-border-strong text-muted',
                  )}
                >
                  <CheckCircle2 className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">Review &amp; submit</span>
              </button>
            </div>
          </div>
        )
      }
      subheader={
        resolvePrompt ? undefined : (
          <div className="shrink-0 border-b border-border bg-background px-4 pb-3 pt-2 sm:px-5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                {isReview ? 'Review' : `Section ${step + 1} of ${sections.length}`}
                {!isReview && (
                  <span className="ml-1.5 text-muted/70">· {currentSection.title}</span>
                )}
              </span>
              <span className="flex items-center gap-2 font-medium text-muted-strong">
                <span className="flex items-center gap-1">
                  <Check className="h-3 w-3 text-accent-strong" />
                  {answeredCount}
                </span>
                <span className="flex items-center gap-1">
                  <SkipForward className="h-3 w-3 text-muted" />
                  {skippedCount}
                </span>
                <span className="text-muted/70">/ {totalQuestions}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-overlay">
              <div className="flex h-full w-full">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
                />
                <div
                  className="h-full bg-muted-strong/50 transition-all"
                  style={{ width: `${(skippedCount / totalQuestions) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )
      }
      footer={
        resolvePrompt ? undefined : (
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="min-h-12 shrink-0"
                onClick={() => setStep((s) => s - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            {isReview ? (
              <Button
                type="button"
                size="lg"
                className="min-h-12 flex-1"
                disabled={pending}
                onClick={() => {
                  const form = document.getElementById(
                    'questionnaire-form',
                  ) as HTMLFormElement | null
                  form?.requestSubmit()
                }}
              >
                {pending ? 'Submitting…' : 'Submit questionnaire'}
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                className="min-h-12 flex-1"
                onClick={() => setStep((s) => s + 1)}
              >
                {step === sections.length - 1 ? 'Review' : 'Next'}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      }
    >
      {resolvePrompt ? (
        <div className="flex flex-col items-center gap-5 px-2 py-2 text-center">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-soft ring-8 ring-accent-soft/40">
            <CheckCircle2 className="h-7 w-7 text-accent-strong" />
          </div>
          <p className="max-w-[26ch] text-sm leading-6 text-muted-strong">
            Would you like to mark this ticket as{' '}
            <span className="font-semibold text-foreground">Resolved</span>?
          </p>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="min-h-12 flex-1"
              onClick={handleFullClose}
            >
              Not now
            </Button>
            <Button
              type="button"
              size="lg"
              className="min-h-12 flex-1"
              disabled={isResolving}
              onClick={handleResolveNow}
            >
              {isResolving ? 'Updating…' : 'Mark as Resolved'}
            </Button>
          </div>
        </div>
      ) : (
        <form id="questionnaire-form" action={formAction} className="space-y-5">
          <input type="hidden" name="ticketNumber" value={ticketNumber} />
          <input type="hidden" name="templateKey" value={TEMPLATE.key} />
          <input type="hidden" name="answers" value={JSON.stringify(answersPayload)} />
          <input type="hidden" name="remarks" value={remarks} />

          {state?.error && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {state.error}
            </div>
          )}

          {!isReview ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start xl:gap-5">
              {currentSection.questions.map((q) => {
                const answer = answers[q.id] ?? emptyAnswer(q.id)
                const wide = q.kind === 'text' || q.kind === 'yes_no_measure'
                return (
                  <div
                    key={q.id}
                    className={cn(
                      'rounded-xl border p-3.5 transition-colors lg:p-4',
                      wide && 'xl:col-span-2',
                      answer.skipped
                        ? 'border-border bg-overlay/40'
                        : 'border-border bg-surface/40 hover:border-border-strong',
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className={cn(answer.skipped && 'opacity-60')}>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                          Q{q.no} · {q.parameter}
                        </p>
                        <p className="mt-0.5 text-sm text-foreground">{q.prompt}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleSkip(q.id)}
                        className={cn(
                          'flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-3 text-[11px] font-medium transition-colors hover:bg-overlay-strong active:bg-overlay-strong lg:min-h-8',
                          answer.skipped
                            ? 'border-accent bg-accent-soft text-accent-strong'
                            : 'border-border text-muted',
                        )}
                      >
                        {answer.skipped && <SkipForward className="h-3 w-3" />}
                        {answer.skipped ? 'Skipped' : 'Skip'}
                      </button>
                    </div>
                    {!answer.skipped && (
                      <AnswerInput
                        question={q}
                        answer={answer}
                        onChange={(next) => setAnswer(q.id, next)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-5">
              {notReached.length > 0 && (
                <div className="rounded-xl border-2 border-warning bg-warning-soft/50 p-3.5">
                  <p className="mb-2 text-sm font-semibold text-warning">
                    {notReached.length} question{notReached.length === 1 ? '' : 's'} not reached
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {notReached.map(({ question, sectionIndex }) => (
                      <button
                        key={question.id}
                        type="button"
                        onClick={() => setStep(sectionIndex)}
                        className="min-h-11 rounded-md border border-warning bg-background px-2.5 text-xs font-semibold text-warning active:bg-warning-soft"
                      >
                        Q{question.no}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {skipped.length > 0 && (
                <div className="rounded-xl border border-border bg-overlay/40 p-3.5">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-strong">
                    <SkipForward className="h-3.5 w-3.5" />
                    {skipped.length} question{skipped.length === 1 ? '' : 's'} skipped
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {skipped.map(({ question, sectionIndex }) => (
                      <button
                        key={question.id}
                        type="button"
                        onClick={() => setStep(sectionIndex)}
                        className="min-h-11 rounded-md border border-border bg-background px-2.5 text-xs text-muted-strong active:bg-overlay-strong"
                      >
                        Q{question.no}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">Remarks</span>
                <span className="mb-2 block text-xs text-muted">
                  Optional — anything not covered above.
                </span>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={5}
                  placeholder="Additional observations…"
                  className="w-full rounded-xl border border-border bg-overlay px-3 py-2.5 text-base text-foreground outline-none focus:border-accent"
                />
              </label>
            </div>
          )}
        </form>
      )}
    </Sheet>
  )
}
