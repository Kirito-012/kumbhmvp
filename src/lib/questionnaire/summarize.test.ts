import { describe, expect, it } from 'vitest'
import { GENERAL_CAMPING, allQuestions } from './general-camping'
import { summarizeAnswers } from './summarize'
import type { QuestionnaireAnswer } from '@/lib/schemas/questionnaire'

const questions = allQuestions(GENERAL_CAMPING)
const yesNoQuestion = questions.find((q) => q.kind === 'yes_no')!
const requiredActualQuestion = questions.find((q) => q.kind === 'required_actual')!

describe('summarizeAnswers', () => {
  it('counts every question as skipped when none are answered', () => {
    const answers: QuestionnaireAnswer[] = questions.map((q) => ({
      questionId: q.id,
      skipped: true,
    }))
    const summary = summarizeAnswers(GENERAL_CAMPING.key, answers)
    expect(summary.totalQuestions).toBe(questions.length)
    expect(summary.skippedCount).toBe(questions.length)
    expect(summary.answeredCount).toBe(0)
    expect(summary.flaggedQuestionIds).toEqual([])
  })

  it('counts a "no" answer on a yes_no question as flagged', () => {
    const answers: QuestionnaireAnswer[] = [
      { questionId: yesNoQuestion.id, skipped: false, choice: 'no' },
    ]
    const summary = summarizeAnswers(GENERAL_CAMPING.key, answers)
    expect(summary.answeredCount).toBe(1)
    expect(summary.flaggedQuestionIds).toEqual([yesNoQuestion.id])
  })

  it('does not flag a "yes" answer', () => {
    const answers: QuestionnaireAnswer[] = [
      { questionId: yesNoQuestion.id, skipped: false, choice: 'yes' },
    ]
    const summary = summarizeAnswers(GENERAL_CAMPING.key, answers)
    expect(summary.flaggedQuestionIds).toEqual([])
  })

  it('flags a required_actual answer where actual < required', () => {
    const answers: QuestionnaireAnswer[] = [
      { questionId: requiredActualQuestion.id, skipped: false, required: 5, actual: 2 },
    ]
    const summary = summarizeAnswers(GENERAL_CAMPING.key, answers)
    expect(summary.flaggedQuestionIds).toEqual([requiredActualQuestion.id])
  })

  it('does not flag a required_actual answer where actual >= required', () => {
    const answers: QuestionnaireAnswer[] = [
      { questionId: requiredActualQuestion.id, skipped: false, required: 5, actual: 5 },
    ]
    const summary = summarizeAnswers(GENERAL_CAMPING.key, answers)
    expect(summary.flaggedQuestionIds).toEqual([])
  })

  it('a skipped answer is never flagged even with a "no"-shaped payload', () => {
    const answers: QuestionnaireAnswer[] = [
      { questionId: yesNoQuestion.id, skipped: true, choice: 'no' },
    ]
    const summary = summarizeAnswers(GENERAL_CAMPING.key, answers)
    expect(summary.skippedCount).toBe(1)
    expect(summary.answeredCount).toBe(0)
    expect(summary.flaggedQuestionIds).toEqual([])
  })
})
