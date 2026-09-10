import 'server-only'

import { dbConnect } from '@/server/db/connect'
import { TicketModel } from '@/server/db/models/ticket.model'
import { TicketCommentModel } from '@/server/db/models/ticket-comment.model'
import { TicketEventModel } from '@/server/db/models/ticket-event.model'
import { TicketQuestionnaireModel } from '@/server/db/models/ticket-questionnaire.model'
import { getTemplate } from '@/lib/questionnaire/general-camping'
import { summarizeAnswers } from '@/lib/questionnaire/summarize'
import type { QuestionnaireAnswer } from '@/lib/schemas/questionnaire'

export async function submitQuestionnaire(input: {
  ticketNumber: number
  surveyorId: string
  templateKey: string
  answers: QuestionnaireAnswer[]
  remarks: string | null
}) {
  await dbConnect()

  const ticket = await TicketModel.findOne({ number: input.ticketNumber, deletedAt: null })
  if (!ticket) throw new Error('Ticket not found')

  const template = getTemplate(input.templateKey)
  if (!template) throw new Error('Unknown questionnaire template')

  const { answeredCount, skippedCount, flaggedQuestionIds } = summarizeAnswers(
    input.templateKey,
    input.answers,
  )

  const location = ticket.get('location') as {
    sectorNo?: number | null
    block?: string | null
    plotNo?: string | null
    classGroup?: string | null
  } | null

  const questionnaire = await TicketQuestionnaireModel.create({
    ticketId: ticket._id,
    surveyorId: input.surveyorId,
    templateKey: input.templateKey,
    version: template.version,
    answers: input.answers,
    remarks: input.remarks,
    locationSnapshot: {
      sectorNo: location?.sectorNo ?? null,
      block: location?.block ?? null,
      plotNo: location?.plotNo ?? null,
      classGroup: location?.classGroup ?? null,
    },
    answeredCount,
    skippedCount,
  })

  // Plain-text summary only — the full structured response renders from the TicketQuestionnaire
  // doc via QuestionnaireResponseCard, not from this body (see comment model for why: the
  // sanitizeHtml allowlist has no table/div support for a rendered answer grid).
  const flaggedSuffix =
    flaggedQuestionIds.length > 0 ? ` · ${flaggedQuestionIds.length} flagged` : ''
  const summaryText = `Questionnaire Response — ${template.title} · ${answeredCount} answered, ${skippedCount} skipped${flaggedSuffix}`

  const comment = await TicketCommentModel.create({
    ticketId: ticket._id,
    authorId: input.surveyorId,
    body: summaryText,
    isInternal: false,
    kind: 'questionnaire',
    questionnaireId: questionnaire._id,
  })

  questionnaire.commentId = comment._id
  await questionnaire.save()

  ticket.counts.comments += 1
  ticket.lastActivityAt = new Date()
  if (!ticket.firstResponseAt) ticket.firstResponseAt = new Date()
  await ticket.save()

  await TicketEventModel.create({
    ticketId: ticket._id,
    actorId: input.surveyorId,
    action: 'questionnaire_submitted',
    meta: { questionnaireId: questionnaire._id, answeredCount, skippedCount },
  })

  return { questionnaire, comment }
}

export async function listQuestionnaires(ticketId: string) {
  await dbConnect()
  return TicketQuestionnaireModel.find({ ticketId, deletedAt: null })
    .sort({ createdAt: 1 })
    .populate({ path: 'surveyorId', select: 'fullname email avatarUrl' })
    .lean()
}

export async function getQuestionnaireById(id: string) {
  await dbConnect()
  return TicketQuestionnaireModel.findOne({ _id: id, deletedAt: null })
    .populate({ path: 'surveyorId', select: 'fullname email avatarUrl' })
    .lean()
}
