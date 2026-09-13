'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { timeAgo } from '@/lib/utils'
import type { AttachmentView } from '@/lib/ticket-view'

/** Full-screen photo viewer with swipe-to-navigate (touch) and arrow-key navigation (desktop).
 *  Pinch-zoom is left to the browser's native handling via `touch-action: pinch-zoom` rather than
 *  a custom gesture implementation. On `sm`+ it shrinks to a centered ~65vw/80vh card over a
 *  dimmed backdrop instead of covering the whole screen -- a full-bleed viewer makes sense on a
 *  phone where the photo *is* the screen, but on desktop it reads as a jarring takeover rather
 *  than a lightbox. */
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
  const [mounted, setMounted] = useState(false)
  const photo = photos[index]

  // Portal to document.body: rendered inline this sits inside the ticket page's Card, which uses
  // `backdrop-blur-sm` -- a containing-block trigger for `position: fixed` descendants (same class
  // of bug documented in Sheet.tsx and fixed the same way in QuestionnaireEntry). Without the
  // portal, "fixed inset-0" ends up scoped to that Card instead of the viewport, so the lightbox
  // renders squeezed inside the page's main column instead of as a true overlay.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1))
      if (e.key === 'ArrowRight') onIndexChange(Math.min(photos.length - 1, index + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, photos.length, onClose, onIndexChange])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  if (!photo || !mounted) return null

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX === null) return
    const dx = e.changedTouches[0].clientX - touchStartX
    if (Math.abs(dx) > 50) {
      if (dx > 0) onIndexChange(Math.max(0, index - 1))
      else onIndexChange(Math.min(photos.length - 1, index + 1))
    }
    setTouchStartX(null)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background sm:items-center sm:justify-center sm:bg-black/50 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col sm:h-[min(80vh,860px)] sm:w-[min(70vw,1100px)] sm:flex-none sm:overflow-hidden sm:rounded-2xl sm:border sm:border-border sm:bg-background sm:shadow-2xl">
        <div
          className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <div className="text-xs text-muted">
            <span className="font-medium capitalize text-foreground">{photo.phase}</span>
            {' · '}
            {photo.uploader?.name ?? 'Unknown'} · {timeAgo(photo.createdAt)}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-strong transition-colors hover:bg-overlay-strong hover:text-foreground active:bg-overlay-strong sm:h-9 sm:w-9"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1 bg-overlay" style={{ touchAction: 'pinch-zoom' }}>
          <Image
            src={photo.url}
            alt={`${photo.phase} site photo`}
            fill
            sizes="(min-width: 640px) 70vw, 100vw"
            className="object-contain"
            unoptimized
          />

          {index > 0 && (
            <button
              type="button"
              onClick={() => onIndexChange(index - 1)}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 sm:flex"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {index < photos.length - 1 && (
            <button
              type="button"
              onClick={() => onIndexChange(index + 1)}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 sm:flex"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>

        <div
          className="flex shrink-0 justify-center gap-1.5 border-t border-border py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {photos.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-foreground' : 'bg-muted/40'}`}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
