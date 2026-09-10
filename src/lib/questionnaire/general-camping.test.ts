import { describe, expect, it } from 'vitest'
import { GENERAL_CAMPING, allQuestions, totalQuestionCount } from './general-camping'

describe('GENERAL_CAMPING template', () => {
  const questions = allQuestions(GENERAL_CAMPING)

  it('has unique question ids', () => {
    const ids = questions.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has display numbers running 1..N with no gaps or duplicates', () => {
    const numbers = questions.map((q) => q.no).sort((a, b) => a - b)
    expect(numbers).toEqual(Array.from({ length: questions.length }, (_, i) => i + 1))
  })

  it('totalQuestionCount matches the flattened question list', () => {
    expect(totalQuestionCount(GENERAL_CAMPING)).toBe(questions.length)
  })

  it('every question has a non-empty prompt and parameter', () => {
    for (const q of questions) {
      expect(q.prompt.trim().length).toBeGreaterThan(0)
      expect(q.parameter.trim().length).toBeGreaterThan(0)
    }
  })

  it('every measurement-family question declares a unit', () => {
    const measurementKinds = new Set([
      'measurement',
      'dimensions',
      'required_actual',
      'yes_no_measure',
    ])
    for (const q of questions) {
      if (measurementKinds.has(q.kind)) {
        expect(q.unit, `question ${q.id} (${q.kind}) should declare a unit`).toBeTruthy()
      }
    }
  })

  it('sections are non-empty and ids are unique', () => {
    expect(GENERAL_CAMPING.sections.length).toBeGreaterThan(0)
    const sectionIds = GENERAL_CAMPING.sections.map((s) => s.id)
    expect(new Set(sectionIds).size).toBe(sectionIds.length)
    for (const s of GENERAL_CAMPING.sections) {
      expect(s.questions.length).toBeGreaterThan(0)
    }
  })
})
