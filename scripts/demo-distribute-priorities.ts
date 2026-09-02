// One-off demo-data helper: redistributes every ticket's priority across all four seeded
// priorities (low/normal/high/critical) using a realistic weighted split, instead of everything
// sitting on the "Normal" default from the map import — so the dashboard's "Priority breakdown"
// donut shows a real mix. Safe to re-run: reshuffles every ticket's priority each run.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { dbConnect } from '../src/server/db/connect'
import { TicketModel } from '../src/server/db/models/ticket.model'
import { TicketEventModel } from '../src/server/db/models/ticket-event.model'
import { TicketPriorityModel } from '../src/server/db/models/ticket-priority.model'
import { UserModel } from '../src/server/db/models/user.model'

// Same service account import-map-tickets.ts / demo-resolve-by-category.ts use to attribute
// bot-driven changes.
const SERVICE_ACCOUNT_EMAIL = 'kumbh-import-bot@thecraftsync.local'

// Realistic ops weighting: most tickets are routine, a shrinking share gets more urgent.
const WEIGHTS: Record<string, number> = { low: 0.35, normal: 0.4, high: 0.18, critical: 0.07 }
const BATCH_SIZE = 500

function pickWeighted<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][]
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let r = Math.random() * total
  for (const [key, w] of entries) {
    r -= w
    if (r <= 0) return key
  }
  return entries[entries.length - 1][0]
}

async function main() {
  await dbConnect()

  const priorities = await TicketPriorityModel.find({ slug: { $in: Object.keys(WEIGHTS) } }).lean()
  const priorityBySlug = new Map(priorities.map((p) => [p.slug, p]))
  const missing = Object.keys(WEIGHTS).filter((slug) => !priorityBySlug.has(slug))
  if (missing.length > 0) {
    throw new Error(
      `Missing seeded TicketPriority docs for: ${missing.join(', ')} — run scripts/seed.ts first`,
    )
  }

  const actor = await UserModel.findOne({ email: SERVICE_ACCOUNT_EMAIL }).select('_id').lean()
  if (!actor) throw new Error(`Service account ${SERVICE_ACCOUNT_EMAIL} not found`)

  const tickets = await TicketModel.find({ deletedAt: null }).select('_id priorityId').lean()
  console.log(`Redistributing priority for ${tickets.length} tickets...`)

  const counts: Record<string, number> = { low: 0, normal: 0, high: 0, critical: 0 }
  const now = new Date()
  const writes: { updateOne: { filter: { _id: unknown }; update: Record<string, unknown> } }[] = []
  const events: {
    ticketId: unknown
    actorId: unknown
    action: string
    field: string
    from: string
    to: string
  }[] = []

  for (const t of tickets) {
    const slug = pickWeighted(WEIGHTS)
    const priority = priorityBySlug.get(slug)!
    counts[slug]++

    if (String(t.priorityId) === String(priority._id)) continue

    writes.push({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { priorityId: priority._id, lastActivityAt: now } },
      },
    })
    events.push({
      ticketId: t._id,
      actorId: actor._id,
      action: 'field_changed',
      field: 'priorityId',
      from: String(t.priorityId),
      to: String(priority._id),
    })
  }

  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    await TicketModel.bulkWrite(writes.slice(i, i + BATCH_SIZE))
  }
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    await TicketEventModel.insertMany(events.slice(i, i + BATCH_SIZE))
  }

  console.log('\nNew distribution:')
  for (const slug of Object.keys(WEIGHTS)) {
    console.log(`  ${slug}: ${counts[slug]}`)
  }
  console.log(`\nDone. ${writes.length} tickets changed priority (of ${tickets.length} total).`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
