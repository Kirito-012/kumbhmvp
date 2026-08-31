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
ticketSchema.index({ deletedAt: 1, assigneeId: 1, statusId: 1 })
ticketSchema.index({ deletedAt: 1, groupId: 1, statusId: 1, createdAt: -1 })
ticketSchema.index({ deletedAt: 1, slaDueAt: 1 })
ticketSchema.index({ subject: 'text', issue: 'text' })
ticketSchema.index({ deletedAt: 1, 'location.classGroup': 1 })
ticketSchema.index({ deletedAt: 1, 'location.sectorNo': 1 })
ticketSchema.index({ 'location.sectorPlanId': 1 }, { sparse: true })

export type Ticket = InferSchemaType<typeof ticketSchema>
export const TicketModel = models.Ticket ?? model('Ticket', ticketSchema)
