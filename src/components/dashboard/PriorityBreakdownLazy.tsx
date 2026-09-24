'use client'

import dynamic from 'next/dynamic'

export type { PriorityBreakdownEntry } from './charts'

/** Lazy for the same reason as [VolumeChart]'s wrapper -- see VolumeChartLazy.tsx. The placeholder
 *  mirrors the component's own `flex items-center gap-6` row with its `h-36 w-36` donut, so the
 *  card keeps its height while the recharts chunk loads.
 *
 *  As with that wrapper, the import must stay `'./charts'` so both charts share one recharts copy. */
export const PriorityBreakdown = dynamic(
  () => import('./charts').then((m) => m.PriorityBreakdown),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center gap-6" aria-hidden="true">
        <div className="h-36 w-36 shrink-0 animate-pulse rounded-full bg-muted/20" />
        <div className="flex-1 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-muted/20" />
          ))}
        </div>
      </div>
    ),
  },
)
