import 'server-only'

import { QueryFilter, Types } from 'mongoose'
import { dbConnect } from '@/server/db/connect'
import { TicketModel, type Ticket } from '@/server/db/models/ticket.model'
import { TicketCommentModel } from '@/server/db/models/ticket-comment.model'
import { TicketEventModel } from '@/server/db/models/ticket-event.model'
import { TicketStatusModel } from '@/server/db/models/ticket-status.model'
import { TicketPriorityModel } from '@/server/db/models/ticket-priority.model'
import { TicketTypeModel } from '@/server/db/models/ticket-type.model'
import { TagModel } from '@/server/db/models/tag.model'
import { UserModel } from '@/server/db/models/user.model'
import { nextSequence } from '@/server/db/models/counter.model'
import { CLASS_GROUP_COLORS } from '@/lib/classColors'

const POPULATE = [
  { path: 'ownerId', select: 'fullname email avatarUrl' },
  { path: 'assigneeId', select: 'fullname email avatarUrl' },
  { path: 'typeId', select: 'name slug' },
  { path: 'statusId', select: 'name slug color isResolved' },
  { path: 'priorityId', select: 'name slug color' },
  { path: 'tagIds', select: 'name slug color' },
]

export type ListTicketsParams = {
  /** A status slug (new/open/pending/resolved/closed), or the sentinel 'open' — see below —
   *  handled the same way as any other slug won't work since "open" isn't itself a status row;
   *  it's expressed as "not a resolved status" instead. */
  status?: string
  priority?: string
  type?: string
  /** A user id, or the sentinel 'unassigned' to match tickets with no assignee. */
  assigneeId?: string
  tag?: string
  q?: string
  from?: string
  to?: string
  /** Matches `location.classGroup` — set on tickets bulk-imported from a map parcel. */
  classGroup?: string
  /** Matches `location.sectorNo` — set on tickets bulk-imported from a map parcel. */
  sectorNo?: number
  page?: number
  pageSize?: number
  sortField?: 'lastActivityAt' | 'createdAt' | 'number'
  sortDir?: 'asc' | 'desc'
}

export async function listTickets(params: ListTicketsParams) {
  await dbConnect()

  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))

  const filter: QueryFilter<Ticket> = { deletedAt: null }

  // 'open' isn't a real TicketStatus row (it's "new" + "open" + "pending" — anything not
  // resolved/closed) so it's resolved against isResolved rather than looked up by slug, matching
  // the dashboard's own "Open tickets" stat (see getDashboardData()'s openMatch).
  const isOpenSentinel = params.status === 'open'

  const [status, resolvedIds, priority, type, tag] = await Promise.all([
    params.status && !isOpenSentinel
      ? TicketStatusModel.findOne({ slug: params.status }).lean()
      : null,
    isOpenSentinel ? TicketStatusModel.find({ isResolved: true }).select('_id').lean() : null,
    params.priority ? TicketPriorityModel.findOne({ slug: params.priority }).lean() : null,
    params.type ? TicketTypeModel.findOne({ slug: params.type }).lean() : null,
    params.tag ? TagModel.findOne({ slug: params.tag }).lean() : null,
  ])

  if (status) filter.statusId = status._id
  else if (resolvedIds) filter.statusId = { $nin: resolvedIds.map((s) => s._id) }
  if (priority) filter.priorityId = priority._id
  if (type) filter.typeId = type._id
  if (tag) filter.tagIds = tag._id
  if (params.assigneeId === 'unassigned') filter.assigneeId = null
  else if (params.assigneeId) filter.assigneeId = params.assigneeId
  if (params.q) {
    // A bare (optionally "#"-prefixed) number is unambiguously a ticket ID lookup, not a
    // free-text search -- route it straight at the unique, indexed `number` field instead of
    // the text index, which would otherwise return nothing (subject/issue rarely contain the
    // raw digits) or unrelated partial matches.
    const idMatch = params.q.trim().match(/^#?(\d+)$/)
    if (idMatch) filter.number = Number(idMatch[1])
    else filter.$text = { $search: params.q }
  }
  if (params.classGroup) filter['location.classGroup'] = params.classGroup
  if (params.sectorNo !== undefined) filter['location.sectorNo'] = params.sectorNo

  if (params.from || params.to) {
    filter.createdAt = {}
    if (params.from) filter.createdAt.$gte = new Date(params.from)
    if (params.to) filter.createdAt.$lte = new Date(params.to)
  }

  const sortField = params.sortField ?? 'lastActivityAt'
  const sortDir = params.sortDir === 'asc' ? 1 : -1

  const [items, total] = await Promise.all([
    TicketModel.find(filter)
      .sort({ [sortField]: sortDir })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate(POPULATE)
      .lean(),
    TicketModel.countDocuments(filter),
  ])

  return { items, total, page, pageSize }
}

