'use client'

/**
 * The single recharts entry point for `/dashboard`.
 *
 * `VolumeChartLazy` and `PriorityBreakdownLazy` both `import('./charts')` — the *same* module
 * specifier — so Turbopack gives them one async chunk group and emits recharts once.
 *
 * This file exists because of a real regression. The first version of those wrappers each did
 * `import('./VolumeChart')` / `import('./PriorityBreakdown')` directly: two independent dynamic
 * entry points, each pulling recharts, which Turbopack duplicated into both chunk groups —
 * 314 KB raw / 92 KB gzipped of recharts twice, plus duplicated support chunks. Both components
 * render unconditionally (`dashboard/page.tsx`), so both copies were fetched on every load. First
 * paint got cheaper, but total bytes for the page went *up* — 563 KB raw before the split, 884 KB
 * after. Routing both through one module restores the intended win: ~401 KB raw / ~120 KB gz of
 * lazy JS instead of 715 / 212.
 *
 * `src/components/map/insights/charts.tsx` already worked this way by accident — all four map mode
 * panels resolve recharts through that one module, which is why the map route only ever had one
 * copy. This is the same shape, made deliberate.
 *
 * Keep it a barrel: adding real component code here would pull it into whichever chunk group loads
 * first and make the boundary harder to reason about. New recharts-based dashboard charts should be
 * re-exported from here rather than given their own `dynamic()` import.
 */
export { VolumeChart } from './VolumeChart'
export { PriorityBreakdown } from './PriorityBreakdown'
export type { VolumePoint } from './VolumeChart'
export type { PriorityBreakdownEntry } from './PriorityBreakdown'
