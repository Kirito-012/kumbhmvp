// Re-aligns Mongo tickets with kumbh.sector_plan after a parcel reload (see
// scripts/load-updated-data.ts), then `npx tsx scripts/import-map-tickets.ts` creates tickets for
// parcels that still have none.
//
//   npx tsx scripts/sync-tickets-to-sector-plan.ts --from <table> [--before <ISO date>] [--dry-run]
//
// `--from` is the kumbh table the tickets' `location.sectorPlanId` values were taken from. That is
// NOT necessarily the table that was live just before the reload: the 2026-09-06 gdb reload used
// TRUNCATE ... RESTART IDENTITY, so every Map Parcel ticket (imported from the 3,612-row table now
// kept as sector_plan_backup_20260906) has pointed at a renumbered parcel since then. Check which
// table a ticket set came from by comparing ticket subjects with each table before running this.
// `--before` limits the run to tickets created before that instant (tickets created later already
// carry ids from the current table).
//
// For every ticket in scope, its source parcel is matched by geometry to the current table (both
// parcels covering >= 90% of each other, best match wins, one-to-one):
// - matched: `location.sectorPlanId` and the location snapshot move to the matched parcel; a
//   ticket soft-deleted by an earlier run of this script is restored.
// - unmatched: the snapshot is reset from the source parcel and, for "Map Parcel" tickets, the
//   ticket is soft-deleted (deletedAt + a 'deleted' event by the import bot -- reversible). Tickets
//   of any other type stay live.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { dbConnect } from '../src/server/db/connect'
import { TicketModel } from '../src/server/db/models/ticket.model'
import { TicketEventModel } from '../src/server/db/models/ticket-event.model'
import { TicketTypeModel } from '../src/server/db/models/ticket-type.model'
import { UserModel } from '../src/server/db/models/user.model'
import { getPool } from '../src/server/db/postgres'

const SERVICE_ACCOUNT_EMAIL = 'kumbh-import-bot@thecraftsync.local'
const DELETE_REASON = 'Parcel removed in the 2026-10 sector plan update'

type ParcelRow = {
  id: number
  class_group: string | null
  subclass: string | null
  plot_no: string | null
  block: string | null
  sector_no: number | null
  label: string | null
  area: number | null
  lng: number
  lat: number
}

const snapshot = (p: ParcelRow, sectorPlanId: number) => ({
  'location.sectorPlanId': sectorPlanId,
  'location.sectorNo': p.sector_no,
  'location.classGroup': p.class_group ?? 'Other',
  'location.subclass': p.subclass,
  'location.plotNo': p.plot_no,
  'location.block': p.block,
  'location.label': p.label,
  'location.areaHectares': p.area,
  'location.lng': p.lng,
  'location.lat': p.lat,
})

