import 'server-only'

import { dbConnect } from '@/server/db/connect'
import { TicketModel } from '@/server/db/models/ticket.model'
import { TicketAttachmentModel } from '@/server/db/models/ticket-attachment.model'
import { TicketEventModel } from '@/server/db/models/ticket-event.model'

export const MAX_PHOTOS_PER_PHASE = 5

export async function listAttachments(ticketId: string) {
  await dbConnect()
  return TicketAttachmentModel.find({ ticketId, deletedAt: null })
    .sort({ createdAt: 1 })
    .populate({ path: 'uploaderId', select: 'fullname email avatarUrl' })
    .lean()
}

export async function countAttachmentsByPhase(ticketId: string, phase: 'before' | 'after') {
  await dbConnect()
  return TicketAttachmentModel.countDocuments({ ticketId, phase, deletedAt: null })
}

export async function createAttachment(input: {
  ticketNumber: number
  uploaderId: string
  phase: 'before' | 'after'
  publicId: string
  url: string
  width?: number
  height?: number
  bytes?: number
  format?: string
}) {
  await dbConnect()

  const ticket = await TicketModel.findOne({ number: input.ticketNumber, deletedAt: null })
  if (!ticket) throw new Error('Ticket not found')

  const existing = await TicketAttachmentModel.countDocuments({
    ticketId: ticket._id,
    phase: input.phase,
    deletedAt: null,
  })
  if (existing >= MAX_PHOTOS_PER_PHASE) {
    throw new Error(`You can upload at most ${MAX_PHOTOS_PER_PHASE} "${input.phase}" photos.`)
  }

  const attachment = await TicketAttachmentModel.create({
    ticketId: ticket._id,
    uploaderId: input.uploaderId,
    phase: input.phase,
    publicId: input.publicId,
    url: input.url,
    width: input.width ?? null,
    height: input.height ?? null,
    bytes: input.bytes ?? null,
    format: input.format ?? null,
  })

  ticket.counts.attachments += 1
  ticket.lastActivityAt = new Date()
  await ticket.save()

  await TicketEventModel.create({
    ticketId: ticket._id,
    actorId: input.uploaderId,
    action: 'attachment_added',
    meta: { phase: input.phase, attachmentId: attachment._id },
  })

  return attachment
}

/** Returns the deleted attachment doc (so the caller can destroy the Cloudinary asset), or null
 *  if it didn't exist / was already deleted. Caller is responsible for the authorization check
 *  (ability.can('delete','attachment') OR caller === uploader) before calling this. */
export async function softDeleteAttachment(attachmentId: string, actorId: string) {
  await dbConnect()

  const attachment = await TicketAttachmentModel.findOneAndUpdate(
    { _id: attachmentId, deletedAt: null },
    { deletedAt: new Date() },
    { returnDocument: 'after' },
  )
  if (!attachment) return null

  const ticket = await TicketModel.findById(attachment.ticketId)
  if (ticket) {
    ticket.counts.attachments = Math.max(0, ticket.counts.attachments - 1)
    ticket.lastActivityAt = new Date()
    await ticket.save()

    await TicketEventModel.create({
      ticketId: ticket._id,
      actorId,
      action: 'attachment_removed',
      meta: { phase: attachment.phase, attachmentId: attachment._id },
    })
  }

  return attachment
}

export async function getAttachmentById(attachmentId: string) {
  await dbConnect()
  return TicketAttachmentModel.findOne({ _id: attachmentId, deletedAt: null })
}