/** Global search's "Tickets" results (see /api/search). Reuses the subject/issue text index
 *  already used by listTickets's `q` param, but as its own lean query rather than routing
 *  through listTickets -- a type-ahead has no pagination/sort UI to serve, and doesn't need the
 *  full POPULATE (owner/type/tags) that the tickets table renders. `forcedAssigneeId` is the
 *  same Surveyor-scoping value requireTicketScope() returns elsewhere; passing it here (rather than
 *  trusting a client-supplied assignee filter) is what keeps a Surveyor's search results limited
 *  to their own tickets, matching every other ticket list in the app. */
export async function searchTickets(query: string, forcedAssigneeId?: string, limit = 5) {
  await dbConnect()
  const idMatch = query.trim().match(/^#?(\d+)$/)

  if (idMatch) {
    const filter: QueryFilter<Ticket> = { deletedAt: null, number: Number(idMatch[1]) }
    if (forcedAssigneeId) filter.assigneeId = forcedAssigneeId
    return TicketModel.find(filter)
      .limit(limit)
      .populate({ path: 'statusId', select: 'name slug color' })
      .select('number subject statusId')
      .lean()
  }

  const filter: QueryFilter<Ticket> = { deletedAt: null, $text: { $search: query } }
  if (forcedAssigneeId) filter.assigneeId = forcedAssigneeId

  return TicketModel.find(filter, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .populate({ path: 'statusId', select: 'name slug color' })
    .select('number subject statusId')
    .lean()
}

/**
 * Distinct class/sector values across non-deleted tickets that carry a `location` (i.e.
 * bulk-imported map-parcel tickets) — feeds the Class/Sector filter dropdowns on the Tickets
 * page. Class comes straight from Mongo's denormalized `location.*` fields. Sector *names*
 * aren't denormalized onto the ticket (only `sectorNo`), so those come from one small query
 * against kumbh.sector_boundary (32 static rows, doesn't change per-ticket) via the same
 * Postgres pool the map already uses — not a per-ticket join, just one lookup for this list.
 */
/**
 * `sector_no` -> display name, from Postgres `kumbh.sector_boundary` (32 static rows that don't
 * change per-ticket). Sector *names* aren't denormalized onto the ticket (only `sectorNo`), so
 * anything rendering a sector label needs this one small lookup against the same pool the map
 * already uses — not a per-ticket cross-DB join. Returns an empty map if Postgres is unreachable,
 * so callers degrade to numeric-only labels rather than failing the whole page over a nicety.
 */
async function getSectorNames(): Promise<Map<number, string>> {
  try {
    const { getPool } = await import('@/server/db/postgres')
    const { rows } = await getPool().query<{ sector_no: number; name: string }>(
      'SELECT sector_no, name FROM kumbh.sector_boundary ORDER BY sector_no',
    )
    return new Map(rows.map((r) => [r.sector_no, r.name]))
  } catch {
    return new Map()
  }
}

export async function getLocationFilterOptions() {
  await dbConnect()

  const [classGroups, sectorNos] = await Promise.all([
    TicketModel.distinct('location.classGroup', {
      deletedAt: null,
      'location.classGroup': { $ne: null },
    }),
    TicketModel.distinct('location.sectorNo', {
      deletedAt: null,
      'location.sectorNo': { $ne: null },
    }),
  ])

  const sortedSectorNos = (sectorNos as number[]).sort((a, b) => a - b)

  const sectorNames = await getSectorNames()

  return {
    classGroups: (classGroups as string[]).sort(),
    sectors: sortedSectorNos.map((sectorNo) => ({
      sectorNo,
      name: sectorNames.get(sectorNo) ?? null,
    })),
  }
}

/**
 * Counts of non-deleted tickets per status, keyed by status slug, plus a grand total.
 * Pass `assigneeId` to scope the counts to one user's queue (Surveyor role — see
 * `requireTicketScope()` in `src/server/auth/session.ts`).
 */
export async function countTicketsByStatus(assigneeId?: string) {
  await dbConnect()

  const statuses = await TicketStatusModel.find().sort({ order: 1 }).lean()
  const match: QueryFilter<Ticket> = { deletedAt: null }
  // aggregate() does NOT schema-cast filter values the way find()/countDocuments() do — an
  // uncast string here silently matches zero documents against the stored ObjectId.
  if (assigneeId) match.assigneeId = new Types.ObjectId(assigneeId)
  const counts = await TicketModel.aggregate([
    { $match: match },
    { $group: { _id: '$statusId', count: { $sum: 1 } } },
  ])

  const countByStatusId = new Map(counts.map((c) => [String(c._id), c.count]))
  const byStatus = statuses.map((s) => ({
    slug: s.slug,
    name: s.name,
    count: countByStatusId.get(String(s._id)) ?? 0,
  }))
  const total = byStatus.reduce((sum, s) => sum + s.count, 0)

  return { total, byStatus }
}

/**
 * Everything the dashboard page needs, in one call. All widgets accept `assigneeId` for
 * Surveyor-role scoping (see `requireTicketScope()`) — Admin/Manager pass `undefined` and see
 * workspace-wide data.
 */
export async function getDashboardData(assigneeId?: string) {
  await dbConnect()

  const baseMatch: QueryFilter<Ticket> = { deletedAt: null }
  // ObjectId, not string — this feeds both countDocuments() (casts either way) and aggregate()
  // pipelines below (does NOT cast; an uncast string here would silently match nothing).
  if (assigneeId) baseMatch.assigneeId = new Types.ObjectId(assigneeId)

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const sevenDaysAgo = new Date(startOfToday)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6) // today + 6 previous days = 7

  // Bucket by the server's local calendar day, not UTC — otherwise createdAt timestamps from
  // today (local) that fall before UTC midnight get grouped into "yesterday" and today's bar
  // never shows up.
  const tzOffsetMinutes = -new Date().getTimezoneOffset()
  const tzSign = tzOffsetMinutes >= 0 ? '+' : '-'
  const tzAbs = Math.abs(tzOffsetMinutes)
  const dateToStringTimezone = `${tzSign}${String(Math.floor(tzAbs / 60)).padStart(2, '0')}:${String(tzAbs % 60).padStart(2, '0')}`
  const toLocalISODate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // Fetched up front (not inside the big Promise.all below) so the priority/category aggregations
  // can match directly against resolvedIds instead of $lookup-joining ticketstatuses per ticket —
  // a small, cheap query traded for dropping a $lookup + $unwind from two much larger aggregations.
  const resolvedStatusIds = await TicketStatusModel.find({ isResolved: true }).select('_id').lean()
  const resolvedIds = resolvedStatusIds.map((s) => s._id)

  const [resolvedTodayCount, priorityRows, categoryRows, volumeRows, sectorNames] =
    await Promise.all([
      TicketModel.countDocuments({
        ...baseMatch,
        resolvedAt: { $gte: startOfToday },
      }),
      TicketModel.aggregate([
        { $match: { ...baseMatch, statusId: { $nin: resolvedIds } } },
        { $group: { _id: '$priorityId', count: { $sum: 1 } } },
      ]),
      // Grouped by class *and* sector in one pass: the dashboard's category panel ships both the
      // all-sectors totals and a per-sector breakdown so its sector dropdown filters instantly
      // client-side, with no round-trip per selection (~25 classes x ~32 sectors is a trivially
      // small payload, and most pairs don't exist at all).
      TicketModel.aggregate([
        { $match: { ...baseMatch, 'location.classGroup': { $ne: null } } },
        {
          $group: {
            _id: { classGroup: '$location.classGroup', sectorNo: '$location.sectorNo' },
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $in: ['$statusId', resolvedIds] }, 1, 0] } },
          },
        },
      ]),
      TicketModel.aggregate([
        {
          $facet: {
            created: [
              { $match: { ...baseMatch, createdAt: { $gte: sevenDaysAgo } } },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$createdAt',
                      timezone: dateToStringTimezone,
                    },
                  },
                  n: { $sum: 1 },
                },
              },
            ],
            resolved: [
              { $match: { ...baseMatch, resolvedAt: { $gte: sevenDaysAgo } } },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$resolvedAt',
                      timezone: dateToStringTimezone,
                    },
                  },
                  n: { $sum: 1 },
                },
              },
            ],
          },
        },
      ]),
      getSectorNames(),
    ])

  const priorities = await TicketPriorityModel.find().sort({ order: 1 }).lean()
  const priorityCountById = new Map(priorityRows.map((r) => [String(r._id), r.count]))
  const priorityBreakdown = priorities.map((p) => ({
    name: p.name,
    slug: p.slug,
    color: p.color,
    value: priorityCountById.get(String(p._id)) ?? 0,
  }))

  // One pass over the class x sector rows builds both shapes the category panel needs: the
  // all-sectors totals (its default view) and a per-sector count index (its dropdown).
  type CategoryRow = {
    _id: { classGroup: string; sectorNo: number | null }
    total: number
    completed: number
  }
  const overallByGroup = new Map<string, { total: number; completed: number }>()
  const countsBySector = new Map<number, Map<string, { total: number; completed: number }>>()
  for (const row of categoryRows as CategoryRow[]) {
    const { classGroup, sectorNo } = row._id
    const overall = overallByGroup.get(classGroup) ?? { total: 0, completed: 0 }
    overall.total += row.total
    overall.completed += row.completed
    overallByGroup.set(classGroup, overall)

    // Tickets with no sector number still count toward the all-sectors totals above, but aren't
    // reachable from any single sector — there's deliberately no "No sector" option.
    if (sectorNo == null) continue
    let forSector = countsBySector.get(sectorNo)
    if (!forSector) {
      forSector = new Map()
      countsBySector.set(sectorNo, forSector)
    }
    forSector.set(classGroup, { total: row.total, completed: row.completed })
  }

  // Fixed order/color per CLASS_GROUP_COLORS (not sorted by count) so the grid position of each
  // category card stays stable across reloads instead of reshuffling as counts change.
  const categoryBreakdown = Object.entries(CLASS_GROUP_COLORS).map(([name, color]) => ({
    name,
    color,
    total: overallByGroup.get(name)?.total ?? 0,
    completed: overallByGroup.get(name)?.completed ?? 0,
  }))

  // Only sectors that actually carry tickets become dropdown options. `counts` is a compact
  // className -> [total, completed] map rather than full entries, since the client already holds
  // every category's name and colour in `categoryBreakdown` and only needs the numbers swapped.
  const categorySectors = [...countsBySector.entries()]
    .sort(([a], [b]) => a - b)
    .map(([sectorNo, counts]) => ({
      sectorNo,
      name: sectorNames.get(sectorNo) ?? null,
      total: [...counts.values()].reduce((sum, c) => sum + c.total, 0),
      counts: Object.fromEntries(
        [...counts].map(([name, c]) => [name, [c.total, c.completed] as [number, number]]),
      ),
    }))

  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo)
    d.setDate(d.getDate() + i)
    days.push(toLocalISODate(d))
  }
  const dayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
  const createdByDay = new Map<string, number>(
    volumeRows[0].created.map((r: { _id: string; n: number }): [string, number] => [r._id, r.n]),
  )
  const resolvedByDay = new Map<string, number>(
    volumeRows[0].resolved.map((r: { _id: string; n: number }): [string, number] => [r._id, r.n]),
  )
  const ticketVolume = days.map((iso) => ({
    day: dayLabel.format(new Date(iso + 'T00:00:00')),
    created: createdByDay.get(iso) ?? 0,
    resolved: resolvedByDay.get(iso) ?? 0,
  }))

  const openMatch: QueryFilter<Ticket> = { ...baseMatch, statusId: { $nin: resolvedIds } }
  const [openTicketsCount, totalCount, unassignedCount] = await Promise.all([
    TicketModel.countDocuments(openMatch),
    TicketModel.countDocuments(baseMatch),
    // Workspace-wide, not scoped by assigneeId — "how many need a home" is inherently an
    // Admin/Manager question. null for a Surveyor's dashboard (their view is assignee-locked to
    // themselves, so an "unassigned" count in their own scope is always zero/meaningless).
    // statusId excludes resolved/closed tickets — an already-resolved ticket doesn't "need" an
    // assignee, so it shouldn't inflate this count.
    assigneeId
      ? null
      : TicketModel.countDocuments({
          deletedAt: null,
          assigneeId: null,
          statusId: { $nin: resolvedIds },
        }),
  ])

  // Recent activity — most recent events, scoped to the caller's tickets when assigneeId is set.
  const eventTicketFilter = assigneeId ? { deletedAt: null, assigneeId } : { deletedAt: null }
  const scopedTicketIds = assigneeId
    ? (await TicketModel.find(eventTicketFilter).select('_id').lean()).map((t) => t._id)
    : null
  const eventMatch = scopedTicketIds ? { ticketId: { $in: scopedTicketIds } } : {}
  const recentEvents = await TicketEventModel.find(eventMatch)
    .sort({ createdAt: -1 })
    .limit(8)
    .populate([
      { path: 'actorId', select: 'fullname email' },
      { path: 'ticketId', select: 'number subject' },
    ])
    .lean()

  // Workload by assignee — open tickets grouped by who holds them. For a Surveyor (assigneeId set)
  // this degenerates to at most their own row, deliberately: their dashboard shouldn't reveal
  // other surveyors' queues.
  const workloadRows = await TicketModel.aggregate([
    { $match: openMatch },
    { $match: { assigneeId: { $ne: null } } },
    { $group: { _id: '$assigneeId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 6 },
  ])
  const workloadUserIds = workloadRows.map((r) => r._id)
  const workloadUsers = await UserModel.find({ _id: { $in: workloadUserIds } })
    .select('fullname')
    .lean()
  const nameById = new Map(workloadUsers.map((u) => [String(u._id), u.fullname]))
  const workloadByAssignee = workloadRows.map((r) => ({
    id: String(r._id),
    name: nameById.get(String(r._id)) ?? 'Unknown',
    count: r.count as number,
  }))

  return {
    openTicketsCount,
    totalCount,
    unassignedCount,
    resolvedTodayCount,
    priorityBreakdown,
    categoryBreakdown,
    categorySectors,
    ticketVolume,
    workloadByAssignee,
    recentActivity: recentEvents.map((e) => {
      const ev = e as unknown as {
        _id: unknown
        action: string
        createdAt: Date
        actorId: { fullname?: string; email?: string } | null
        ticketId: { _id: unknown; number: number; subject: string } | null
      }
      return {
        id: String(ev._id),
        action: ev.action,
        createdAt: ev.createdAt.toISOString(),
        actorName: ev.actorId?.fullname ?? ev.actorId?.email ?? 'Someone',
        ticketNumber: ev.ticketId?.number ?? null,
        ticketSubject: ev.ticketId?.subject ?? null,
      }
    }),
  }
}

export async function getTicketByNumber(number: number) {
  await dbConnect()
  return TicketModel.findOne({ number, deletedAt: null }).populate(POPULATE).lean()
}

/** Finds the ticket bulk-imported for a given kumbh.sector_plan parcel — feeds the map's
 *  click popup (see src/app/api/tickets/by-parcel/[sectorPlanId]/route.ts). */
export async function getTicketByParcelId(sectorPlanId: number) {
  await dbConnect()
  return TicketModel.findOne({ 'location.sectorPlanId': sectorPlanId, deletedAt: null })
    .populate([
      { path: 'statusId', select: 'name slug color' },
      { path: 'priorityId', select: 'name slug color' },
    ])
    .lean()
}

export async function createTicket(input: {
  subject: string
  issue: string
  typeId: string
  priorityId: string
  ownerId: string
  tagIds?: string[]
  /** Defaults to 'web' (schema default) — pass 'api' for integration-created tickets. */
  source?: 'web' | 'email' | 'api' | 'public'
  /** Set only when this ticket was bulk-imported from a kumbh.sector_plan map parcel. */
  location?: {
    sectorPlanId: number
    sectorNo: number | null
    classGroup: string
    subclass: string | null
    plotNo: string | null
    block: string | null
    label: string | null
    areaHectares: number | null
    lng: number
    lat: number
  }
}) {
  await dbConnect()

  const status = await TicketStatusModel.findOne({ isDefault: true }).lean()
  if (!status) throw new Error('No default ticket status configured — run the seed script.')

  const number = await nextSequence('tickets')

  const ticket = await TicketModel.create({
    number,
    subject: input.subject,
    issue: input.issue,
    ownerId: input.ownerId,
    typeId: input.typeId,
    priorityId: input.priorityId,
    statusId: status._id,
    tagIds: input.tagIds ?? [],
    source: input.source ?? 'web',
    location: input.location ?? null,
    lastActivityAt: new Date(),
  })

  await TicketEventModel.create({
    ticketId: ticket._id,
    actorId: input.ownerId,
    action: 'created',
  })

  return ticket
}

const EDITABLE_FIELDS = [
  'subject',
  'statusId',
  'assigneeId',
  'priorityId',
  'typeId',
  'dueDate',
] as const
type EditableField = (typeof EDITABLE_FIELDS)[number]

export async function updateTicketFields(
  number: number,
  patch: Partial<Record<EditableField, string | Date | null>>,
  actorId: string,
) {
  await dbConnect()

  const ticket = await TicketModel.findOne({ number, deletedAt: null })
  if (!ticket) throw new Error('Ticket not found')

  const events = []
  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) continue
    const from = ticket.get(field)
    const to = patch[field]
    const fromStr = from ? String(from) : null
    const toStr = to ? String(to) : null
    if (fromStr === toStr) continue

    ticket.set(field, to)
    events.push({
      ticketId: ticket._id,
      actorId,
      action: 'field_changed',
      field,
      from: fromStr,
      to: toStr,
    })
  }

  if (events.length === 0) return ticket

  ticket.lastActivityAt = new Date()
  const status = ticket.statusId ? await TicketStatusModel.findById(ticket.statusId).lean() : null
  if (status?.isResolved && !ticket.resolvedAt) ticket.resolvedAt = new Date()

  await ticket.save()
  await TicketEventModel.insertMany(events)

  return ticket
}

