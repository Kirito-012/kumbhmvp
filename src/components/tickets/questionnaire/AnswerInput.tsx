'use client'

import { cn } from '@/lib/utils'
import type { Question } from '@/lib/questionnaire/general-camping'
import type { QuestionnaireAnswer } from '@/lib/schemas/questionnaire'

/** Pill button used for yes/no/na choices — 48px min height/width is the touch-target floor this
 *  whole form is built around (see PLAN's mobile-optimization requirement). */
function ChoicePill({
  label,
  active,
  onClick,
  tone,
}: {
  label: string
  active: boolean
  onClick: () => void
  tone?: 'positive' | 'negative' | 'neutral'
}) {
  const activeTone =
    tone === 'negative'
      ? 'border-danger bg-danger/15 text-danger'
      : tone === 'neutral'
        ? 'border-border-strong bg-overlay-strong text-foreground'
        : 'border-accent bg-accent-soft text-accent-strong'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-12 flex-1 rounded-xl border text-sm font-medium transition-colors',
        active ? activeTone : 'border-border bg-overlay text-muted-strong active:bg-overlay-strong',
      )}
    >
      {label}
    </button>
  )
}

function NumberField({
  label,
  value,
  onChange,
  unit,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  unit?: string
}) {
  return (
    <label className="flex-1">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <div className="flex items-center gap-1.5 rounded-xl border border-border bg-overlay px-3">
        <input
          type="text"
          inputMode="decimal"
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '')
            onChange(raw === '' ? null : Number(raw))
          }}
          placeholder="—"
          className="min-h-12 w-full bg-transparent text-base text-foreground outline-none"
        />
        {unit && <span className="shrink-0 text-xs text-muted">{unit}</span>}
      </div>
    </label>
  )
}

export function AnswerInput({
  question,
  answer,
  onChange,
}: {
  question: Question
  answer: QuestionnaireAnswer
  onChange: (next: QuestionnaireAnswer) => void
}) {
  const set = (patch: Partial<QuestionnaireAnswer>) =>
    onChange({ ...answer, skipped: false, ...patch })

  switch (question.kind) {
    case 'yes_no':
    case 'yes_no_na':
      return (
        <div className="flex gap-2">
          <ChoicePill
            label="Yes"
            active={answer.choice === 'yes'}
            onClick={() => set({ choice: 'yes' })}
          />
          <ChoicePill
            label="No"
            active={answer.choice === 'no'}
            tone="negative"
            onClick={() => set({ choice: 'no' })}
          />
          {question.kind === 'yes_no_na' && (
            <ChoicePill
              label="N.A."
              active={answer.choice === 'na'}
              tone="neutral"
              onClick={() => set({ choice: 'na' })}
            />
          )}
        </div>
      )

    case 'yes_no_measure':
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <ChoicePill
              label="Yes"
              active={answer.choice === 'yes'}
              onClick={() => set({ choice: 'yes' })}
            />
            <ChoicePill
              label="No"
              active={answer.choice === 'no'}
              tone="negative"
              onClick={() => set({ choice: 'no' })}
            />
          </div>
          <div className="flex gap-2">
            <NumberField
              label="Required"
              unit={question.unit}
              value={answer.required ?? null}
              onChange={(v) => set({ required: v })}
            />
            <NumberField
              label="Actual"
              unit={question.unit}
              value={answer.actual ?? null}
              onChange={(v) => set({ actual: v })}
            />
          </div>
        </div>
      )

    case 'required_actual':
      return (
        <div className="flex gap-2">
          <NumberField
            label="Required"
            unit={question.unit}
            value={answer.required ?? null}
            onChange={(v) => set({ required: v })}
          />
          <NumberField
            label="Actual"
            unit={question.unit}
            value={answer.actual ?? null}
            onChange={(v) => set({ actual: v })}
          />
        </div>
      )

    case 'dimensions':
      return (
        <div className="flex items-end gap-2">
          <NumberField
            label="Length"
            unit={question.unit}
            value={answer.length ?? null}
            onChange={(v) => set({ length: v })}
          />
          <span className="mb-3.5 text-muted">×</span>
          <NumberField
            label="Width"
            unit={question.unit}
            value={answer.width ?? null}
            onChange={(v) => set({ width: v })}
          />
        </div>
      )

    case 'measurement':
      return (
        <NumberField
          label={question.unit ? `Value (${question.unit})` : 'Value'}
          unit={question.unit}
          value={answer.value ?? null}
          onChange={(v) => set({ value: v })}
        />
      )

    case 'text':
      return (
        <textarea
          value={answer.text ?? ''}
          onChange={(e) => set({ text: e.target.value })}
          rows={3}
          className="w-full rounded-xl border border-border bg-overlay px-3 py-2.5 text-base text-foreground outline-none focus:border-accent"
        />
      )
  }
}
