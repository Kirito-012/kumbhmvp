'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { timeAgo } from '@/lib/utils'
import type { AttachmentView } from '@/lib/ticket-view'

/** Full-screen photo viewer with swipe-to-navigate (touch) and arrow-key navigation (desktop).
 *  Pinch-zoom is left to the browser's native handling via `touch-action: pinch-zoom` rather than
 *  a custom gesture implementation. */
export function PhotoLightbox({
  photos,
  index,
  onClose,
  onIndexChange,
}: {
  photos: AttachmentView[]
  index: number
  onClose: () => void
  onIndexChange: (i: number) => void
}) {
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const photo = photos[index]

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1))
      if (e.key === 'ArrowRight') onIndexChange(Math.min(photos.length - 1, index + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, photos.length, onClose, onIndexChange])

  if (!photo) return null

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX === null) return
    const dx = e.changedTouches[0].clientX - touchStartX
    if (Math.abs(dx) > 50) {
      if (dx > 0) onIndexChange(Math.max(0, index - 1))
      else onIndexChange(Math.min(photos.length - 1, index + 1))
    }
    setTouchStartX(null)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95"
      onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="flex shrink-0 items-center justify-between px-4 py-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="text-xs text-white/70">
          <span className="font-medium capitalize text-white">{photo.phase}</span>
          {' · '}
          {photo.uploader?.name ?? 'Unknown'} · {timeAgo(photo.createdAt)}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 items-center justify-center rounded-full text-white active:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1" style={{ touchAction: 'pinch-zoom' }}>
        <Image
          src={photo.url}
          alt={`${photo.phase} site photo`}
          fill
          sizes="100vw"
          className="object-contain"
          unoptimized
        />

        {index > 0 && (
          <button
            type="button"
            onClick={() => onIndexChange(index - 1)}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white sm:flex"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {index < photos.length - 1 && (
          <button
            type="button"
            onClick={() => onIndexChange(index + 1)}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white sm:flex"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      <div
        className="flex shrink-0 justify-center gap-1.5 py-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {photos.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-white' : 'bg-white/30'}`}
          />
        ))}
      </div>
    </div>
  )
}
