import 'server-only'

import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

/** Folder every Site Photo for a ticket/phase is uploaded into. Shared by the signer (below)
 *  and saveSitePhotoAction, which re-checks a returned public_id starts with this exact prefix
 *  before trusting it — that check is what stops a signed-but-generic upload from being claimed
 *  against an unrelated ticket. */
export function sitePhotoFolder(ticketNumber: number, phase: 'before' | 'after') {
  return `tcsticket/tickets/${ticketNumber}/${phase}`
}

/** Mints a short-lived signature for a direct browser-to-Cloudinary upload — bytes never pass
 *  through the Next server. Only the params listed here are covered by the signature; the
 *  browser must send exactly these back unchanged or Cloudinary rejects the upload. */
export function signSitePhotoUpload(ticketNumber: number, phase: 'before' | 'after') {
  const timestamp = Math.round(Date.now() / 1000)
  const folder = sitePhotoFolder(ticketNumber, phase)

  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder },
    process.env.CLOUDINARY_API_SECRET!,
  )

  return {
    timestamp,
    signature,
    folder,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
  }
}

/** Best-effort delete of the remote asset — called after the TicketAttachment doc is soft
 *  deleted. Failures are swallowed by the caller (an orphaned Cloudinary asset is a much smaller
 *  problem than a delete action that can't complete because Cloudinary hiccuped). */
export async function destroySitePhoto(publicId: string) {
  await cloudinary.uploader.destroy(publicId)
}
