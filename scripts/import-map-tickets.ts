// One-off bulk import: creates one TCSticket ticket per kumbh.sector_plan parcel (Postgres),
// so the 3,600+ map blocks become the ticketing system's master worklist. Safe to re-run —
// skips parcels that already have a ticket (matched by location.sectorPlanId).
import { config } from 'dotenv'
config({ path: '.env.local' })

import { dbConnect } from '../src/server/db/connect'
import { TicketModel } from '../src/server/db/models/ticket.model'
import { TicketEventModel } from '../src/server/db/models/ticket-event.model'
import { TicketStatusModel } from '../src/server/db/models/ticket-status.model'
import { TicketTypeModel } from '../src/server/db/models/ticket-type.model'
import { TicketPriorityModel } from '../src/server/db/models/ticket-priority.model'
import { UserModel } from '../src/server/db/models/user.model'
import { nextSequence } from '../src/server/db/models/counter.model'
import { getPool } from '../src/server/db/postgres'
import { sanitizeHtml } from '../src/lib/sanitize-html'

// Not importing src/server/services/ticket.service.ts here: it starts with `import 'server-only'`,
// which throws outside a Next.js server-component build (i.e. when run directly via tsx). This
// script instead does the same steps createTicket() does, directly against the models — the
// same approach scripts/seed.ts already uses for its own model access.

const TYPE_SLUG = 'map-parcel'
const PRIORITY_SLUG = 'normal'
const SERVICE_ACCOUNT_EMAIL = 'kumbh-import-bot@thecraftsync.local'
const CONCURRENCY = 10

type ParcelRow = {
  id: number
  class: string | null
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

function buildSubject(row: ParcelRow) {
  const cls = row.class_group ?? 'Parcel'
  const sector = row.sector_no !== null ? `Sector ${row.sector_no}` : 'Peripheral'
  const ref = row.plot_no ?? row.label ?? `#${row.id}`
  return `${cls} — ${sector} · Plot ${ref}`
}

function buildIssueHtml(row: ParcelRow) {
  const rows: [string, string][] = [
    ['Class', row.class ?? '—'],
    ['Subclass', row.subclass ?? '—'],
    ['Sector', row.sector_no !== null ? String(row.sector_no) : 'Peripheral'],
    ['Block', row.block ?? '—'],
    ['Plot no.', row.plot_no ?? '—'],
    ['Area (ha)', row.area !== null ? row.area.toFixed(3) : '—'],
  ]
  const items = rows.map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`).join('')
  return `<p>Auto-generated from map parcel #${row.id}.</p><ul>${items}</ul>`
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

async function main() {
  await dbConnect()
  const pool = getPool()

  const [type, priority, reporter, status] = await Promise.all([
    TicketTypeModel.findOne({ slug: TYPE_SLUG }).lean(),
    TicketPriorityModel.findOne({ slug: PRIORITY_SLUG }).lean(),
    UserModel.findOne({ email: SERVICE_ACCOUNT_EMAIL, isActive: true }).lean(),
    TicketStatusModel.findOne({ isDefault: true }).lean(),
  ])

  if (!type || !priority || !reporter || !status) {
    console.error(
      { type: !!type, priority: !!priority, reporter: !!reporter, status: !!status },
      'Missing seed data — run `pnpm seed` first (needs the map-parcel type, kumbh-import-bot account, and a default status).',
    )
    process.exit(1)
  }

  console.log('Fetching parcels from Postgres...')
  const { rows } = await pool.query<ParcelRow>(`
    SELECT id, class, class_group, subclass, plot_no, block, sector_no, label, area,
           ST_X(ST_Centroid(geom)) AS lng, ST_Y(ST_Centroid(geom)) AS lat
    FROM kumbh.sector_plan
    ORDER BY id;
  `)
  console.log(`Fetched ${rows.length} parcels.`)

  const existing = await TicketModel.find(
    { 'location.sectorPlanId': { $in: rows.map((r) => r.id) } },
    { 'location.sectorPlanId': 1 },
  ).lean()
  const existingIds = new Set(existing.map((t) => t.location?.sectorPlanId))

  const toImport = rows.filter((r) => !existingIds.has(r.id))
  console.log(`${existingIds.size} already imported, ${toImport.length} to create.`)

  let created = 0
  await inBatches(toImport, CONCURRENCY, async (row) => {
    const number = await nextSequence('tickets')
    const ticket = await TicketModel.create({
      number,
      subject: buildSubject(row),
      issue: sanitizeHtml(buildIssueHtml(row)),
      ownerId: reporter._id,
      typeId: type._id,
      priorityId: priority._id,
      statusId: status._id,
      source: 'api',
      location: {
        sectorPlanId: row.id,
        sectorNo: row.sector_no,
        classGroup: row.class_group ?? 'Other',
        subclass: row.subclass,
        plotNo: row.plot_no,
        block: row.block,
        label: row.label,
        areaHectares: row.area,
        lng: row.lng,
        lat: row.lat,
      },
      lastActivityAt: new Date(),
    })

    await TicketEventModel.create({
      ticketId: ticket._id,
      actorId: reporter._id,
      action: 'created',
    })

    created++
    if (created % 200 === 0) console.log(`  ...${created}/${toImport.length}`)
  })

  console.log(
    `\nDone. Created: ${created}, skipped (already imported): ${existingIds.size}, total parcels: ${rows.length}.`,
  )
  await pool.end()
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
