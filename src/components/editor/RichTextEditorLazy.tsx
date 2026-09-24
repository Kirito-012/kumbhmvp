'use client'

import dynamic from 'next/dynamic'

/** tiptap + prosemirror is ~385 KB raw / ~120 KB gzipped — on `/tickets/[number]` that was ~25% of
 *  the route's client JS for a comment box below the fold, and it blocked the initial bundle's parse
 *  before any of the ticket detail above it became interactive. Loading it as its own chunk keeps
 *  the editor's cost off the critical path; the skeleton below holds the same box so nothing shifts.
 *
 *  `ssr: false` matches the component's own `immediatelyRender: false` — tiptap has never rendered
 *  server-side here — and `next/dynamic`'s `ssr: false` is only legal in a Client Component, which
 *  is why this wrapper exists instead of a `dynamic()` call at each use site. */
export const RichTextEditor = dynamic(
  () => import('./RichTextEditor').then((m) => m.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div
        className="overflow-hidden rounded-lg border border-border-strong bg-overlay"
        aria-hidden="true"
      >
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-7 w-7 animate-pulse rounded-md bg-muted/30" />
          ))}
        </div>
        <div className="min-h-[140px] px-3 py-2.5" />
      </div>
    ),
  },
)
