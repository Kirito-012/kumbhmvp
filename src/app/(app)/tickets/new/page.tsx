import { Topbar } from '@/components/layout/Topbar'
import { Card } from '@/components/ui/Card'
import { NewTicketForm } from '@/components/tickets/NewTicketForm'
import { dbConnect } from '@/server/db/connect'
import { TicketTypeModel } from '@/server/db/models/ticket-type.model'
import { TicketPriorityModel } from '@/server/db/models/ticket-priority.model'

export default async function NewTicketPage() {
  await dbConnect()
  const [types, priorities] = await Promise.all([
    TicketTypeModel.find({ isActive: true }).sort({ name: 1 }).lean(),
    TicketPriorityModel.find().sort({ order: 1 }).lean(),
  ])

  return (
    <>
      <Topbar title="New ticket" description="Create a ticket for your team to work" />

      <main className="flex-1 px-8 py-6 animate-fade-in">
        <Card className="mx-auto max-w-2xl p-6">
          <NewTicketForm
            types={types.map((t) => ({
              id: String(t._id),
              name: t.name,
              allowedPriorityIds: (t.allowedPriorityIds ?? []).map(String),
              defaultPriorityId: t.defaultPriorityId ? String(t.defaultPriorityId) : null,
            }))}
            priorities={priorities.map((p) => ({ id: String(p._id), name: p.name }))}
          />
        </Card>
      </main>
    </>
  )
}
