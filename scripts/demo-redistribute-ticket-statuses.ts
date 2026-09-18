// One-off demo-data helper: the seeded/imported ticket data only ever produced 'new' and
// 'resolved' tickets, so the Insights "In progress" and "Closed" buckets sat at a very unrealistic
// 0 forever. This moves a random slice of 'new' tickets into 'open'/'pending' (the two statuses
// that collapse into the "In progress" bucket -- see statusBuckets.ts) and a random slice of
// 'resolved' tickets into 'closed', so the status pie looks like an event actually in progress.
// Safe to re-run -- each pass only pulls from tickets still sitting in the *source* status, so it
// never moves an already-moved ticket a second time or un-resolves/un-closes anything.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { dbConnect } from '../src/server/db/connect'
import { TicketModel } from '../src/server/db/models/ticket.model'
import { TicketEventModel } from '../src/server/db/models/ticket-event.model'
import { TicketStatusModel } from '../src/server/db/models/ticket-status.model'
import { UserModel } from '../src/server/db/models/user.model'

// Same service account import-map-tickets.ts / demo-resolve-by-category.ts use to attribute
// bot-driven changes.
const SERVICE_ACCOUNT_EMAIL = 'kumbh-import-bot@thecraftsync.local'

// Of currently-'new' tickets, this fraction moves into the 'open'/'pending' ("In progress")
// bucket -- split between the two so both statuses end up with non-zero, plausible counts.
const NEW_TO_PROGRESS_FRACTION = 0.3
const OPEN_SHARE_OF_PROGRESS = 0.55

// Of currently-'resolved' tickets, this fraction moves into 'closed'.
const RESOLVED_TO_CLOSED_FRACTION = 0.25

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

  const statuses = await TicketStatusModel.find({
    slug: { $in: ['new', 'open', 'pending', 'resolved', 'closed'] },
  }).lean()
  const byslug = Object.fromEntries(statuses.map((s) => [s.slug, s]))
  for (const slug of ['new', 'open', 'pending', 'resolved', 'closed']) {
    if (!byslug[slug])
      throw new Error(`Seeded "${slug}" TicketStatus not found — run scripts/seed.ts first`)
  }

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

  // --- new -> open/pending ("In progress") ------------------------------------------------
  const newTickets = await TicketModel.find({ deletedAt: null, statusId: byslug.new._id })
    .select('_id statusId')
    .lean()

  const progressCount = Math.round(newTickets.length * NEW_TO_PROGRESS_FRACTION)
  const chosenForProgress = shuffle(newTickets).slice(0, progressCount)
  const openCount = Math.round(chosenForProgress.length * OPEN_SHARE_OF_PROGRESS)
  const toOpen = chosenForProgress.slice(0, openCount)
  const toPending = chosenForProgress.slice(openCount)

  if (toOpen.length > 0) {
    await TicketModel.updateMany(
      { _id: { $in: toOpen.map((t) => t._id) } },
      { $set: { statusId: byslug.open._id, lastActivityAt: now } },
    )
    for (const t of toOpen) {
      events.push({
        ticketId: t._id,
        actorId: actor._id,
        action: 'field_changed',
        field: 'statusId',
        from: String(t.statusId),
        to: String(byslug.open._id),
      })
    }
  }
  if (toPending.length > 0) {
    await TicketModel.updateMany(
      { _id: { $in: toPending.map((t) => t._id) } },
      { $set: { statusId: byslug.pending._id, lastActivityAt: now } },
    )
    for (const t of toPending) {
      events.push({
        ticketId: t._id,
        actorId: actor._id,
        action: 'field_changed',
        field: 'statusId',
        from: String(t.statusId),
        to: String(byslug.pending._id),
      })
    }
  }
  console.log(
    `new -> open/pending: moved ${toOpen.length} to open, ${toPending.length} to pending (${chosenForProgress.length} / ${newTickets.length} new tickets)`,
  )

  // --- resolved -> closed --------------------------------------------------------------------
  const resolvedTickets = await TicketModel.find({ deletedAt: null, statusId: byslug.resolved._id })
    .select('_id statusId')
    .lean()

  const closedCount = Math.round(resolvedTickets.length * RESOLVED_TO_CLOSED_FRACTION)
  const chosenForClosed = shuffle(resolvedTickets).slice(0, closedCount)

  if (chosenForClosed.length > 0) {
    await TicketModel.updateMany(
      { _id: { $in: chosenForClosed.map((t) => t._id) } },
      { $set: { statusId: byslug.closed._id, closedAt: now, lastActivityAt: now } },
    )
    for (const t of chosenForClosed) {
      events.push({
        ticketId: t._id,
        actorId: actor._id,
        action: 'field_changed',
        field: 'statusId',
        from: String(t.statusId),
        to: String(byslug.closed._id),
      })
    }
  }
  console.log(
    `resolved -> closed: moved ${chosenForClosed.length} / ${resolvedTickets.length} resolved tickets`,
  )

  if (events.length > 0) await TicketEventModel.insertMany(events)

  console.log(`\nDone. ${events.length} tickets updated.`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
