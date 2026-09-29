// One-off migration: retires the 'closed' ticket status, leaving New / Open / Pending / Resolved.
//
// 1. Every 'closed' ticket becomes 'resolved' (both were isResolved, so dashboard/insights counts
//    of "done" work don't move). resolvedAt is kept if set, else falls back to closedAt.
// 2. `closedAt` is unset on every ticket -- the field is removed from the schema.
// 3. Status-change history (`field_changed` on `statusId`) that referenced Closed is rewritten to
//    Resolved. An event that becomes a Resolved -> Resolved no-op (e.g. the demo script's own
//    resolved -> closed moves) is deleted, since it would render as a change that changed nothing.
// 4. The 'closed' TicketStatus document is deleted, and Pending's colour is updated to the violet
//    that Ticket mode now paints it with (see src/lib/insights/statusBuckets.ts).
//
// Run with `--dry-run` first to see the counts. Safe to re-run: with no 'closed' status left it
// only re-applies the colour and the closedAt unset, both idempotent.
import { config } from 'dotenv'
config({ path: '.env.local' })

import mongoose from 'mongoose'
import { dbConnect } from '../src/server/db/connect'
import { TicketModel } from '../src/server/db/models/ticket.model'
import { TicketEventModel } from '../src/server/db/models/ticket-event.model'
import { TicketStatusModel } from '../src/server/db/models/ticket-status.model'

const PENDING_COLOR = '#a78bfa'
const dryRun = process.argv.includes('--dry-run')

async function main() {
  await dbConnect()

  const closed = await TicketStatusModel.findOne({ slug: 'closed' }).lean()
  const resolved = await TicketStatusModel.findOne({ slug: 'resolved' }).lean()
  if (!resolved) throw new Error('"resolved" TicketStatus not found — run scripts/seed.ts first')

  const before = await TicketModel.aggregate([{ $group: { _id: '$statusId', n: { $sum: 1 } } }])
  const slugById = new Map(
    (await TicketStatusModel.find().select('_id slug').lean()).map((s) => [String(s._id), s.slug]),
  )
  console.log(
    'Tickets by status (before):',
    Object.fromEntries(before.map((r) => [slugById.get(String(r._id)) ?? String(r._id), r.n])),
  )

  // Raw collection access: closedAt is no longer on the schema, so strict mode would drop it from
  // Mongoose queries/updates.
  const tickets = TicketModel.collection
  const withClosedAt = await tickets.countDocuments({ closedAt: { $exists: true } })

  if (!closed) {
    console.log('No "closed" status left — nothing to reassign.')
  } else {
    const closedId = String(closed._id)
    const resolvedId = String(resolved._id)
    const closedTickets = await tickets.countDocuments({ statusId: closed._id })
    const noopEvents = await TicketEventModel.countDocuments({
      field: 'statusId',
      $or: [
        { from: closedId, to: resolvedId },
        { from: resolvedId, to: closedId },
        { from: closedId, to: closedId },
      ],
    })
    const touchedEvents = await TicketEventModel.countDocuments({
      field: 'statusId',
      $or: [{ from: closedId }, { to: closedId }],
    })
    console.log(`Closed tickets -> Resolved: ${closedTickets}`)
    console.log(
      `Status events referencing Closed: ${touchedEvents} (${noopEvents} become no-ops and are deleted, ${touchedEvents - noopEvents} rewritten)`,
    )

    if (!dryRun) {
      await tickets.updateMany({ statusId: closed._id, resolvedAt: null }, [
        { $set: { resolvedAt: { $ifNull: ['$closedAt', '$updatedAt'] } } },
      ])
      await tickets.updateMany({ statusId: closed._id }, { $set: { statusId: resolved._id } })

      await TicketEventModel.deleteMany({
        field: 'statusId',
        $or: [
          { from: closedId, to: resolvedId },
          { from: resolvedId, to: closedId },
          { from: closedId, to: closedId },
        ],
      })
      await TicketEventModel.updateMany(
        { field: 'statusId', from: closedId },
        { $set: { from: resolvedId } },
      )
      await TicketEventModel.updateMany(
        { field: 'statusId', to: closedId },
        { $set: { to: resolvedId } },
      )

      const stillClosed = await tickets.countDocuments({ statusId: closed._id })
      if (stillClosed > 0) throw new Error(`${stillClosed} tickets still reference Closed`)
      await TicketStatusModel.deleteOne({ _id: closed._id })
    }
  }

  console.log(`Tickets carrying closedAt (unset): ${withClosedAt}`)
  if (!dryRun) {
    await tickets.updateMany({ closedAt: { $exists: true } }, { $unset: { closedAt: '' } })
    await TicketStatusModel.updateOne({ slug: 'pending' }, { $set: { color: PENDING_COLOR } })

    const after = await TicketModel.aggregate([{ $group: { _id: '$statusId', n: { $sum: 1 } } }])
    const slugs = new Map(
      (await TicketStatusModel.find().select('_id slug').lean()).map((s) => [
        String(s._id),
        s.slug,
      ]),
    )
    console.log(
      'Tickets by status (after):',
      Object.fromEntries(after.map((r) => [slugs.get(String(r._id)) ?? String(r._id), r.n])),
    )
  } else {
    console.log('Dry run — no changes written.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => mongoose.disconnect())
