'use client'

import dynamic from 'next/dynamic'

export type { VolumePoint } from './charts'

/** recharts is ~314 KB raw / ~92 KB gzipped and is the bulk of `/dashboard`'s client JS. Both charts
 *  that pull it in sit in the second grid row, below the four StatCards carrying the numbers the
 *  page is opened for -- so eagerly importing it meant parsing and executing it before any of the
 *  above-the-fold content became interactive, to render something not yet on screen.
 *
 *  `ssr: false` because the chart is a client-only measured-layout component (`ResponsiveContainer`
 *  needs a real box), and because `next/dynamic`'s `ssr: false` is only legal inside a Client
 *  Component -- which is why this wrapper exists rather than a `dynamic()` call in `page.tsx`. The
 *  placeholder holds the chart's exact `h-64` box so nothing below it shifts.
 *
 *  The import MUST stay `'./charts'`, not `'./VolumeChart'`: that shared barrel is what keeps this
 *  and [PriorityBreakdown]'s wrapper in one chunk group. Importing the component directly here gives
 *  Turbopack two entry points and it duplicates recharts into both -- see charts.tsx's comment. */
export const VolumeChart = dynamic(() => import('./charts').then((m) => m.VolumeChart), {
  ssr: false,
  loading: () => (
    <div className="h-64 w-full animate-pulse rounded-lg bg-muted/20" aria-hidden="true" />
  ),
})
