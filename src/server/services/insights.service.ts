import 'server-only'

import { dbConnect } from '@/server/db/connect'
import { getPriorities, getStatuses } from '@/server/services/lookups'
import { TicketModel } from '@/server/db/models/ticket.model'
import { TicketStatusModel } from '@/server/db/models/ticket-status.model'
import { TicketPriorityModel } from '@/server/db/models/ticket-priority.model'
import { UserModel } from '@/server/db/models/user.model'
import { bucketForStatus } from '@/lib/insights/statusBuckets'
import type {
  InsightsStatusRow,
  InsightsPriorityRow,
  InsightsTicketTuple,
  InsightsTicketData,
  SectorTrendDay,
  SectorAssignee,
  SectorTicketRow,
  SectorInsights,
} from '@/lib/insights/types'

// Every ticket carries a location snapshot in practice (bulk-imported one-per-parcel — see
// scripts/import-map-tickets.ts) but the schema allows a null location, so every query here
// still filters it out explicitly rather than assuming it.
const HAS_LOCATION = { location: { $ne: null } }

// Re-exported so existing importers of these types from this module keep working -- the
// canonical definitions now live in lib/insights/types.ts (a plain, client-safe module) since
// aggregate.ts/useTicketInsights.ts need them too and this file is 'server-only'.
export type {
  InsightsStatusRow,
  InsightsPriorityRow,
  InsightsTicketTuple,
  InsightsTicketData,
  SectorTrendDay,
  SectorAssignee,
  SectorTicketRow,
  SectorInsights,
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
    getStatuses(),
    getPriorities(),
    TicketModel.find(
      { deletedAt: null, ...HAS_LOCATION },
      {
        number: 1,
        statusId: 1,
        priorityId: 1,
        'location.sectorPlanId': 1,
        'location.sectorNo': 1,
        'location.classGroup': 1,
        'location.subclass': 1,
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

  // Sub-classes are indexed the same way as class groups (first-seen order, no null slot) --
  // a ticket with no sub-class on its location just stores -1 in the tuple (see indexOfSubclass
  // below and TicketField.SubclassIdx).
  const subclasses: string[] = []
  const subclassIndex = new Map<string, number>()
  function indexOfSubclass(name: string): number {
    let idx = subclassIndex.get(name)
    if (idx === undefined) {
      idx = subclasses.length
      subclasses.push(name)
      subclassIndex.set(name, idx)
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
        loc.subclass ? indexOfSubclass(loc.subclass) : -1,
      ]
    })

  return {
    generatedAt: new Date().toISOString(),
    statuses,
    priorities,
    classGroups,
    subclasses,
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

const SECTOR_TICKET_LIST_CAP = 200

/**
 * Per-sector detail for the Insights panel — everything that ISN'T already derivable client-side
 * from the bulk tuple array in getInsightsTicketData() (trend, assignees, oldest-open, median
 * resolve time, and the actual ticket rows for the list).
 *
 * `target` is an integer sector number, `'peripheral'` for parcels with no numbered sector (see
 * location.sectorNo), or `'all'` for the unfiltered workspace overview the Insights panel shows
 * with no sector selected (PLAN-heatmap.md §6.2) — added in Phase 5 alongside the panel that
 * actually needs it; the bulk tuple array covers the overview's status/category/priority
 * breakdowns client-side already, but trend/assignees/oldest-open/median-resolve/the ticket list
 * all require a DB round-trip regardless of scope, so "all" just runs the same aggregation with
 * no sectorNo match clause rather than needing a second, parallel code path.
 */
export async function getSectorInsights(
  target: number | 'peripheral' | 'all',
): Promise<SectorInsights> {
  await dbConnect()

  const sectorNo = target === 'peripheral' ? null : target === 'all' ? undefined : target
  const baseMatch = {
    deletedAt: null,
    ...HAS_LOCATION,
    ...(sectorNo === undefined ? {} : { 'location.sectorNo': sectorNo }),
  }

  // Every status and priority, not just the resolved statuses: the ticket-list query below needs
  // each one's slug (for the row shape) and each priority's `order` (for the sort), and these two
  // lookup tables are a handful of documents each. Fetching them here is what lets that query sort
  // and page in Mongo instead of pulling every matching ticket into Node -- see below.
  const [statusDocs, priorityDocs] = await Promise.all([
    TicketStatusModel.find().select('_id slug isResolved').lean(),
    TicketPriorityModel.find().select('_id slug order').lean(),
  ])
  const resolvedIds = statusDocs.filter((st) => st.isResolved).map((st) => st._id)
  const statusById = new Map(statusDocs.map((st) => [String(st._id), st]))
  const priorityById = new Map(priorityDocs.map((pr) => [String(pr._id), pr]))

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
      // Median resolve time, computed entirely in the pipeline and returned as a single document.
      // This used to be `TicketModel.find(...).select('createdAt resolvedAt')` -- every resolved
      // ticket streamed to Node, two timestamps each, then subtracted and sorted there. For
      // `target === 'all'` (the state the Insights panel opens in) that is every resolved ticket in
      // the workspace, not the "busiest sector is ~700" case the original comment assumed.
      //
      // $percentile would express this directly but needs MongoDB 7.0, newer than the rest of this
      // pipeline assumes -- hence the explicit array arithmetic, which is the same mid-element (or
      // mean of the two middle elements) definition the Node code used, so the number is unchanged.
      // $sort before $group is the standard idiom for an ordered $push, and `all` is a few thousand
      // doubles at most -- nowhere near the 16 MB document limit.
      TicketModel.aggregate<{ median: number | null }>([
        { $match: { ...baseMatch, statusId: { $in: resolvedIds }, resolvedAt: { $ne: null } } },
        {
          $project: {
            _id: 0,
            h: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 3_600_000] },
          },
        },
        { $sort: { h: 1 } },
        { $group: { _id: null, all: { $push: '$h' }, n: { $sum: 1 } } },
        {
          $project: {
            _id: 0,
            median: {
              $cond: [
                { $eq: [{ $mod: ['$n', 2] }, 0] },
                {
                  $avg: [
                    { $arrayElemAt: ['$all', { $subtract: [{ $divide: ['$n', 2] }, 1] }] },
                    { $arrayElemAt: ['$all', { $divide: ['$n', 2] }] },
                  ],
                },
                { $arrayElemAt: ['$all', { $floor: { $divide: ['$n', 2] } }] },
              ],
            },
          },
        },
      ]),
      // Open first, then by priority order (highest first), then most recently active -- the triage
      // order the panel's list is defined by (an admin reads unresolved work before history, urgent
      // before routine). This used to be `TicketModel.find(baseMatch)` with two $populates, sorted
      // in Node and sliced to SECTOR_TICKET_LIST_CAP afterwards: for `target === 'all'` -- which is
      // the state the Insights panel *opens* in (useSectorInsights maps a null sector to 'all') --
      // that materialised every ticket in the workspace, each with a joined status and priority
      // document, to return 200 rows.
      //
      // The sort is reproduced exactly in the pipeline: `isOpen` mirrors `!statusId.isResolved` with
      // the same "a ticket whose status is missing counts as open" fallback the Node comparator had
      // (a statusId matching no status document falls through $switch to 1), and `priorityOrder`
      // mirrors `priorityId?.order ?? 0`. LIST_CAP + 1 rather than LIST_CAP so `truncated` below is
      // still derivable without a second count.
      TicketModel.aggregate([
        { $match: baseMatch },
        {
          $addFields: {
            isOpen: { $cond: [{ $in: ['$statusId', resolvedIds] }, 0, 1] },
            priorityOrder: {
              $switch: {
                branches: priorityDocs.map((pr) => ({
                  case: { $eq: ['$priorityId', pr._id] },
                  then: pr.order,
                })),
                default: 0,
              },
            },
          },
        },
        { $sort: { isOpen: -1, priorityOrder: -1, lastActivityAt: -1 } },
        { $limit: SECTOR_TICKET_LIST_CAP + 1 },
        {
          $project: {
            _id: 0,
            number: 1,
            subject: 1,
            lastActivityAt: 1,
            statusId: 1,
            priorityId: 1,
            'location.sectorPlanId': 1,
            'location.classGroup': 1,
            'location.subclass': 1,
            'location.lng': 1,
            'location.lat': 1,
          },
        },
      ]),
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

  // One row, or none at all when the scope has no resolved tickets (the $group is skipped on an
  // empty input rather than emitting a null-valued document).
  const medianResolveHours = resolvedDurations[0]?.median ?? null

  // Already in triage order and already capped by the pipeline above. The status/priority slugs are
  // looked up from the lookup-table maps rather than a $populate, which is what makes that possible.
  type TicketRowDoc = {
    number: number
    subject: string
    lastActivityAt: Date
    statusId: unknown
    priorityId: unknown
    location?: {
      sectorPlanId: number
      classGroup?: string | null
      subclass?: string | null
      lng: number
      lat: number
    }
  }
  const ticketRows = ticketDocs as TicketRowDoc[]
  const tickets: SectorTicketRow[] = ticketRows.slice(0, SECTOR_TICKET_LIST_CAP).map((t) => ({
    number: t.number,
    subject: t.subject,
    statusSlug: statusById.get(String(t.statusId))?.slug ?? 'unknown',
    prioritySlug: priorityById.get(String(t.priorityId))?.slug ?? 'unknown',
    classGroup: t.location?.classGroup ?? 'Other',
    subclass: t.location?.subclass ?? null,
    sectorPlanId: t.location!.sectorPlanId,
    lng: t.location!.lng,
    lat: t.location!.lat,
    lastActivityAt: new Date(t.lastActivityAt).toISOString(),
  }))

  return {
    sectorNo: sectorNo ?? null,
    totalCount,
    trend7d,
    assignees,
    oldestOpen,
    medianResolveHours,
    tickets,
    truncated: ticketRows.length > SECTOR_TICKET_LIST_CAP,
  }
}
