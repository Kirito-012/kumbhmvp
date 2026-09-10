'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Full-screen on mobile, a large centered modal on desktop. Used for anything a Surveyor fills
 *  in on a phone (the questionnaire) where an inline card would be unusable at small widths. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  subheader,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /** An optional sticky bar (e.g. a progress indicator) rendered between the title bar and the
   *  scrollable body, outside the body's own padding — so a sticky element inside it can use a
   *  plain `sticky top-0` instead of a fragile negative offset hand-tuned to cancel out the
   *  body's padding. */
  subheader?: React.ReactNode
  footer?: React.ReactNode
}) {
  // Portal to document.body: rendered inline, this sheet would sit inside the ticket page's
  // <main>, which carries a CSS animation (animate-fade-in) that includes a `transform` keyframe.
  // Any transformed ancestor becomes the containing block for a `position: fixed` descendant per
  // the CSS spec, so without the portal the "full-screen" overlay ends up positioned relative to
  // <main> instead of the viewport — it renders partway down the page with the underlying content
  // bleeding through, and the sticky footer sticks to the wrong box. Portaling to body sidesteps
  // the whole class of ancestor-transform/filter/backdrop-blur containment issues, which is the
  // standard fix for any modal/sheet in a page that (now or later) uses a transform anywhere
  // above it in the tree.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // document.body doesn't exist during SSR, so the portal target can only be resolved after
    // client hydration — there's no render-time equivalent of this check (unlike the
    // QuestionnaireForm transitions elsewhere in this feature), so this is a genuine one-shot
    // sync-with-the-DOM-environment effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-center bg-black/50 sm:items-center sm:p-4">
      <div
        className={cn(
          'flex h-full w-full flex-col bg-background sm:h-[min(90vh,900px)] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-border',
        )}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-strong active:bg-overlay-strong"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {subheader}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {children}
        </div>

        {footer && (
          <div
            className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-5"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
