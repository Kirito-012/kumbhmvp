import { getTicketByParcelId } from '@/server/services/ticket.service'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sectorPlanId: string }> },
) {
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

  return Response.json({
    ticket: {
      number: ticket.number,
      subject: ticket.subject,
      status: status ? { name: status.name, color: status.color } : null,
      priority: priority ? { name: priority.name, color: priority.color } : null,
    },
  })
}
