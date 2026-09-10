import { allQuestions, getTemplate, type Question } from '@/lib/questionnaire/general-camping'
import type { QuestionnaireAnswer } from '@/lib/schemas/questionnaire'

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
    if (answer.skipped) {
      skippedCount += 1
      continue
    }
    answeredCount += 1
    const question = questionById.get(answer.questionId)
    if (question && isFlagged(question, answer)) flaggedQuestionIds.push(question.id)
  }

  return {
    totalQuestions: questions.length,
    answeredCount,
    skippedCount,
    flaggedQuestionIds,
  }
}
