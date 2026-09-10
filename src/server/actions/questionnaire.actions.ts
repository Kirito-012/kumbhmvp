'use server'

import { revalidatePath } from 'next/cache'
import { requireTicketScope } from '@/server/auth/session'
import { sanitizeHtml } from '@/lib/sanitize-html'
import {
  submitQuestionnaireSchema,
  validateAnswersAgainstTemplate,
} from '@/lib/schemas/questionnaire'
import * as ticketService from '@/server/services/ticket.service'
import * as questionnaireService from '@/server/services/questionnaire.service'

export type QuestionnaireActionState = { error?: string; success?: boolean } | undefined

export async function submitQuestionnaireAction(
  _prevState: QuestionnaireActionState,
  formData: FormData,
): Promise<QuestionnaireActionState> {
  const number = Number(formData.get('ticketNumber'))
  const answersRaw = formData.get('answers')

  const { user, ability, forcedAssigneeId } = await requireTicketScope()
  // A questionnaire submission is just a structured comment — same grant as a normal reply.
  if (!ability.can('create', 'comment')) {
    return { error: 'You do not have permission to do that.' }
  }

  if (forcedAssigneeId) {
    const ticket = await ticketService.getTicketByNumber(number)
    const assignee = (ticket as { assigneeId?: { _id?: unknown } | null } | null)?.assigneeId
    if (String(assignee?._id ?? '') !== forcedAssigneeId) {
      return { error: 'You do not have permission to do that.' }
    }
  }

  let answers: unknown
  try {
    answers = typeof answersRaw === 'string' ? JSON.parse(answersRaw) : null
  } catch {
    return { error: 'Invalid submission' }
  }

  const parsed = submitQuestionnaireSchema.safeParse({
    ticketNumber: number,
    templateKey: formData.get('templateKey'),
    answers,
    remarks: formData.get('remarks') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const templateError = validateAnswersAgainstTemplate(parsed.data.templateKey, parsed.data.answers)
  if (templateError) return { error: templateError }

  await questionnaireService.submitQuestionnaire({
    ticketNumber: number,
    surveyorId: user.id,
    templateKey: parsed.data.templateKey,
    answers: parsed.data.answers,
    remarks: parsed.data.remarks ? sanitizeHtml(parsed.data.remarks) : null,
  })

  revalidatePath(`/tickets/${number}`)
  return { success: true }
}
