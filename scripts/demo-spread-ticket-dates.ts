// One-off demo-data helper: spreads createdAt (and resolvedAt, for already-resolved tickets)
// across the last 7 days instead of everything clustering on whatever day the map import / prior
// seed scripts happened to run — so the dashboard's "Ticket volume" chart (created vs. resolved,
// last 7 days) shows a realistic multi-day curve instead of one flat line + a single vertical
// spike on the most recent day. Safe to re-run — reshuffles dates across all non-deleted tickets
// each time.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { dbConnect } from '../src/server/db/connect'
import { TicketModel } from '../src/server/db/models/ticket.model'
import { TicketStatusModel } from '../src/server/db/models/ticket-status.model'

const DAYS = 7
const BATCH_SIZE = 500

// Relative inflow weight per day, oldest -> today: a gentle upward trend (more tickets created
// more recently) rather than a flat/random spread, so the chart reads as organic activity.
const DAY_WEIGHTS = [0.09, 0.11, 0.12, 0.13, 0.15, 0.18, 0.22]

function pickWeightedDayOffset(): number {
  const total = DAY_WEIGHTS.reduce((s, w) => s + w, 0)
  let r = Math.random() * total
  for (let i = 0; i < DAY_WEIGHTS.length; i++) {
    r -= DAY_WEIGHTS[i]
    if (r <= 0) return DAYS - 1 - i // index 0 = oldest day = offset (DAYS - 1)
  }
  return 0
}

// Random time within the given calendar day (local), so points don't all land on midnight.
// For today (daysAgo === 0), clamps to "now" so nothing lands in the future.
function randomTimeOnDay(daysAgo: number): Date {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  startOfDay.setDate(startOfDay.getDate() - daysAgo)

  const maxOffsetMs = daysAgo === 0 ? Date.now() - startOfDay.getTime() : 24 * 60 * 60 * 1000 - 1
  return new Date(startOfDay.getTime() + Math.floor(Math.random() * Math.max(1, maxOffsetMs)))
}

async function main() {
  await dbConnect()

  const resolvedStatusIds = (
    await TicketStatusModel.find({ isResolved: true }).select('_id').lean()
  ).map((s) => s._id)

  const tickets = await TicketModel.find({ deletedAt: null }).select('_id statusId').lean()
  console.log(`Spreading dates for ${tickets.length} tickets across the last ${DAYS} days...`)

  const resolvedIdSet = new Set(resolvedStatusIds.map((id) => String(id)))
  const writes: {
    updateOne: {
      filter: { _id: unknown }
      update: Record<string, unknown>
      overwriteImmutable: boolean
    }
  }[] = []
  const createdCounts = new Array(DAYS).fill(0)
  const resolvedCounts = new Array(DAYS).fill(0)

  for (const t of tickets) {
    const createdOffset = pickWeightedDayOffset()
    const createdAt = randomTimeOnDay(createdOffset)
    createdCounts[DAYS - 1 - createdOffset]++

    const isResolved = resolvedIdSet.has(String(t.statusId))
    const set: Record<string, unknown> = { createdAt }

    if (isResolved) {
      // Resolve sometime between creation and now, biased toward "not too long after creation"
      // (sqrt skews the random pick toward the low end) but never before createdAt and never in
      // the future.
      const msSinceCreated = Date.now() - createdAt.getTime()
      const resolveOffsetMs = Math.floor(Math.sqrt(Math.random()) * msSinceCreated)
      const resolvedAt = new Date(createdAt.getTime() + resolveOffsetMs)
      set.resolvedAt = resolvedAt
      set.lastActivityAt = resolvedAt
      const resolvedDaysAgo = Math.floor(
        (Date.now() - resolvedAt.getTime()) / (24 * 60 * 60 * 1000),
      )
      if (resolvedDaysAgo >= 0 && resolvedDaysAgo < DAYS)
        resolvedCounts[DAYS - 1 - resolvedDaysAgo]++
    } else {
      set.resolvedAt = null
      set.lastActivityAt = createdAt
    }

    // overwriteImmutable: true — by default Mongoose's timestamps option silently strips any
    // user-provided createdAt out of $set on every update (see castBulkWrite.js /
    // applyTimestampsToUpdate.js), specifically to protect createdAt from being overwritten.
    // That's normally correct, but this script's whole point is to deliberately backdate
    // createdAt for demo data. Must be set per-operation (bulkWrite reads updateOne.overwriteImmutable,
    // not a top-level bulkWrite() call option — passing it there is silently ignored).
    writes.push({
      updateOne: { filter: { _id: t._id }, update: { $set: set }, overwriteImmutable: true },
    })
  }

  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    await TicketModel.bulkWrite(writes.slice(i, i + BATCH_SIZE))
  }

  const dayLabels = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (DAYS - 1 - i))
    return d.toISOString().slice(0, 10)
  })

  console.log('\nCreated per day:')
  dayLabels.forEach((label, i) => console.log(`  ${label}: ${createdCounts[i]}`))
  console.log('\nResolved per day (of tickets already marked resolved):')
  dayLabels.forEach((label, i) => console.log(`  ${label}: ${resolvedCounts[i]}`))

  console.log(`\nDone. ${writes.length} tickets updated.`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
