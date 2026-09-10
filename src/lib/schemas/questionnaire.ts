import { z } from 'zod'
import { allQuestions, getTemplate } from '@/lib/questionnaire/general-camping'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

/** One answer row. Every field beyond `questionId` is optional/nullable by design — the survey
 *  is explicitly not mandatory (see AGENTS brief), so this only validates *shape*, never
 *  presence. `skipped: true` short-circuits the rest of the row at the service layer. */
export const questionnaireAnswerSchema = z.object({
  questionId: z.string().min(1),
  skipped: z.boolean().default(false),
  choice: z.enum(['yes', 'no', 'na']).nullable().optional(),
  required: z.number().nullable().optional(),
  actual: z.number().nullable().optional(),
  length: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  value: z.number().nullable().optional(),
  text: z.string().trim().max(500).nullable().optional(),
})

export type QuestionnaireAnswer = z.infer<typeof questionnaireAnswerSchema>

export const submitQuestionnaireSchema = z.object({
  ticketNumber: z.coerce.number().int().positive(),
  templateKey: z.string().min(1),
  answers: z.array(questionnaireAnswerSchema).max(200),
  remarks: z.string().trim().max(4000).optional(),
})

export type SubmitQuestionnaireInput = z.infer<typeof submitQuestionnaireSchema>

/** Cross-checks that every answer's questionId is actually part of the named template and
 *  template version — guards against a stale client (old cached form) submitting ids that no
 *  longer exist. Called by the action after the base Zod parse succeeds. */
export function validateAnswersAgainstTemplate(
  templateKey: string,
  answers: QuestionnaireAnswer[],
) {
  const template = getTemplate(templateKey)
  if (!template) return 'Unknown questionnaire template'

  const validIds = new Set(allQuestions(template).map((q) => q.id))
  for (const answer of answers) {
    if (!validIds.has(answer.questionId)) return `Unknown question: ${answer.questionId}`
  }
  return null
}

export const signSitePhotoSchema = z.object({
  ticketNumber: z.coerce.number().int().positive(),
  phase: z.enum(['before', 'after']),
})

export const saveSitePhotoSchema = z.object({
  ticketNumber: z.coerce.number().int().positive(),
  phase: z.enum(['before', 'after']),
  publicId: z.string().min(1),
  url: z.string().url(),
  width: z.number().optional(),
  height: z.number().optional(),
  bytes: z.number().optional(),
  format: z.string().optional(),
})

export const deleteSitePhotoSchema = z.object({
  attachmentId: objectId,
})
