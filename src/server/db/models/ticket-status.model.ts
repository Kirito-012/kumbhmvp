import { Schema, model, models, type InferSchemaType } from 'mongoose'

const ticketStatusSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    color: { type: String, required: true },
    order: { type: Number, required: true },
    isResolved: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
)

export type TicketStatus = InferSchemaType<typeof ticketStatusSchema>
export const TicketStatusModel = models.TicketStatus ?? model('TicketStatus', ticketStatusSchema)
