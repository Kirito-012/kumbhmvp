'use client'

import dynamic from 'next/dynamic'

export type { PriorityBreakdownEntry } from './charts'

/** Lazy for the same reason as [VolumeChart]'s wrapper -- see VolumeChartLazy.tsx. The placeholder
 *  mirrors the component's own wrapping flex row with its `h-40 w-40` donut, so the card keeps its
 *  height while the recharts chunk loads.
 *
 *  As with that wrapper, the import must stay `'./charts'` so both charts share one recharts copy. */
export const PriorityBreakdown = dynamic(
  () => import('./charts').then((m) => m.PriorityBreakdown),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4"
        aria-hidden="true"
      >
        <div className="h-40 w-40 shrink-0 animate-pulse rounded-full bg-muted/20" />
        <div className="min-w-[11rem] flex-1 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-5 w-full animate-pulse rounded bg-muted/20" />
          ))}
        </div>
      </div>
    ),
  },
)
