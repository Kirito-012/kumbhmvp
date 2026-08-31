import { Schema, model, models, type InferSchemaType } from 'mongoose'

const ticketCommentSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true }, // sanitized HTML
    isInternal: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

ticketCommentSchema.index({ ticketId: 1, createdAt: 1 })

export type TicketComment = InferSchemaType<typeof ticketCommentSchema>
export const TicketCommentModel =
  models.TicketComment ?? model('TicketComment', ticketCommentSchema)
