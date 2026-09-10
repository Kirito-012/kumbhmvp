import { describe, expect, it } from 'vitest'
import { GENERAL_CAMPING, allQuestions } from '@/lib/questionnaire/general-camping'
import {
  questionnaireAnswerSchema,
  submitQuestionnaireSchema,
  validateAnswersAgainstTemplate,
} from './questionnaire'

const questions = allQuestions(GENERAL_CAMPING)

describe('questionnaireAnswerSchema', () => {
  it('accepts a fully-skipped answer', () => {
    const result = questionnaireAnswerSchema.safeParse({
      questionId: questions[0].id,
      skipped: true,
    })
    expect(result.success).toBe(true)
  })

  it('accepts a fully-answered yes/no answer', () => {
    const result = questionnaireAnswerSchema.safeParse({
      questionId: questions[0].id,
      skipped: false,
      choice: 'yes',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an answer with only questionId (everything else absent)', () => {
    const result = questionnaireAnswerSchema.safeParse({ questionId: questions[0].id })
    expect(result.success).toBe(true)
  })

  it('rejects a non-numeric measurement value', () => {
    const result = questionnaireAnswerSchema.safeParse({
      questionId: questions[0].id,
      value: 'not-a-number',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid choice enum value', () => {
    const result = questionnaireAnswerSchema.safeParse({
      questionId: questions[0].id,
      choice: 'maybe',
    })
    expect(result.success).toBe(false)
  })
})

describe('submitQuestionnaireSchema', () => {
  it('accepts a submission with every question skipped', () => {
    const result = submitQuestionnaireSchema.safeParse({
      ticketNumber: 42,
      templateKey: GENERAL_CAMPING.key,
      answers: questions.map((q) => ({ questionId: q.id, skipped: true })),
    })
    expect(result.success).toBe(true)
  })

  it('accepts a submission with every question answered', () => {
    const result = submitQuestionnaireSchema.safeParse({
      ticketNumber: 42,
      templateKey: GENERAL_CAMPING.key,
      answers: questions.map((q) => ({ questionId: q.id, skipped: false, choice: 'yes' })),
      remarks: 'All clear.',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-positive ticket number', () => {
    const result = submitQuestionnaireSchema.safeParse({
      ticketNumber: -1,
      templateKey: GENERAL_CAMPING.key,
      answers: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('validateAnswersAgainstTemplate', () => {
  it('returns null for answers that match real question ids', () => {
    const error = validateAnswersAgainstTemplate(GENERAL_CAMPING.key, [
      { questionId: questions[0].id, skipped: true },
    ])
    expect(error).toBeNull()
  })

  it('flags a bogus questionId', () => {
    const error = validateAnswersAgainstTemplate(GENERAL_CAMPING.key, [
      { questionId: 'not_a_real_question', skipped: true },
    ])
    expect(error).not.toBeNull()
  })

  it('flags an unknown template key', () => {
    const error = validateAnswersAgainstTemplate('nonexistent_template', [])
    expect(error).not.toBeNull()
  })
})
