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

export type TicketEvent = InferSchemaType<typeof ticketEventSchema>
export const TicketEventModel = models.TicketEvent ?? model('TicketEvent', ticketEventSchema)
