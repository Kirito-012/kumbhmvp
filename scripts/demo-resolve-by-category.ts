// One-off demo-data helper: for every location.classGroup category, randomly resolves a
// fraction of that category's currently-open tickets so the dashboard's "Tickets by category"
// section shows non-zero completion instead of 0% everywhere. Safe to re-run — only touches
// tickets that are still unresolved, so it never un-resolves or double-counts existing work.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { dbConnect } from '../src/server/db/connect'
import { TicketModel } from '../src/server/db/models/ticket.model'
import { TicketEventModel } from '../src/server/db/models/ticket-event.model'
import { TicketStatusModel } from '../src/server/db/models/ticket-status.model'
import { UserModel } from '../src/server/db/models/user.model'
import { CLASS_GROUP_COLORS } from '../src/lib/classColors'

// Same service account import-map-tickets.ts uses to attribute bot-driven changes.
const SERVICE_ACCOUNT_EMAIL = 'kumbh-import-bot@thecraftsync.local'
// Resolve a random 30-60% of each category's currently-open tickets.
const MIN_FRACTION = 0.3
const MAX_FRACTION = 0.6

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function main() {
  await dbConnect()

  const resolvedStatus = await TicketStatusModel.findOne({ slug: 'resolved' }).lean()
  if (!resolvedStatus)
    throw new Error('Seeded "resolved" TicketStatus not found — run scripts/seed.ts first')

  const actor = await UserModel.findOne({ email: SERVICE_ACCOUNT_EMAIL }).select('_id').lean()
  if (!actor) throw new Error(`Service account ${SERVICE_ACCOUNT_EMAIL} not found`)

  const now = new Date()
  const events: {
    ticketId: unknown
    actorId: unknown
    action: string
    field: string
    from: string
    to: string
  }[] = []

  for (const classGroup of Object.keys(CLASS_GROUP_COLORS)) {
    const openTickets = await TicketModel.find({
      deletedAt: null,
      'location.classGroup': classGroup,
      statusId: { $ne: resolvedStatus._id },
    })
      .select('_id statusId')
      .lean()

    if (openTickets.length === 0) {
      console.log(`${classGroup}: no open tickets, skipping`)
      continue
    }

    const fraction = MIN_FRACTION + Math.random() * (MAX_FRACTION - MIN_FRACTION)
    const count = Math.max(1, Math.round(openTickets.length * fraction))
    const chosen = shuffle(openTickets).slice(0, count)

    await TicketModel.updateMany(
      { _id: { $in: chosen.map((t) => t._id) } },
      { $set: { statusId: resolvedStatus._id, resolvedAt: now, lastActivityAt: now } },
    )

    for (const t of chosen) {
      events.push({
        ticketId: t._id,
        actorId: actor._id,
        action: 'field_changed',
        field: 'statusId',
        from: String(t.statusId),
        to: String(resolvedStatus._id),
      })
    }

    console.log(`${classGroup}: resolved ${chosen.length} / ${openTickets.length} open tickets`)
  }

  if (events.length > 0) await TicketEventModel.insertMany(events)

  console.log(
    `\nDone. ${events.length} tickets marked resolved across ${Object.keys(CLASS_GROUP_COLORS).length} categories.`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
