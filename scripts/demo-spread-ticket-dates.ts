// One-off demo-data helper: spreads createdAt (and resolvedAt, for already-resolved tickets)
// across the last 7 days instead of everything clustering on whatever day the map import / prior
// seed scripts happened to run — so the dashboard's "Ticket volume" chart (created vs. resolved,
// last 7 days) shows a realistic multi-day curve instead of one flat line + a single vertical
// spike on the most recent day. Safe to re-run — reshuffles dates across all non-deleted tickets
// each time. Pass --dry-run to preview the per-day counts without writing.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { dbConnect } from '../src/server/db/connect'
import { TicketModel } from '../src/server/db/models/ticket.model'
import { TicketStatusModel } from '../src/server/db/models/ticket-status.model'

const DAYS = 7
const BATCH_SIZE = 500

// Relative weight per day, oldest -> today. Deliberately uneven, and different for the two series
// (a busy mid-week and a Friday-style peak for creation; resolution that surges a day later), so
// the lines wobble and cross like real activity rather than ramping in parallel. The last entry
// is low because today is only part-way through when the script runs.
const CREATED_WEIGHTS = [0.1, 0.13, 0.17, 0.12, 0.19, 0.17, 0.12]
const RESOLVED_WEIGHTS = [0.12, 0.16, 0.11, 0.2, 0.16, 0.15, 0.1]

// Time from creation to resolution: exponential, so most tickets close within about a day and a
// few drag on. Resolved tickets are placed by their resolution day and created backwards from
// there, which means some were created before the 7-day window -- real backlog being worked
// down, and it keeps the first day's resolved count from starting at zero.
const MEAN_RESOLVE_LAG_MS = 20 * 60 * 60 * 1000
const MIN_RESOLVE_LAG_MS = 30 * 60 * 1000
const MAX_RESOLVE_LAG_MS = 5 * 24 * 60 * 60 * 1000

// `--dry-run` prints the per-day tables without writing anything.
const DRY_RUN = process.argv.includes('--dry-run')

function pickWeightedDayOffset(weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return DAYS - 1 - i // index 0 = oldest day = offset (DAYS - 1)
  }
  return 0
}

/** Whole local calendar days between `d` and today (0 = today), matching the chart's buckets. */
function calendarDaysAgo(d: Date): number {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfThatDay = new Date(d)
  startOfThatDay.setHours(0, 0, 0, 0)
  return Math.round((startOfToday.getTime() - startOfThatDay.getTime()) / (24 * 60 * 60 * 1000))
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
    const isResolved = resolvedIdSet.has(String(t.statusId))
    let createdAt: Date
    const set: Record<string, unknown> = {}

    if (isResolved) {
      // Pick the resolution moment first, then work backwards to when it was created.
      const resolvedAt = randomTimeOnDay(pickWeightedDayOffset(RESOLVED_WEIGHTS))
      const lagMs = Math.min(
        MAX_RESOLVE_LAG_MS,
        MIN_RESOLVE_LAG_MS - Math.log(1 - Math.random()) * MEAN_RESOLVE_LAG_MS,
      )
      createdAt = new Date(resolvedAt.getTime() - lagMs)
      set.resolvedAt = resolvedAt
      set.lastActivityAt = resolvedAt
      resolvedCounts[DAYS - 1 - calendarDaysAgo(resolvedAt)]++
    } else {
      createdAt = randomTimeOnDay(pickWeightedDayOffset(CREATED_WEIGHTS))
      set.resolvedAt = null
      set.lastActivityAt = createdAt
    }
    set.createdAt = createdAt
    const createdDaysAgo = calendarDaysAgo(createdAt)
    if (createdDaysAgo < DAYS) createdCounts[DAYS - 1 - createdDaysAgo]++

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

  if (!DRY_RUN) {
    for (let i = 0; i < writes.length; i += BATCH_SIZE) {
      await TicketModel.bulkWrite(writes.slice(i, i + BATCH_SIZE))
    }
  }

  const dayLabels = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (DAYS - 1 - i))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  console.log('\nCreated per day:')
  dayLabels.forEach((label, i) => console.log(`  ${label}: ${createdCounts[i]}`))
  console.log('\nResolved per day (of tickets already marked resolved):')
  dayLabels.forEach((label, i) => console.log(`  ${label}: ${resolvedCounts[i]}`))

  console.log(
    DRY_RUN
      ? `\nDry run: ${writes.length} tickets would be updated; nothing was written.`
      : `\nDone. ${writes.length} tickets updated.`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
