'use client'

import { Children, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * Shows the first `initial` items of a grid and a full-width button that reveals the rest. The items
 * are rendered on the server and passed in as children, so only this toggle ships as client code.
 * Collapsing scrolls the panel back into view so the reader isn't left far down the page.
 */
export function ExpandableGrid({
  children,
  initial,
  noun,
  className,
}: {
  children: React.ReactNode
  initial: number
  /** Plural noun for the button, e.g. "heads". */
  noun: string
  className?: string
}) {
  const items = Children.toArray(children)
  const [open, setOpen] = useState(false)
  const top = useRef<HTMLDivElement>(null)
  const hidden = items.length - initial

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (!next) {
      requestAnimationFrame(() => {
        const el = top.current
        if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
      })
    }
  }

  return (
    <div ref={top} className="scroll-mt-24">
      <ul className={className}>{open ? items : items.slice(0, initial)}</ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="mt-4 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--dash-card-border)] px-4 text-base font-semibold text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {open ? `Show fewer ${noun}` : `Show all ${items.length} ${noun} (${hidden} more)`}
          {open ? (
            <ChevronUp className="h-5 w-5" aria-hidden />
          ) : (
            <ChevronDown className="h-5 w-5" aria-hidden />
          )}
        </button>
      )}
    </div>
  )
}
