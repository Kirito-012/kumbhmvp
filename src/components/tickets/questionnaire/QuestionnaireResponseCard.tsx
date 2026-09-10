'use client'

import { useState } from 'react'
import { ChevronDown, ClipboardCheck, AlertTriangle } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { GENERAL_CAMPING, type Question } from '@/lib/questionnaire/general-camping'
import type { QuestionnaireView, QuestionnaireAnswerView } from '@/lib/ticket-view'

function formatAnswer(question: Question, answer: QuestionnaireAnswerView | undefined) {
  if (!answer || answer.skipped) return { text: 'Skipped', flagged: false }

  switch (question.kind) {
    case 'yes_no':
    case 'yes_no_na':
      return {
        text: answer.choice ? answer.choice.toUpperCase() : '—',
        flagged: answer.choice === 'no',
      }
    case 'yes_no_measure': {
      const parts = [answer.choice ? answer.choice.toUpperCase() : null]
      if (answer.required != null || answer.actual != null) {
        parts.push(
          `Req ${answer.required ?? '—'}${question.unit ?? ''} / Actual ${answer.actual ?? '—'}${question.unit ?? ''}`,
        )
      }
      return { text: parts.filter(Boolean).join(' · ') || '—', flagged: answer.choice === 'no' }
    }
    case 'required_actual': {
      const flagged =
        answer.required != null && answer.actual != null && answer.actual < answer.required
      return {
        text: `Required ${answer.required ?? '—'}${question.unit ?? ''} / Actual ${answer.actual ?? '—'}${question.unit ?? ''}`,
        flagged,
      }
    }
    case 'dimensions':
      return {
        text: `${answer.length ?? '—'} × ${answer.width ?? '—'} ${question.unit ?? ''}`,
        flagged: false,
      }
    case 'measurement':
      return { text: `${answer.value ?? '—'} ${question.unit ?? ''}`, flagged: false }
    case 'text':
      return { text: answer.text?.trim() || '—', flagged: false }
  }
}

export function QuestionnaireResponseCard({
  questionnaire,
  surveyorName,
}: {
  questionnaire: QuestionnaireView
  surveyorName: string
}) {
  const [expanded, setExpanded] = useState(false)
  const template = GENERAL_CAMPING // only template today; templateKey is stored for future ones
  const answerById = new Map(questionnaire.answers.map((a) => [a.questionId, a]))

  const flaggedCount = template.sections
    .flatMap((s) => s.questions)
    .filter((q) => formatAnswer(q, answerById.get(q.id)).flagged).length

  return (
    <div className="rounded-lg border border-accent/30 bg-accent-soft/30 p-3.5">
      <div className="flex items-start gap-2.5">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
            <span className="font-semibold text-accent-strong">Questionnaire Response</span>
            <span className="text-muted">· {template.title}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            by <span className="font-medium text-muted-strong">{surveyorName}</span> ·{' '}
            {timeAgo(questionnaire.createdAt)}
          </p>

          <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full bg-background px-2 py-0.5 text-muted-strong">
              {questionnaire.answeredCount} answered
            </span>
            <span className="rounded-full bg-background px-2 py-0.5 text-muted-strong">
              {questionnaire.skippedCount} skipped
            </span>
            {flaggedCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-danger">
                <AlertTriangle className="h-3 w-3" />
                {flaggedCount} flagged
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mt-2.5 flex min-h-9 items-center gap-1 text-xs font-medium text-accent-strong active:opacity-70"
          >
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
            />
            {expanded ? 'Hide answers' : 'Show all answers'}
          </button>

          {expanded && (
            <div className="mt-3 space-y-4">
              {template.sections.map((section) => (
                <div key={section.id}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {section.title}
                  </p>
                  <dl className="space-y-1.5">
                    {section.questions.map((q) => {
                      const { text, flagged } = formatAnswer(q, answerById.get(q.id))
                      return (
                        <div
                          key={q.id}
                          className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                        >
                          <dt className="text-xs text-muted-strong">
                            Q{q.no}. {q.parameter}
                          </dt>
                          <dd
                            className={cn(
                              'text-xs font-medium',
                              flagged ? 'text-danger' : 'text-foreground',
                            )}
                          >
                            {text}
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
                </div>
              ))}

              {questionnaire.remarksHtml && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Remarks
                  </p>
                  <div
                    className="text-xs text-muted-strong [&_p]:my-1"
                    dangerouslySetInnerHTML={{ __html: questionnaire.remarksHtml }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
