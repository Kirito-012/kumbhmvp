import { isOpenBucket, type StatusBucket } from './statusBuckets'
import { TicketField, type InsightsStatusRow, type InsightsTicketTuple } from './types'

export type HeatMetric = 'open' | 'pctOpen' | 'total' | 'perHectare'

export type InsightsFilters = {
  statusSlugs?: string[]
  prioritySlugs?: string[]
  classGroups?: string[]
  /** Only tickets created within this many ms of "now" (e.g. 7d in ms). Omit for no time filter. */
  createdWithinMs?: number
}

export type SectorRollup = {
  sectorNo: number | null
  total: number
  open: number
  resolved: number
  closed: number
  newCount: number
  progressCount: number
}

function emptyRollup(sectorNo: number | null): SectorRollup {
  return { sectorNo, total: 0, open: 0, resolved: 0, closed: 0, newCount: 0, progressCount: 0 }
}

/** True if `tuple` is still open (bucket 'new' or 'progress') per its status row. Out-of-range
 *  status indices (shouldn't happen, but tuples are server-trusted integers) count as not open. */
export function isOpenTicket(tuple: InsightsTicketTuple, statuses: InsightsStatusRow[]): boolean {
  const status = statuses[tuple[TicketField.StatusIdx]]
  return status !== undefined && isOpenBucket(status.bucket)
}

export function matchesFilters(
  tuple: InsightsTicketTuple,
  statuses: InsightsStatusRow[],
  priorities: { slug: string }[],
  classGroups: string[],
  filters: InsightsFilters,
  now: number,
): boolean {
  if (filters.statusSlugs && filters.statusSlugs.length > 0) {
    const status = statuses[tuple[TicketField.StatusIdx]]
    if (!status || !filters.statusSlugs.includes(status.slug)) return false
  }
  if (filters.prioritySlugs && filters.prioritySlugs.length > 0) {
    const priority = priorities[tuple[TicketField.PriorityIdx]]
    if (!priority || !filters.prioritySlugs.includes(priority.slug)) return false
  }
  if (filters.classGroups && filters.classGroups.length > 0) {
    const classGroup = classGroups[tuple[TicketField.ClassGroupIdx]]
    if (!classGroup || !filters.classGroups.includes(classGroup)) return false
  }
  if (filters.createdWithinMs !== undefined) {
    const createdAt = tuple[TicketField.CreatedAt]
    if (now - createdAt > filters.createdWithinMs) return false
  }
  return true
}

/**
 * Groups tickets by sector (null key = peripheral, i.e. location.sectorNo is null) and counts
 * per status bucket, after applying `filters`. Pure and client-side -- runs against the single
 * bulk fetch from /api/insights/tickets, per PLAN-heatmap.md §3.3's "fetch once, filter locally"
 * decision so filter/metric changes are instant.
 */
export function rollupBySector(
  tickets: InsightsTicketTuple[],
  statuses: InsightsStatusRow[],
  priorities: { slug: string }[],
  classGroups: string[],
  filters: InsightsFilters = {},
  now: number = Date.now(),
): Map<number | null, SectorRollup> {
  const rollups = new Map<number | null, SectorRollup>()

  for (const tuple of tickets) {
    if (!matchesFilters(tuple, statuses, priorities, classGroups, filters, now)) continue

    const sectorNo = tuple[TicketField.SectorNo]
    let rollup = rollups.get(sectorNo)
    if (!rollup) {
      rollup = emptyRollup(sectorNo)
      rollups.set(sectorNo, rollup)
    }

    rollup.total++
    const status = statuses[tuple[TicketField.StatusIdx]]
    if (status) {
      switch (status.bucket) {
        case 'new':
          rollup.newCount++
          rollup.open++
          break
        case 'progress':
          rollup.progressCount++
          rollup.open++
          break
        case 'resolved':
          rollup.resolved++
          break
        case 'closed':
          rollup.closed++
          break
      }
    }
  }

  return rollups
}

/** A parcel's ticket bucket, plus 'muted' for a ticket that exists but fails the active filters --
 *  Ticket mode draws a muted parcel as a faint slate wash rather than dropping it back to
 *  "no data", so the plan layout never breaks up when a filter is toggled (PLAN-heatmap.md §5.3). */
export type SectorPlanBucket = StatusBucket | 'muted'

/**
 * Maps every located ticket's sectorPlanId to the bucket its feature-state fill should show.
 * Pure and client-side, same "fetch once, filter locally" reasoning as rollupBySector -- Ticket
 * mode's recolour-on-filter-change has to stay instant (PLAN-heatmap.md §9: ~3.6k parcels, must
 * recolour in one frame), so this is the thing MapView diffs against the previous call's result
 * before touching any feature-state.
 */
export function bucketBySectorPlanId(
  tickets: InsightsTicketTuple[],
  statuses: InsightsStatusRow[],
  priorities: { slug: string }[],
  classGroups: string[],
  filters: InsightsFilters = {},
  now: number = Date.now(),
): Map<number, SectorPlanBucket> {
  const result = new Map<number, SectorPlanBucket>()
  for (const tuple of tickets) {
    const status = statuses[tuple[TicketField.StatusIdx]]
    const matches = matchesFilters(tuple, statuses, priorities, classGroups, filters, now)
    result.set(
      tuple[TicketField.SectorPlanId],
      !status ? 'muted' : matches ? status.bucket : 'muted',
    )
  }
  return result
}

/** Reduces a sector's rollup to the single number the active heat metric colours it by.
 *  `areaHectares` is required for 'perHectare' and ignored otherwise (pass 0 if unknown). */
export function heatValueForSector(
  rollup: SectorRollup | undefined,
  metric: HeatMetric,
  areaHectares: number,
): number {
  if (!rollup || rollup.total === 0) return 0
  switch (metric) {
    case 'open':
      return rollup.open
    case 'pctOpen':
      return (rollup.open / rollup.total) * 100
    case 'total':
      return rollup.total
    case 'perHectare':
      return areaHectares > 0 ? rollup.total / areaHectares : 0
  }
}
