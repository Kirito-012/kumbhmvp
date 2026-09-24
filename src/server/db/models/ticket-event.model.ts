import { Schema, model, models, type InferSchemaType } from 'mongoose'

const ticketEventSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true }, // e.g. 'created', 'status_changed', 'assigned', 'commented'
    field: { type: String, default: null },
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

ticketEventSchema.index({ ticketId: 1, createdAt: 1 })

// The notification bell and the dashboard activity feed both read this collection *unscoped* for
// Admin/Manager — `find({}).sort({ createdAt: -1 }).limit(n)` — and the index above is prefixed on
// `ticketId`, so it could not serve that sort. Measured plan before this line: COLLSCAN,
// keysExamined 0, docsExamined 8510, blocking in-memory SORT, to return 25 documents. The bell
// polls that every 30s per open tab and the dashboard re-runs it every 60s.
//
// This is also the one collection in the app that grows without bound — an append-only audit trail,
// ~2.4 events per ticket and climbing with every comment and status change — so the collscan gets
// steadily worse and the in-memory sort eventually approaches the 32MB sort memory limit.
ticketEventSchema.index({ createdAt: -1 })

export type TicketEvent = InferSchemaType<typeof ticketEventSchema>
export const TicketEventModel = models.TicketEvent ?? model('TicketEvent', ticketEventSchema)
