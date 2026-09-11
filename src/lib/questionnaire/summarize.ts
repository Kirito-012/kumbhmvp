import { allQuestions, getTemplate, type Question } from '@/lib/questionnaire/general-camping'
import type { QuestionnaireAnswer } from '@/lib/schemas/questionnaire'

/** Whether an answer actually carries a value, as opposed to a placeholder submitted for a
 *  question the surveyor never touched (the form submits `{questionId, skipped: false}` for
 *  every question left at its default — see `emptyAnswer` in QuestionnaireForm.tsx). Mirrors
 *  `isAnswered` there; kept in sync manually since one runs client-side and one server-side. */
function hasAnswerData(question: Question, answer: QuestionnaireAnswer): boolean {
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

/** A "No" (or an out-of-range required/actual) on a yes_no-family question is the signal a
 *  reviewer scanning the ticket thread most wants surfaced without opening the full response. */
function isFlagged(question: Question, answer: QuestionnaireAnswer): boolean {
  if (answer.skipped) return false
  if (
    question.kind === 'yes_no' ||
    question.kind === 'yes_no_na' ||
    question.kind === 'yes_no_measure'
  ) {
    return answer.choice === 'no'
  }
  if (question.kind === 'required_actual') {
    return (
      typeof answer.required === 'number' &&
      typeof answer.actual === 'number' &&
      answer.actual < answer.required
    )
  }
  return false
}

export type QuestionnaireSummary = {
  totalQuestions: number
  answeredCount: number
  skippedCount: number
  flaggedQuestionIds: string[]
}

/** Computed from a submitted answer set against its template — used both when persisting a
 *  TicketQuestionnaire (answeredCount/skippedCount) and when rendering the highlighted comment's
 *  collapsed summary chips. */
export function summarizeAnswers(
  templateKey: string,
  answers: QuestionnaireAnswer[],
): QuestionnaireSummary {
  const template = getTemplate(templateKey)
  const questions = template ? allQuestions(template) : []
  const questionById = new Map(questions.map((q) => [q.id, q]))

  let answeredCount = 0
  let skippedCount = 0
  const flaggedQuestionIds: string[] = []

  for (const answer of answers) {
    const question = questionById.get(answer.questionId)
    if (answer.skipped || !question || !hasAnswerData(question, answer)) {
      skippedCount += 1
      continue
    }
    answeredCount += 1
    if (isFlagged(question, answer)) flaggedQuestionIds.push(question.id)
  }

  return {
    totalQuestions: questions.length,
    answeredCount,
    skippedCount,
    flaggedQuestionIds,
  }
}
