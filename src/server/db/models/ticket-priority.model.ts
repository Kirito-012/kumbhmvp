import { Schema, model, models, type InferSchemaType } from 'mongoose'

const ticketPrioritySchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    color: { type: String, required: true },
    order: { type: Number, required: true },
    slaHours: { type: Number, required: true },
    overdueAfterHours: { type: Number, required: true },
  },
  { timestamps: true },
)

export type TicketPriority = InferSchemaType<typeof ticketPrioritySchema>
export const TicketPriorityModel =
  models.TicketPriority ?? model('TicketPriority', ticketPrioritySchema)
