import { Schema, model, models, type InferSchemaType } from 'mongoose'

const ticketAttachmentSchema = new Schema(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    uploaderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    phase: { type: String, enum: ['before', 'after'], required: true },
    // Cloudinary identifiers — publicId is required to call destroy() on delete.
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    bytes: { type: Number, default: null },
    format: { type: String, default: null },
    caption: { type: String, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

ticketAttachmentSchema.index({ ticketId: 1, phase: 1, createdAt: 1 })

export type TicketAttachment = InferSchemaType<typeof ticketAttachmentSchema>
export const TicketAttachmentModel =
  models.TicketAttachment ?? model('TicketAttachment', ticketAttachmentSchema)
