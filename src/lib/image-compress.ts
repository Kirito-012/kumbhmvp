/** Client-only: downscales/re-encodes a photo before it leaves the device. Surveyors are
 *  uploading straight from a phone camera on mobile data, so a 6MB original becomes a ~200-400KB
 *  JPEG here rather than crossing the network at full size. `imageOrientation: 'from-image'`
 *  bakes in EXIF rotation so the canvas output is always upright regardless of how the phone
 *  camera tagged it. */
export async function compressImage(
  file: File,
  { maxEdge = 1600, quality = 0.8 }: { maxEdge?: number; quality?: number } = {},
): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Some browsers/formats (e.g. HEIC without decoder support) can't be decoded client-side —
    // fall back to uploading the original rather than failing the whole flow.
    return file
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) return file

  // Only use the compressed version if it's actually smaller — a tiny/already-compressed source
  // image can re-encode larger than the original.
  if (blob.size >= file.size) return file

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg' })
}
