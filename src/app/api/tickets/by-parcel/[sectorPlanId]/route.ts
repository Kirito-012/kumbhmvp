import { getTicketByParcelId, getTicketPopupExtras } from '@/server/services/ticket.service'
import { toAttachmentView, toPerson } from '@/lib/ticket-view'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ sectorPlanId: string }> }) {
  const { sectorPlanId } = await params
  const id = Number(sectorPlanId)
  if (!Number.isInteger(id)) {
    return new Response('Invalid sectorPlanId', { status: 400 })
  }

  const ticket = await getTicketByParcelId(id)
  if (!ticket) {
    return Response.json({ ticket: null })
  }

  const status = ticket.statusId as unknown as { name: string; color: string } | null
  const priority = ticket.priorityId as unknown as { name: string; color: string } | null

  // `rich=1` -- the Map mode parcel popup only -- asks for the heavier before/after photo and
  // questionnaire lookups (see getTicketPopupExtras). Ticket mode's own, far more frequent, parcel
  // popup never sets this, so it keeps paying for just the two populates above.
  const rich = new URL(req.url).searchParams.get('rich') === '1'
  const extras = rich ? await getTicketPopupExtras(String(ticket._id)) : null

  return Response.json({
    ticket: {
      number: ticket.number,
      subject: ticket.subject,
      status: status ? { name: status.name, color: status.color } : null,
      priority: priority ? { name: priority.name, color: priority.color } : null,
      ...(extras
        ? {
            assignee: toPerson(ticket.assigneeId),
            dueDate: ticket.dueDate ? new Date(ticket.dueDate).toISOString() : null,
            photos: [extras.beforePhoto, extras.afterPhoto]
              .filter((p) => p !== null)
              .map(toAttachmentView),
            questionnaireCount: extras.questionnaireCount,
          }
        : null),
    },
  })
}
