import 'server-only'

import { dbConnect } from '@/server/db/connect'
import { TicketModel } from '@/server/db/models/ticket.model'
import { TicketStatusModel } from '@/server/db/models/ticket-status.model'
import { TicketPriorityModel } from '@/server/db/models/ticket-priority.model'
import { UserModel } from '@/server/db/models/user.model'
import { bucketForStatus } from '@/lib/insights/statusBuckets'

// Every ticket carries a location snapshot in practice (bulk-imported one-per-parcel — see
// scripts/import-map-tickets.ts) but the schema allows a null location, so every query here
// still filters it out explicitly rather than assuming it.
const HAS_LOCATION = { location: { $ne: null } }

/** One row per status/priority the client indexes into by position — keeps the per-ticket
 *  tuples in getInsightsTicketData() to small integers instead of repeating ids/strings
 *  ~3.6k times over the wire. */
export type InsightsStatusRow = {
  slug: string
  name: string
  bucket: ReturnType<typeof bucketForStatus>
  color: string
}
export type InsightsPriorityRow = { slug: string; name: string; color: string; order: number }

export type InsightsTicketTuple = [
  number, // ticket number
  number, // location.sectorPlanId
  number | null, // location.sectorNo
  number, // index into `statuses`
  number, // index into `priorities`
  number, // index into `classGroups`
  number, // location.lng
  number, // location.lat
  number, // createdAt (ms since epoch)
  number | null, // resolvedAt (ms since epoch), null if still unresolved
]

export type InsightsTicketData = {
  generatedAt: string
  statuses: InsightsStatusRow[]
  priorities: InsightsPriorityRow[]
  classGroups: string[]
  tickets: InsightsTicketTuple[]
}

/**
 * Everything Heatmap/Ticket mode need to render and filter client-side, in one payload: every
 * status/priority (small, indexed) plus a compact tuple per located ticket (~3.6k rows). Loaded
 * once per mode-entry — filters, the heat metric, and recolouring all then run against this
 * array in the browser rather than round-tripping to the server (see PLAN-heatmap.md §3.3).
 */
export async function getInsightsTicketData(): Promise<InsightsTicketData> {
  await dbConnect()

  const [statusDocs, priorityDocs, tickets] = await Promise.all([
    TicketStatusModel.find().sort({ order: 1 }).lean(),
    TicketPriorityModel.find().sort({ order: 1 }).lean(),
    TicketModel.find(
      { deletedAt: null, ...HAS_LOCATION },
      {
        number: 1,
        statusId: 1,
        priorityId: 1,
        'location.sectorPlanId': 1,
        'location.sectorNo': 1,
        'location.classGroup': 1,
        'location.lng': 1,
        'location.lat': 1,
        createdAt: 1,
        resolvedAt: 1,
      },
    ).lean(),
  ])

  const statuses: InsightsStatusRow[] = statusDocs.map((s) => ({
    slug: s.slug,
    name: s.name,
    bucket: bucketForStatus(s),
    color: s.color,
  }))
  const priorities: InsightsPriorityRow[] = priorityDocs.map((p) => ({
    slug: p.slug,
    name: p.name,
    color: p.color,
    order: p.order,
  }))

  const statusIndexById = new Map(statusDocs.map((s, i) => [String(s._id), i]))
  const priorityIndexById = new Map(priorityDocs.map((p, i) => [String(p._id), i]))

  // Class groups are indexed in encounter order (first-seen), not CLASS_GROUP_COLORS's full ~25
  // entries — a class with zero tickets doesn't need a slot, and the client already resolves the
  // colour for a class name via the same CLASS_GROUP_COLORS map, so no colour needs shipping here.
  const classGroups: string[] = []
  const classGroupIndex = new Map<string, number>()
  function indexOfClassGroup(name: string): number {
    let idx = classGroupIndex.get(name)
    if (idx === undefined) {
      idx = classGroups.length
      classGroups.push(name)
      classGroupIndex.set(name, idx)
    }
    return idx
  }

  const ticketTuples: InsightsTicketTuple[] = tickets
    .filter((t) => t.location) // narrows for TS; HAS_LOCATION already guarantees this at the DB level
    .map((t) => {
      const loc = t.location!
      return [
        t.number,
        loc.sectorPlanId,
        loc.sectorNo ?? null,
        statusIndexById.get(String(t.statusId)) ?? -1,
        priorityIndexById.get(String(t.priorityId)) ?? -1,
        indexOfClassGroup(loc.classGroup ?? 'Other'),
        loc.lng,
        loc.lat,
        t.createdAt ? new Date(t.createdAt).getTime() : 0,
        t.resolvedAt ? new Date(t.resolvedAt).getTime() : null,
      ]
    })

  return {
    generatedAt: new Date().toISOString(),
    statuses,
    priorities,
    classGroups,
    tickets: ticketTuples,
  }
}

