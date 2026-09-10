'use server'

import { revalidatePath } from 'next/cache'
import { requireTicketScope } from '@/server/auth/session'
import {
  signSitePhotoSchema,
  saveSitePhotoSchema,
  deleteSitePhotoSchema,
} from '@/lib/schemas/questionnaire'
import * as ticketService from '@/server/services/ticket.service'
import * as attachmentService from '@/server/services/attachment.service'
import {
  signSitePhotoUpload,
  sitePhotoFolder,
  destroySitePhoto,
} from '@/server/services/cloudinary.service'

type ActionResult<T> = { error: string; data?: undefined } | { error?: undefined; data: T }

/** Re-verifies the ticket exists and, for a Surveyor, that it's actually assigned to them —
 *  guards both signSitePhotoUploadAction (before minting a signature) and
 *  saveSitePhotoAction/deleteSitePhotoAction against a direct call that bypasses the ticket
 *  page's own visibility check, exactly like addCommentAction does for comments. */
async function assertTicketAccess(ticketNumber: number, forcedAssigneeId: string | undefined) {
  if (!forcedAssigneeId) return null
  const ticket = await ticketService.getTicketByNumber(ticketNumber)
  const assignee = (ticket as { assigneeId?: { _id?: unknown } | null } | null)?.assigneeId
  if (String(assignee?._id ?? '') !== forcedAssigneeId) {
    return 'You do not have permission to do that.'
  }
  return null
}

export async function signSitePhotoUploadAction(
  ticketNumber: number,
  phase: 'before' | 'after',
): Promise<
  ActionResult<{
    timestamp: number
    signature: string
    folder: string
    apiKey: string
    cloudName: string
  }>
> {
  const parsed = signSitePhotoSchema.safeParse({ ticketNumber, phase })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { ability, forcedAssigneeId } = await requireTicketScope()
  if (!ability.can('create', 'attachment')) {
    return { error: 'You do not have permission to do that.' }
  }

  const accessError = await assertTicketAccess(parsed.data.ticketNumber, forcedAssigneeId)
  if (accessError) return { error: accessError }

  return { data: signSitePhotoUpload(parsed.data.ticketNumber, parsed.data.phase) }
}

export async function saveSitePhotoAction(input: {
  ticketNumber: number
  phase: 'before' | 'after'
  publicId: string
  url: string
  width?: number
  height?: number
  bytes?: number
  format?: string
}): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSitePhotoSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { user, ability, forcedAssigneeId } = await requireTicketScope()
  if (!ability.can('create', 'attachment')) {
    return { error: 'You do not have permission to do that.' }
  }

  const accessError = await assertTicketAccess(parsed.data.ticketNumber, forcedAssigneeId)
  if (accessError) return { error: accessError }

  // The signature only ever covers this exact folder — a public_id outside it means the
  // Cloudinary result didn't come from the upload we signed (or was tampered with client-side).
  const expectedFolder = sitePhotoFolder(parsed.data.ticketNumber, parsed.data.phase)
  if (!parsed.data.publicId.startsWith(`${expectedFolder}/`)) {
    return { error: 'Upload did not match the expected ticket/phase.' }
  }

  try {
    const attachment = await attachmentService.createAttachment({
      ticketNumber: parsed.data.ticketNumber,
      uploaderId: user.id,
      phase: parsed.data.phase,
      publicId: parsed.data.publicId,
      url: parsed.data.url,
      width: parsed.data.width,
      height: parsed.data.height,
      bytes: parsed.data.bytes,
      format: parsed.data.format,
    })
    revalidatePath(`/tickets/${parsed.data.ticketNumber}`)
    return { data: { id: String(attachment._id) } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save photo' }
  }
}

export async function deleteSitePhotoAction(
  ticketNumber: number,
  attachmentId: string,
): Promise<ActionResult<{ ok: true }>> {
  const parsed = deleteSitePhotoSchema.safeParse({ attachmentId })
  if (!parsed.success) return { error: 'Invalid input' }

  const { user, ability, forcedAssigneeId } = await requireTicketScope()

  const accessError = await assertTicketAccess(ticketNumber, forcedAssigneeId)
  if (accessError) return { error: accessError }

  const existing = await attachmentService.getAttachmentById(parsed.data.attachmentId)
  if (!existing) return { error: 'Photo not found' }

  const isOwner = String(existing.uploaderId) === user.id
  if (!ability.can('delete', 'attachment') && !isOwner) {
    return { error: 'You do not have permission to do that.' }
  }

  const deleted = await attachmentService.softDeleteAttachment(parsed.data.attachmentId, user.id)
  if (!deleted) return { error: 'Photo not found' }

  try {
    await destroySitePhoto(deleted.publicId)
  } catch {
    // Cloudinary-side cleanup is best-effort — the attachment is already soft-deleted in our DB,
    // which is what the UI and future queries rely on. An orphaned remote asset can be swept up
    // later; failing the whole delete over it would be worse.
  }

  revalidatePath(`/tickets/${ticketNumber}`)
  return { data: { ok: true } }
}