function arg(name: string) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const from = arg('--from')
  if (!from || !/^sector_plan_backup_\d{8}$/.test(from)) {
    throw new Error('--from <sector_plan_backup_YYYYMMDD> is required')
  }
  const before = new Date(arg('--before') ?? Date.now())

  await dbConnect()
  const pool = getPool()
  const [mapType, bot] = await Promise.all([
    TicketTypeModel.findOne({ slug: 'map-parcel' }).lean(),
    UserModel.findOne({ email: SERVICE_ACCOUNT_EMAIL }).lean(),
  ])
  if (!mapType || !bot)
    throw new Error('Missing map-parcel type or import bot -- run the seed first')

  const parcelSql = (table: string) => `
    SELECT id, class_group, subclass, plot_no, block, sector_no, label, area,
           ST_X(ST_Centroid(geom)) AS lng, ST_Y(ST_Centroid(geom)) AS lat
    FROM kumbh.${table}`
  const [current, source, match] = await Promise.all([
    pool.query<ParcelRow>(parcelSql('sector_plan')),
    pool.query<ParcelRow>(parcelSql(from)),
    pool.query<{ src_id: number; new_id: number }>(`
      WITH cand AS (
        SELECT s.id AS src_id, n.id AS new_id,
               ST_Area(ST_Intersection(s.geom, n.geom)::geography) AS inter,
               ST_Area(s.geom::geography) AS sa, ST_Area(n.geom::geography) AS na
        FROM kumbh.${from} s JOIN kumbh.sector_plan n ON s.geom && n.geom AND ST_Intersects(s.geom, n.geom)
      ), good AS (
        SELECT src_id, new_id, inter / GREATEST(sa, na) AS score FROM cand
        WHERE sa > 0 AND na > 0 AND inter / sa >= 0.9 AND inter / na >= 0.9
      ), ranked AS (
        SELECT src_id, new_id,
               row_number() OVER (PARTITION BY new_id ORDER BY score DESC) AS r_new,
               row_number() OVER (PARTITION BY src_id ORDER BY score DESC) AS r_src
        FROM good
      )
      SELECT src_id, new_id FROM ranked WHERE r_new = 1 AND r_src = 1`),
  ])
  const currentById = new Map(current.rows.map((r) => [r.id, r]))
  const sourceById = new Map(source.rows.map((r) => [r.id, r]))
  const newIdFor = new Map(match.rows.map((r) => [r.src_id, r.new_id]))

  const tickets = await TicketModel.find(
    { 'location.sectorPlanId': { $ne: null }, createdAt: { $lt: before } },
    { _id: 1, number: 1, typeId: 1, deletedAt: 1, location: 1 },
  ).lean()

  // Tickets this script itself soft-deleted earlier (identified by the event it wrote) may be
  // restored; tickets deleted by a person are never touched.
  const ourDeletes = new Set(
    (
      await TicketEventModel.find(
        { action: 'deleted', 'meta.reason': DELETE_REASON },
        { ticketId: 1 },
      ).lean()
    ).map((e) => String(e.ticketId)),
  )

  const ops: Parameters<typeof TicketModel.bulkWrite>[0] = []
  const events: Record<string, unknown>[] = []
  const stats = {
    remapped: 0,
    restored: 0,
    softDeleted: 0,
    unmatchedKeptLive: 0,
    skippedDeletedByUser: 0,
    sourceMissing: 0,
  }
  const now = new Date()

  for (const t of tickets) {
    const srcId = t.location!.sectorPlanId as number
    const deletedByUs = t.deletedAt != null && ourDeletes.has(String(t._id))
    if (t.deletedAt != null && !deletedByUs) {
      stats.skippedDeletedByUser++
      continue
    }
    const src = sourceById.get(srcId)
    if (!src) {
      stats.sourceMissing++
      continue
    }
    const newId = newIdFor.get(srcId)
    if (newId != null) {
      const $set: Record<string, unknown> = snapshot(currentById.get(newId)!, newId)
      if (deletedByUs) {
        $set.deletedAt = null
        events.push({ ticketId: t._id, actorId: bot._id, action: 'restored' })
        stats.restored++
      }
      ops.push({ updateOne: { filter: { _id: t._id }, update: { $set } } })
      stats.remapped++
    } else {
      const $set: Record<string, unknown> = snapshot(src, srcId)
      if (String(t.typeId) === String(mapType._id)) {
        if (!t.deletedAt) {
          $set.deletedAt = now
          events.push({
            ticketId: t._id,
            actorId: bot._id,
            action: 'deleted',
            meta: { reason: DELETE_REASON },
          })
        }
        stats.softDeleted++
      } else stats.unmatchedKeptLive++
      ops.push({ updateOne: { filter: { _id: t._id }, update: { $set } } })
    }
  }

  console.log(
    `source ${from}: ${source.rows.length} parcels, ${match.rows.length} matched to the current ${current.rows.length}`,
  )
  console.log(`tickets in scope: ${tickets.length}`, stats)
  if (!dryRun) {
    if (ops.length) await TicketModel.bulkWrite(ops)
    if (events.length) await TicketEventModel.insertMany(events)
    console.log(`written: ${ops.length} ticket updates, ${events.length} events`)
  }
  await pool.end()
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