export async function softDeleteTicket(number: number, actorId: string) {
  await dbConnect()
  const ticket = await TicketModel.findOneAndUpdate(
    { number, deletedAt: null },
    { deletedAt: new Date() },
    { returnDocument: 'after' },
  )
  if (ticket) {
    await TicketEventModel.create({ ticketId: ticket._id, actorId, action: 'deleted' })
  }
  return ticket
}

export async function restoreTicket(number: number, actorId: string) {
  await dbConnect()
  const ticket = await TicketModel.findOneAndUpdate(
    { number, deletedAt: { $ne: null } },
    { deletedAt: null },
    { returnDocument: 'after' },
  )
  if (ticket) {
    await TicketEventModel.create({ ticketId: ticket._id, actorId, action: 'restored' })
  }
  return ticket
}

export async function addComment(input: {
  ticketNumber: number
  authorId: string
  body: string
  isInternal: boolean
}) {
  await dbConnect()

  const ticket = await TicketModel.findOne({ number: input.ticketNumber, deletedAt: null })
  if (!ticket) throw new Error('Ticket not found')

  const comment = await TicketCommentModel.create({
    ticketId: ticket._id,
    authorId: input.authorId,
    body: input.body,
    isInternal: input.isInternal,
  })

  ticket.counts.comments += 1
  ticket.lastActivityAt = new Date()
  if (!ticket.firstResponseAt && !input.isInternal) ticket.firstResponseAt = new Date()
  await ticket.save()

  await TicketEventModel.create({
    ticketId: ticket._id,
    actorId: input.authorId,
    action: input.isInternal ? 'note_added' : 'commented',
  })

  return comment
}

export async function listComments(ticketId: string) {
  await dbConnect()
  return TicketCommentModel.find({ ticketId, deletedAt: null })
    .sort({ createdAt: 1 })
    .populate({ path: 'authorId', select: 'fullname email avatarUrl' })
    .lean()
}

export async function listEvents(ticketId: string) {
  await dbConnect()
  return TicketEventModel.find({ ticketId })
    .sort({ createdAt: 1 })
    .populate({ path: 'actorId', select: 'fullname email avatarUrl' })
    .lean()
}
