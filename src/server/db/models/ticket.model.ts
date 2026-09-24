import { Schema, model, models, type InferSchemaType } from 'mongoose'

const ticketSchema = new Schema(
  {
    number: { type: Number, required: true, unique: true },
    subject: { type: String, required: true },
    issue: { type: String, required: true }, // sanitized HTML

    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Customer bucket — optional until Phase 3 builds real Groups.
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    typeId: { type: Schema.Types.ObjectId, ref: 'TicketType', required: true },
    statusId: { type: Schema.Types.ObjectId, ref: 'TicketStatus', required: true },
    priorityId: { type: Schema.Types.ObjectId, ref: 'TicketPriority', required: true },
    tagIds: { type: [Schema.Types.ObjectId], ref: 'Tag', default: [] },
    subscriberIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },

    dueDate: { type: Date, default: null },
    slaDueAt: { type: Date, default: null },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    source: { type: String, enum: ['web', 'email', 'api', 'public'], default: 'web' },

    // Set only for tickets bulk-imported from a kumbh.sector_plan parcel (see
    // scripts/import-map-tickets.ts) — a denormalized snapshot, not a live reference, so the
    // ticket renders its location without a cross-DB join back to Postgres.
    location: {
      type: {
        sectorPlanId: { type: Number, required: true },
        sectorNo: { type: Number, default: null },
        classGroup: { type: String, required: true },
        subclass: { type: String, default: null },
        plotNo: { type: String, default: null },
        block: { type: String, default: null },
        label: { type: String, default: null },
        areaHectares: { type: Number, default: null },
        lng: { type: Number, required: true },
        lat: { type: Number, required: true },
      },
      default: null,
    },

    counts: {
      comments: { type: Number, default: 0 },
      attachments: { type: Number, default: 0 },
    },

    lastActivityAt: { type: Date, default: () => new Date() },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

ticketSchema.index({ deletedAt: 1, statusId: 1, lastActivityAt: -1 })
// The unfiltered /tickets list -- by far its most common shape -- is `{deletedAt: null}` sorted by
// lastActivityAt. The compound index above cannot serve that ordering because statusId sits between
// the two and is unconstrained, so page 1 was a collection scan plus a blocking in-memory sort of
// every ticket. This prefix pair serves both the sort and the countDocuments beside it.
ticketSchema.index({ deletedAt: 1, lastActivityAt: -1 })
// resolvedAt drives "resolved today" and the resolved half of both 7-day trend facets (dashboard
// and insights), plus the median-resolve-time query -- four O(n) scans per dashboard render and per
// Insights panel open, with nothing indexing the field at all.
ticketSchema.index({ deletedAt: 1, resolvedAt: -1 })
// `sort=createdAt` is one of the three orderings the /tickets header offers, and it had the same
// problem `{deletedAt, lastActivityAt}` above was added to fix: measured docsExamined 3612,
// keysExamined 3612, 118ms with a blocking SORT, against 2ms for the lastActivityAt sort -- a 59x
// gap on one column click. This also makes the `from`/`to` createdAt range filter sargable instead
// of a post-filter.
ticketSchema.index({ deletedAt: 1, createdAt: -1 })
ticketSchema.index({ deletedAt: 1, assigneeId: 1, statusId: 1 })
// A Surveyor's /tickets list is `{deletedAt, assigneeId}` sorted by lastActivityAt. The index above
// cannot serve that sort -- statusId sits between assigneeId and the sort key -- so every surveyor's
// page 1 fetched all of their tickets and sorted them in memory. Same failure mode, and same fix, as
// the unfiltered case. The statusId index stays: it serves the status-chip-filtered view.
ticketSchema.index({ deletedAt: 1, assigneeId: 1, lastActivityAt: -1 })
// Removed: `{deletedAt, groupId, statusId, createdAt}` and `{deletedAt, slaDueAt}`. Neither field is
// referenced by a single query in the app -- Groups are Phase 3 and slaDueAt is unused -- so both
// were pure write amplification on every ticket insert and update. `{deletedAt, slaDueAt}` was also
// actively harmful: it was the index the planner chose as input for the createdAt sort above, which
// is how that query ended up fetching all 3612 documents. Restore the groupId index when Groups
// actually ship, with the field order checked against the query the feature ends up issuing.
//
// Note that deleting an `index()` call does not drop an index that already exists -- Mongoose only
// ever creates. Both were dropped explicitly against the live database.
ticketSchema.index({ subject: 'text', issue: 'text' })
ticketSchema.index({ deletedAt: 1, 'location.classGroup': 1 })
ticketSchema.index({ deletedAt: 1, 'location.sectorNo': 1 })
ticketSchema.index({ 'location.sectorPlanId': 1 }, { sparse: true })

export type Ticket = InferSchemaType<typeof ticketSchema>
export const TicketModel = models.Ticket ?? model('Ticket', ticketSchema)
