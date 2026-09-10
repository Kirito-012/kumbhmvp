export type CloudinarySignature = {
  timestamp: number
  signature: string
  folder: string
  apiKey: string
  cloudName: string
}

export type CloudinaryUploadResult = {
  public_id: string
  secure_url: string
  width: number
  height: number
  bytes: number
  format: string
}

/** Uploads a file straight to Cloudinary using a server-minted signature (see
 *  signSitePhotoUploadAction) — bytes never touch the Next server. Uses XMLHttpRequest rather
 *  than fetch because fetch exposes no upload-progress event, and per-file progress matters here:
 *  a surveyor on 3G watching a photo crawl needs to see it's alive, not just wait on a spinner. */
export function uploadToCloudinary(
  file: File,
  sig: CloudinarySignature,
  onProgress?: (fraction: number) => void,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    form.append('api_key', sig.apiKey)
    form.append('timestamp', String(sig.timestamp))
    form.append('signature', sig.signature)
    form.append('folder', sig.folder)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Upload failed: bad response'))
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed: network error'))

    xhr.send(form)
  })
}
