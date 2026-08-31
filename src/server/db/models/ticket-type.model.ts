import { Schema, model, models, type InferSchemaType } from 'mongoose'

const ticketTypeSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    allowedPriorityIds: { type: [Schema.Types.ObjectId], ref: 'TicketPriority', default: [] },
    defaultPriorityId: { type: Schema.Types.ObjectId, ref: 'TicketPriority' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export type TicketType = InferSchemaType<typeof ticketTypeSchema>
export const TicketTypeModel = models.TicketType ?? model('TicketType', ticketTypeSchema)
