'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { Camera, X, RotateCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { compressImage } from '@/lib/image-compress'
import { uploadToCloudinary } from '@/lib/cloudinary-upload'
import {
  signSitePhotoUploadAction,
  saveSitePhotoAction,
  deleteSitePhotoAction,
} from '@/server/actions/attachment.actions'
import { PhotoLightbox } from '@/components/tickets/PhotoLightbox'
import type { AttachmentView } from '@/lib/ticket-view'

const MAX_PER_PHASE = 5

type PendingUpload = { key: string; file: File; progress: number; error: string | null }

function PhaseGroup({
  phase,
  label,
  photos,
  ticketNumber,
  canUpload,
  canDeletePhoto,
  onUploaded,
  onDeleted,
  onOpenLightbox,
}: {
  phase: 'before' | 'after'
  label: string
  photos: AttachmentView[]
  ticketNumber: number
  canUpload: boolean
  canDeletePhoto: (photo: AttachmentView) => boolean
  onUploaded: (photo: AttachmentView) => void
  onDeleted: (id: string) => void
  onOpenLightbox: (id: string) => void
}) {
  const [pending, setPending] = useState<PendingUpload[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const remaining = MAX_PER_PHASE - photos.length - pending.length

  async function uploadOne(file: File) {
    const key = `${Date.now()}-${Math.random()}`
    setPending((prev) => [...prev, { key, file, progress: 0, error: null }])

    try {
      const compressed = await compressImage(file)
      const sig = await signSitePhotoUploadAction(ticketNumber, phase)
      if (sig.error || !sig.data) throw new Error(sig.error ?? 'Could not start upload')

      const result = await uploadToCloudinary(compressed, sig.data, (fraction) => {
        setPending((prev) => prev.map((p) => (p.key === key ? { ...p, progress: fraction } : p)))
      })

      const saved = await saveSitePhotoAction({
        ticketNumber,
        phase,
        publicId: result.public_id,
        url: result.secure_url,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        format: result.format,
      })
      if (saved.error || !saved.data) throw new Error(saved.error ?? 'Could not save photo')

      onUploaded({
        id: saved.data.id,
        phase,
        url: result.secure_url,
        width: result.width,
        height: result.height,
        uploader: null,
        createdAt: new Date().toISOString(),
      })
      setPending((prev) => prev.filter((p) => p.key !== key))
    } catch (err) {
      setPending((prev) =>
        prev.map((p) =>
          p.key === key ? { ...p, error: err instanceof Error ? err.message : 'Upload failed' } : p,
        ),
      )
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    const toUpload = Array.from(files).slice(0, Math.max(0, remaining))
    toUpload.forEach(uploadOne)
    if (inputRef.current) inputRef.current.value = ''
  }

  function retry(item: PendingUpload) {
    setPending((prev) => prev.filter((p) => p.key !== item.key))
    uploadOne(item.file)
  }

  async function handleDelete(photo: AttachmentView) {
    if (!window.confirm('Remove this photo?')) return
    const res = await deleteSitePhotoAction(ticketNumber, photo.id)
    if (!res.error) onDeleted(photo.id)
  }

  return (
    <section aria-labelledby={`${phase}-photos-heading`} className="min-w-0 flex-1">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id={`${phase}-photos-heading`} className="text-sm font-semibold text-foreground">
          {label} work
        </h3>
        <span className="text-sm text-muted">
          {photos.length}/{MAX_PER_PHASE}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
        {photos.map((photo, i) => (
          <div
            key={photo.id}
            className="group relative aspect-square overflow-hidden rounded-xl bg-overlay"
          >
            <button
              type="button"
              onClick={() => onOpenLightbox(photo.id)}
              className="absolute inset-0 cursor-pointer"
              aria-label={`View ${label.toLowerCase()} photo ${i + 1}`}
            >
              <Image
                src={photo.url.replace('/upload/', '/upload/f_auto,q_auto,w_600/')}
                alt={`${label} site photo`}
                fill
                sizes="(min-width: 640px) 220px, 45vw"
                className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                unoptimized
              />
              <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
            </button>
            {canDeletePhoto(photo) && (
              <button
                type="button"
                onClick={() => handleDelete(photo)}
                aria-label="Delete photo"
                className="absolute right-0.5 top-0.5 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 active:bg-black/80 lg:h-8 lg:w-8"
              >
                <X className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
              </button>
            )}
          </div>
        ))}

        {pending.map((item) => (
          <div
            key={item.key}
            className="relative flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-overlay p-2 text-center"
          >
            {item.error ? (
              <>
                <p className="text-[10px] text-danger">{item.error}</p>
                <button
                  type="button"
                  onClick={() => retry(item)}
                  className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-overlay-strong text-muted-strong transition-colors hover:bg-border active:bg-border"
                  aria-label="Retry upload"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
                <span className="text-[10px] text-muted">{Math.round(item.progress * 100)}%</span>
              </>
            )}
          </div>
        ))}

        {canUpload && remaining > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex aspect-square min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border text-muted-strong transition-colors hover:border-accent/60 hover:bg-accent-soft/30 hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-overlay',
            )}
            aria-label={`Add ${label.toLowerCase()} work photos`}
          >
            <Camera className="h-6 w-6" />
            <span className="text-sm font-medium">Add photos</span>
          </button>
        )}
      </div>

      {canUpload && remaining > 0 && (
        <p className="mt-3 text-sm leading-5 text-muted">
          JPG, PNG, HEIC, or other camera image formats. Up to {remaining} more.
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        aria-label={`Upload ${label.toLowerCase()} work photos`}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </section>
  )
}

export function SitePhotos({
  ticketNumber,
  initialPhotos,
  currentUserId,
  canUpload,
  canDeleteAny,
}: {
  ticketNumber: number
  initialPhotos: AttachmentView[]
  currentUserId: string
  canUpload: boolean
  canDeleteAny: boolean
}) {
  const [photos, setPhotos] = useState(initialPhotos)
  const [lightboxId, setLightboxId] = useState<string | null>(null)

  const before = photos.filter((p) => p.phase === 'before')
  const after = photos.filter((p) => p.phase === 'after')

  function canDeletePhoto(photo: AttachmentView) {
    return canDeleteAny || photo.uploader?.id === currentUserId
  }

  const lightboxIndex = lightboxId ? photos.findIndex((p) => p.id === lightboxId) : -1

  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row">
        <PhaseGroup
          phase="before"
          label="Before"
          photos={before}
          ticketNumber={ticketNumber}
          canUpload={canUpload}
          canDeletePhoto={canDeletePhoto}
          onUploaded={(p) => setPhotos((prev) => [...prev, p])}
          onDeleted={(id) => setPhotos((prev) => prev.filter((p) => p.id !== id))}
          onOpenLightbox={setLightboxId}
        />
        <PhaseGroup
          phase="after"
          label="After"
          photos={after}
          ticketNumber={ticketNumber}
          canUpload={canUpload}
          canDeletePhoto={canDeletePhoto}
          onUploaded={(p) => setPhotos((prev) => [...prev, p])}
          onDeleted={(id) => setPhotos((prev) => prev.filter((p) => p.id !== id))}
          onOpenLightbox={setLightboxId}
        />
      </div>

      {lightboxIndex >= 0 && (
        <PhotoLightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxId(null)}
          onIndexChange={(i) => setLightboxId(photos[i]?.id ?? null)}
        />
      )}
    </>
  )
}