// ---------------------------------------------------------------------------------------------

/** Local-calendar-day bucketing, mirroring getDashboardData()'s tzOffset math in
 *  ticket.service.ts — kept as a small local copy rather than a shared export since it's the
 *  only place both call sites need it and the two call sites otherwise have nothing in common. */
function localDateToStringTimezone(): string {
  const tzOffsetMinutes = -new Date().getTimezoneOffset()
  const sign = tzOffsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(tzOffsetMinutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}
function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type SectorTrendDay = { day: string; created: number; resolved: number }
export type SectorAssignee = { id: string; name: string; open: number }
export type SectorTicketRow = {
  number: number
  subject: string
  statusSlug: string
  prioritySlug: string
  classGroup: string
  sectorPlanId: number
  lng: number
  lat: number
  lastActivityAt: string
}

export type SectorInsights = {
  sectorNo: number | null // null for the "peripheral" bucket
  totalCount: number
  trend7d: SectorTrendDay[]
  assignees: SectorAssignee[]
  oldestOpen: { number: number; subject: string; ageDays: number } | null
  medianResolveHours: number | null
  tickets: SectorTicketRow[]
  truncated: boolean
}

const SECTOR_TICKET_LIST_CAP = 200

/**
 * Per-sector detail for the Insights panel — everything that ISN'T already derivable client-side
 * from the bulk tuple array in getInsightsTicketData() (trend, assignees, oldest-open, median
 * resolve time, and the actual ticket rows for the list). Pass `sectorNo: null` for the
 * "Peripheral" bucket (parcels with no numbered sector — see location.sectorNo).
 */
export async function getSectorInsights(sectorNo: number | null): Promise<SectorInsights> {
  await dbConnect()

  const baseMatch = { deletedAt: null, ...HAS_LOCATION, 'location.sectorNo': sectorNo }

  const resolvedStatusDocs = await TicketStatusModel.find({ isResolved: true }).select('_id').lean()
  const resolvedIds = resolvedStatusDocs.map((s) => s._id)

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const sevenDaysAgo = new Date(startOfToday)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  const tz = localDateToStringTimezone()

  const [totalCount, trendFacet, assigneeRows, oldestOpenDoc, resolvedDurations, ticketDocs] =
    await Promise.all([
      TicketModel.countDocuments(baseMatch),
      TicketModel.aggregate([
        {
          $facet: {
            created: [
              { $match: { ...baseMatch, createdAt: { $gte: sevenDaysAgo } } },
              {
                $group: {
                  _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } },
                  n: { $sum: 1 },
                },
              },
            ],
            resolved: [
              { $match: { ...baseMatch, resolvedAt: { $gte: sevenDaysAgo } } },
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$resolvedAt', timezone: tz },
                  },
                  n: { $sum: 1 },
                },
              },
            ],
          },
        },
      ]),
      TicketModel.aggregate([
        { $match: { ...baseMatch, statusId: { $nin: resolvedIds }, assigneeId: { $ne: null } } },
        { $group: { _id: '$assigneeId', open: { $sum: 1 } } },
        { $sort: { open: -1 } },
        { $limit: 5 },
      ]),
      TicketModel.findOne({ ...baseMatch, statusId: { $nin: resolvedIds } })
        .sort({ createdAt: 1 })
        .select('number subject createdAt')
        .lean(),
      // Small enough per sector (busiest sector is ~700 tickets total, fewer resolved) to pull
      // both timestamps and compute the median in Node — Mongo's $percentile needs a newer
      // server version than this deployment's aggregation pipeline otherwise relies on.
      TicketModel.find({ ...baseMatch, statusId: { $in: resolvedIds }, resolvedAt: { $ne: null } })
        .select('createdAt resolvedAt')
        .lean(),
      TicketModel.find(baseMatch)
        .select(
          'number subject lastActivityAt location.sectorPlanId location.classGroup location.lng location.lat',
        )
        .populate([
          { path: 'statusId', select: 'slug isResolved' },
          { path: 'priorityId', select: 'slug order' },
        ])
        .lean(),
    ])

  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo)
    d.setDate(d.getDate() + i)
    days.push(toLocalISODate(d))
  }
  const createdByDay = new Map<string, number>(
    (trendFacet[0]?.created ?? []).map((r: { _id: string; n: number }) => [r._id, r.n]),
  )
  const resolvedByDay = new Map<string, number>(
    (trendFacet[0]?.resolved ?? []).map((r: { _id: string; n: number }) => [r._id, r.n]),
  )
  const dayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
  const trend7d: SectorTrendDay[] = days.map((iso) => ({
    day: dayLabel.format(new Date(iso + 'T00:00:00')),
    created: createdByDay.get(iso) ?? 0,
    resolved: resolvedByDay.get(iso) ?? 0,
  }))

  const assigneeUserIds = assigneeRows.map((r) => r._id)
  const assigneeUsers = await UserModel.find({ _id: { $in: assigneeUserIds } })
    .select('fullname')
    .lean()
  const nameById = new Map(assigneeUsers.map((u) => [String(u._id), u.fullname]))
  const assignees: SectorAssignee[] = assigneeRows.map((r) => ({
    id: String(r._id),
    name: nameById.get(String(r._id)) ?? 'Unknown',
    open: r.open as number,
  }))

  const oldestOpen = oldestOpenDoc
    ? {
        number: oldestOpenDoc.number,
        subject: oldestOpenDoc.subject,
        ageDays: Math.floor(
          (Date.now() - new Date(oldestOpenDoc.createdAt).getTime()) / 86_400_000,
        ),
      }
    : null

  let medianResolveHours: number | null = null
  if (resolvedDurations.length > 0) {
    const hours = resolvedDurations
      .map((t) => (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) / 3_600_000)
      .sort((a, b) => a - b)
    const mid = Math.floor(hours.length / 2)
    medianResolveHours = hours.length % 2 === 0 ? (hours[mid - 1] + hours[mid]) / 2 : hours[mid]
  }

  // Open first, then by priority order (highest first), then most recently active — mirrors how
  // an admin would triage a sector: unresolved work before history, urgent before routine.
  type TicketDoc = (typeof ticketDocs)[number] & {
    statusId: { slug: string; isResolved: boolean } | null
    priorityId: { slug: string; order: number } | null
  }
  const sorted = (ticketDocs as unknown as TicketDoc[]).sort((a, b) => {
    const aOpen = a.statusId ? !a.statusId.isResolved : true
    const bOpen = b.statusId ? !b.statusId.isResolved : true
    if (aOpen !== bOpen) return aOpen ? -1 : 1
    const aOrder = a.priorityId?.order ?? 0
    const bOrder = b.priorityId?.order ?? 0
    if (aOrder !== bOrder) return bOrder - aOrder
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  })

  const tickets: SectorTicketRow[] = sorted.slice(0, SECTOR_TICKET_LIST_CAP).map((t) => ({
    number: t.number,
    subject: t.subject,
    statusSlug: t.statusId?.slug ?? 'unknown',
    prioritySlug: t.priorityId?.slug ?? 'unknown',
    classGroup: t.location?.classGroup ?? 'Other',
    sectorPlanId: t.location!.sectorPlanId,
    lng: t.location!.lng,
    lat: t.location!.lat,
    lastActivityAt: new Date(t.lastActivityAt).toISOString(),
  }))

  return {
    sectorNo,
    totalCount,
    trend7d,
    assignees,
    oldestOpen,
    medianResolveHours,
    tickets,
    truncated: sorted.length > SECTOR_TICKET_LIST_CAP,
  }
}
