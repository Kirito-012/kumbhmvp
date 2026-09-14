'use client'

import { useState, type ReactNode } from 'react'
import Panel from '@/components/map/Panel'
import {
  ChartBarIcon,
  GridIcon,
  SlidersIcon,
  TagIcon,
  TicketIcon,
  MapPinIcon,
  SearchIcon,
} from '@/components/map/icons'
import type { MapMode } from '@/components/map/insights/ModeSwitcher'
import {
  useInsightTheme,
  StatusBreakdownDonut,
  Sparkline,
  bucketColor,
  Reveal,
  AnimatedBar,
  pillEntranceDelayMs,
} from '@/components/map/insights/charts'
import { useSectorInsights } from '@/components/map/insights/useSectorInsights'
import {
  rollupBySector,
  isOpenTicket,
  matchesFilters,
  type InsightsFilters,
} from '@/lib/insights/aggregate'
import { BUCKET_ORDER, BUCKET_LABELS, type StatusBucket } from '@/lib/insights/statusBuckets'
import { CLASS_GROUP_COLORS } from '@/lib/classColors'
import {
  TicketField,
  type InsightsTicketData,
  type InsightsTicketTuple,
} from '@/lib/insights/types'
import { timeAgo } from '@/lib/utils'

type SectorSummary = { sector_no: number; name: string; area_hac: number }

function formatSectorLabel(sector: Pick<SectorSummary, 'sector_no' | 'name'>): string {
  const title = sector.name.replace(/-\d+$/, '')
  return `${String(sector.sector_no).padStart(2, '0')}. ${title}`
}

const SECTION_THEMES = {
  blue: { bg: 'var(--map-section-blue-bg)', text: 'var(--map-section-blue-fg)' },
  amber: { bg: 'var(--map-section-amber-bg)', text: 'var(--map-section-amber-fg)' },
  teal: { bg: 'var(--map-section-teal-bg)', text: 'var(--map-section-teal-fg)' },
  violet: { bg: 'var(--map-section-violet-bg)', text: 'var(--map-section-violet-fg)' },
} as const

function Section({
  title,
  icon,
  theme,
  count,
  action,
  children,
}: {
  title: string
  icon: ReactNode
  theme: keyof typeof SECTION_THEMES
  count?: number
  action?: ReactNode
  children: ReactNode
}) {
  const t = SECTION_THEMES[theme]
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
          style={{ background: t.bg, color: t.text }}
        >
          <span className="h-3 w-3">{icon}</span>
        </span>
        <h3
          className="text-[11.5px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          {title}
        </h3>
        {(action || count !== undefined) && (
          <span className="ml-auto flex items-center gap-1.5">
            {action}
            {count !== undefined && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums"
                style={{ background: t.bg, color: t.text }}
              >
                {count}
              </span>
            )}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function bucketTotals(
  tuples: InsightsTicketTuple[],
  statuses: InsightsTicketData['statuses'],
): Record<StatusBucket, number> {
  const totals: Record<StatusBucket, number> = { new: 0, progress: 0, resolved: 0, closed: 0 }
  for (const t of tuples) {
    const status = statuses[t[TicketField.StatusIdx]]
    if (status) totals[status.bucket]++
  }
  return totals
}

function scopeTuples(
  tickets: InsightsTicketTuple[],
  sector: number | 'peripheral' | null,
): InsightsTicketTuple[] {
  if (sector === null) return tickets
  if (sector === 'peripheral') return tickets.filter((t) => t[TicketField.SectorNo] === null)
  return tickets.filter((t) => t[TicketField.SectorNo] === sector)
}

export default function InsightsPanel({
  mode,
  sector,
  insightsData,
  filters,
  sectors,
  onFilterClassGroup,
  onClearClassGroups,
  onFilterPriority,
  onFilterStatusBucket,
  onClearFilters,
  onLocate,
  onWidthChange,
  forceCollapsed,
  onExpand,
  onCollapse,
}: {
  mode: Exclude<MapMode, 'map'>
  sector: number | 'peripheral' | null
  insightsData: InsightsTicketData | null
  filters: InsightsFilters
  sectors: SectorSummary[]
  onFilterClassGroup: (classGroup: string) => void
  onClearClassGroups: () => void
  onFilterPriority: (prioritySlug: string) => void
  onFilterStatusBucket: (bucket: StatusBucket) => void
  onClearFilters: () => void
  onLocate: (lng: number, lat: number) => void
  onWidthChange?: (width: number) => void
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
}) {
  const theme = useInsightTheme()
  const { data: detail, loading, error, refetch } = useSectorInsights(true, sector)

  const sectorRow =
    typeof sector === 'number' ? sectors.find((s) => s.sector_no === sector) : undefined
  const subtitle =
    sector === null
      ? 'All sectors'
      : sector === 'peripheral'
        ? 'Peripheral'
        : sectorRow
          ? formatSectorLabel(sectorRow)
          : `Sector ${sector}`

  const hasActiveFilters =
    (filters.statusSlugs?.length ?? 0) > 0 ||
    (filters.prioritySlugs?.length ?? 0) > 0 ||
    (filters.classGroups?.length ?? 0) > 0 ||
    filters.createdWithinMs !== undefined

  return (
    <Panel
      icon={<ChartBarIcon className="h-full w-full" />}
      title="Insights"
      subtitle={subtitle}
      side="right"
      entrance="slide"
      resizable
      defaultWidth={320}
      minWidth={260}
      maxWidth={640}
      onRenderedWidthChange={onWidthChange}
      forceCollapsed={forceCollapsed}
      onExpand={onExpand}
      onCollapse={onCollapse}
    >
      {!insightsData ? (
        <div
          className="flex items-center gap-2 py-6 text-[12.5px]"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2"
            style={{ borderColor: 'var(--map-switch-track)', borderTopColor: 'var(--map-accent)' }}
          />
          Loading insights…
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Reveal index={0}>
            <InsightsHero
              mode={mode}
              sector={sector}
              insightsData={insightsData}
              filters={filters}
              sectors={sectors}
              onFilterStatusBucket={onFilterStatusBucket}
            />
          </Reveal>

          {hasActiveFilters &&
          scopeTuples(insightsData.tickets, sector).filter((t) =>
            matchesFilters(
              t,
              insightsData.statuses,
              insightsData.priorities,
              insightsData.classGroups,
              filters,
            ),
          ).length === 0 ? (
            <Reveal index={1}>
              <div
                className="rounded-lg border border-dashed px-2.5 py-3 text-center text-[11.5px]"
                style={{ borderColor: 'var(--map-border)', color: 'var(--map-fg-faint)' }}
              >
                No tickets match these filters.{' '}
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="cursor-pointer font-semibold underline-offset-2 hover:underline"
                  style={{ color: 'var(--map-accent)' }}
                >
                  Clear
                </button>
              </div>
            </Reveal>
          ) : (
            <>
              <Reveal index={1}>
                <StatusProgress
                  sector={sector}
                  insightsData={insightsData}
                  filters={filters}
                  theme={theme}
                  onFilterStatusBucket={onFilterStatusBucket}
                />
              </Reveal>
              <Reveal index={2}>
                <Categories
                  sector={sector}
                  insightsData={insightsData}
                  filters={filters}
                  onFilterClassGroup={onFilterClassGroup}
                  onClearClassGroups={onClearClassGroups}
                />
              </Reveal>
              <Reveal index={3}>
                <PriorityTrend
                  sector={sector}
                  insightsData={insightsData}
                  filters={filters}
                  detail={detail}
                  onFilterPriority={onFilterPriority}
                />
              </Reveal>
            </>
          )}

          <Reveal index={4}>
            <Assignees
              sector={sector}
              detail={detail}
              loading={loading}
              error={error}
              onRetry={refetch}
            />
          </Reveal>

          <Reveal index={5}>
            <TicketListBlock
              sector={sector}
              detail={detail}
              statuses={insightsData.statuses}
              priorities={insightsData.priorities}
              filters={filters}
              onLocate={onLocate}
            />
          </Reveal>
        </div>
      )}
    </Panel>
  )
}

function InsightsHero({
  mode,
  sector,
  insightsData,
  filters,
  sectors,
  onFilterStatusBucket,
}: {
  mode: Exclude<MapMode, 'map'>
  sector: number | 'peripheral' | null
  insightsData: InsightsTicketData
  filters: InsightsFilters
  sectors: SectorSummary[]
  onFilterStatusBucket: (bucket: StatusBucket) => void
}) {
  // Ignores only the statusSlugs filter itself -- same reasoning and same filtersIgnoringStatus
  // shape as StatusProgress below, so the hero's donut/legend counts always stay in sync with the
  // Status & Progress tiles directly under it instead of the two disagreeing whenever a
  // category/priority/time filter is active (the hero used to ignore every filter, not just its
  // own dimension, so it went stale the moment any filter narrowed the ticket set).
  const filtersIgnoringStatus: InsightsFilters = { ...filters, statusSlugs: undefined }
  const scoped = scopeTuples(insightsData.tickets, sector).filter((t) =>
    matchesFilters(
      t,
      insightsData.statuses,
      insightsData.priorities,
      insightsData.classGroups,
      filtersIgnoringStatus,
    ),
  )
  const totals = bucketTotals(scoped, insightsData.statuses)
  const total = scoped.length

  // Same "which buckets does the active status filter cover" check as StatusProgress's per-tile
  // `active` below, computed once here so the donut can dim every non-matching wedge/legend row
  // together instead of re-deriving it per segment.
  const activeBuckets = new Set<StatusBucket>(
    BUCKET_ORDER.filter((bucket) => {
      const bucketSlugs = insightsData.statuses
        .filter((s) => s.bucket === bucket)
        .map((s) => s.slug)
      return (
        bucketSlugs.length > 0 && bucketSlugs.every((slug) => filters.statusSlugs?.includes(slug))
      )
    }),
  )

  // Heatmap-only rank/comparison, layered onto the same donut+bar hero Ticket mode uses -- both
  // modes share this component, so switching modes shouldn't change what the headline widget looks
  // like (only Heatmap adds the extra "#N of 32 sectors" row below it). Rank/median only make sense
  // for one specific numbered sector, since both are computed across sectors (PLAN-heatmap.md
  // §6.2 item 1).
  let rankInfo: { rank: number; ofCount: number; ratioToMedian: number | null } | null = null
  if (mode === 'heatmap' && typeof sector === 'number') {
    const allRollups = rollupBySector(
      insightsData.tickets,
      insightsData.statuses,
      insightsData.priorities,
      insightsData.classGroups,
      filters,
    )
    const opensByNamedSector = sectors.map((s) => allRollups.get(s.sector_no)?.open ?? 0)
    const sortedOpens = [...opensByNamedSector].sort((a, b) => b - a)
    const mid = Math.floor(sortedOpens.length / 2)
    const median =
      sortedOpens.length === 0
        ? 0
        : sortedOpens.length % 2 === 0
          ? (sortedOpens[mid - 1] + sortedOpens[mid]) / 2
          : sortedOpens[mid]
    const openCount = allRollups.get(sector)?.open ?? 0
    const rank = opensByNamedSector.filter((v) => v > openCount).length + 1
    rankInfo = {
      rank,
      ofCount: sectors.length,
      ratioToMedian: median > 0 ? openCount / median : null,
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <StatusBreakdownDonut
        counts={totals}
        total={total}
        activeBuckets={activeBuckets}
        onSelect={onFilterStatusBucket}
      />
      {rankInfo && rankInfo.ofCount > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          <span
            className="rounded-full px-1.5 py-0.5 font-semibold"
            style={{ background: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
          >
            #{rankInfo.rank} of {rankInfo.ofCount} sectors
          </span>
          {rankInfo.ratioToMedian !== null && (
            <span>{rankInfo.ratioToMedian.toFixed(1)}× the sector median (open tickets)</span>
          )}
        </div>
      )}
    </div>
  )
}

function StatusProgress({
  sector,
  insightsData,
  filters,
  theme,
  onFilterStatusBucket,
}: {
  sector: number | 'peripheral' | null
  insightsData: InsightsTicketData
  filters: InsightsFilters
  theme: ReturnType<typeof useInsightTheme>
  onFilterStatusBucket: (bucket: StatusBucket) => void
}) {
  // Deliberately ignores the statusSlugs filter itself (though not the other
  // filter types, or sector scope) when building this section's own counts --
  // same "always show all rows, highlight the active one" reasoning as
  // Categories ignoring classGroups, so clicking one bucket doesn't make the
  // other three disappear.
  const filtersIgnoringStatus: InsightsFilters = { ...filters, statusSlugs: undefined }
  const filtered = scopeTuples(insightsData.tickets, sector).filter((t) =>
    matchesFilters(
      t,
      insightsData.statuses,
      insightsData.priorities,
      insightsData.classGroups,
      filtersIgnoringStatus,
    ),
  )
  const totals = bucketTotals(filtered, insightsData.statuses)
  const total = filtered.length

  return (
    <Section
      title="Status & progress"
      icon={<ChartBarIcon className="h-full w-full" />}
      theme="blue"
    >
      <div className="grid grid-cols-2 gap-1.5">
        {BUCKET_ORDER.map((bucket) => {
          const count = totals[bucket]
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          const bucketSlugs = insightsData.statuses
            .filter((s) => s.bucket === bucket)
            .map((s) => s.slug)
          const active =
            bucketSlugs.length > 0 &&
            bucketSlugs.every((slug) => filters.statusSlugs?.includes(slug))
          const color = bucketColor(bucket, theme)
          const tint = `color-mix(in srgb, ${color} var(--map-row-tint-pct), transparent)`
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => onFilterStatusBucket(bucket)}
              aria-pressed={active}
              title={`${active ? 'Clear' : 'Filter to'} ${BUCKET_LABELS[bucket]}`}
              className="relative cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors"
              style={{
                borderColor: active ? color : 'var(--map-border)',
                background: active ? tint : 'transparent',
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: color }}
                  aria-hidden
                />
                <span
                  className={`truncate text-[10.5px] ${active ? 'font-semibold' : ''}`}
                  style={{ color: active ? 'var(--map-fg)' : 'var(--map-fg-faint)' }}
                >
                  {BUCKET_LABELS[bucket]}
                </span>
              </div>
              <p
                className="mt-0.5 text-[15px] font-semibold tabular-nums"
                style={{ color: 'var(--map-fg)' }}
              >
                {count}
                <span
                  className="ml-1 text-[10.5px] font-normal"
                  style={{ color: 'var(--map-fg-faint)' }}
                >
                  {pct}%
                </span>
              </p>
            </button>
          )
        })}
      </div>
    </Section>
  )
}

function Categories({
  sector,
  insightsData,
  filters,
  onFilterClassGroup,
  onClearClassGroups,
}: {
  sector: number | 'peripheral' | null
  insightsData: InsightsTicketData
  filters: InsightsFilters
  onFilterClassGroup: (classGroup: string) => void
  onClearClassGroups: () => void
}) {
  // Deliberately ignores the classGroups filter itself (though not the other
  // filter types, or sector scope) when building the row list -- so
  // selecting a category highlights it without making every other category
  // disappear from the list, matching the "always show all rows, highlight
  // the active one" pattern in the plain-map Stats panel's ClassAreaTable.
  const filtersIgnoringClassGroups: InsightsFilters = { ...filters, classGroups: undefined }
  const filtered = scopeTuples(insightsData.tickets, sector).filter((t) =>
    matchesFilters(
      t,
      insightsData.statuses,
      insightsData.priorities,
      insightsData.classGroups,
      filtersIgnoringClassGroups,
    ),
  )

  const byClass = new Map<string, { open: number; resolved: number }>()
  for (const t of filtered) {
    const cls = insightsData.classGroups[t[TicketField.ClassGroupIdx]] ?? 'Other'
    const entry = byClass.get(cls) ?? { open: 0, resolved: 0 }
    if (isOpenTicket(t, insightsData.statuses)) entry.open++
    else entry.resolved++
    byClass.set(cls, entry)
  }
  // Once a sector or a status/priority/time filter narrows the data, a category with 0 tickets in
  // that scope is just noise (an invisible zero-width bar padding out the scroll) -- keep zero rows
  // only in the fully unfiltered "All sectors" overview, where they still show the full category
  // taxonomy at a glance.
  const otherFiltersActive =
    (filters.statusSlugs?.length ?? 0) > 0 ||
    (filters.prioritySlugs?.length ?? 0) > 0 ||
    filters.createdWithinMs !== undefined
  const showZeroRows = sector === null && !otherFiltersActive
  const rows = Array.from(byClass.entries())
    .map(([name, counts]) => ({ name, ...counts, total: counts.open + counts.resolved }))
    .filter((r) => showZeroRows || r.total > 0)
    .sort((a, b) => b.open - a.open)

  if (rows.length === 0) {
    return (
      <Section title="Categories" icon={<GridIcon className="h-full w-full" />} theme="teal">
        <p className="text-[11.5px]" style={{ color: 'var(--map-fg-faint)' }}>
          No category data.
        </p>
      </Section>
    )
  }

  const selectedCount = filters.classGroups?.length ?? 0

  return (
    <Section
      title="Categories"
      icon={<GridIcon className="h-full w-full" />}
      theme="teal"
      count={rows.length}
      action={
        selectedCount > 1 ? (
          <button
            type="button"
            onClick={onClearClassGroups}
            className="cursor-pointer text-[10.5px] font-semibold underline-offset-2 hover:underline"
            style={{ color: 'var(--map-accent)' }}
          >
            Clear
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const color = CLASS_GROUP_COLORS[row.name] ?? CLASS_GROUP_COLORS.Other
          const active = filters.classGroups?.includes(row.name) ?? false
          const rowTint = `color-mix(in srgb, ${color} var(--map-row-tint-pct), transparent)`
          return (
            <button
              key={row.name}
              type="button"
              onClick={() => onFilterClassGroup(row.name)}
              aria-pressed={active}
              title={`${active ? 'Clear' : 'Filter to'} ${row.name}`}
              className="relative flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors"
              style={{ background: active ? rowTint : 'transparent' }}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1 left-0 w-[3px] rounded-full"
                  style={{ background: color }}
                />
              )}
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: color }}
                aria-hidden
              />
              <span
                className={`min-w-0 flex-1 truncate text-[11.5px] ${active ? 'font-semibold' : ''}`}
                style={{ color: active ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
              >
                {row.name}
              </span>
              <AnimatedBar
                percent={row.total > 0 ? (row.open / row.total) * 100 : 0}
                fill={color}
                height={5}
                trackClassName="w-16 shrink-0"
                delayMs={pillEntranceDelayMs(2)}
              />
              <span
                className="w-6 shrink-0 text-right text-[11px] tabular-nums"
                style={{ color: 'var(--map-fg-faint)' }}
                title={`${row.open} open · ${row.resolved} resolved`}
              >
                {row.total}
              </span>
            </button>
          )
        })}
      </div>
    </Section>
  )
}

function PriorityTrend({
  sector,
  insightsData,
  filters,
  detail,
  onFilterPriority,
}: {
  sector: number | 'peripheral' | null
  insightsData: InsightsTicketData
  filters: InsightsFilters
  detail: ReturnType<typeof useSectorInsights>['data']
  onFilterPriority: (prioritySlug: string) => void
}) {
  const filtered = scopeTuples(insightsData.tickets, sector).filter(
    (t) =>
      matchesFilters(
        t,
        insightsData.statuses,
        insightsData.priorities,
        insightsData.classGroups,
        filters,
      ) && isOpenTicket(t, insightsData.statuses),
  )
  const byPriority = new Map<string, number>()
  for (const t of filtered) {
    const p = insightsData.priorities[t[TicketField.PriorityIdx]]
    if (!p) continue
    byPriority.set(p.slug, (byPriority.get(p.slug) ?? 0) + 1)
  }
  const rows = [...insightsData.priorities].sort((a, b) => b.order - a.order)
  const max = Math.max(1, ...rows.map((p) => byPriority.get(p.slug) ?? 0))

  return (
    <Section
      title="Priority & trend"
      icon={<SlidersIcon className="h-full w-full" />}
      theme="amber"
    >
      <div className="flex flex-col gap-1">
        {rows.map((p) => {
          const count = byPriority.get(p.slug) ?? 0
          const active = filters.prioritySlugs?.includes(p.slug) ?? false
          return (
            <button
              key={p.slug}
              type="button"
              onClick={() => onFilterPriority(p.slug)}
              aria-pressed={active}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors"
              style={{ background: active ? 'var(--map-accent-bg)' : 'transparent' }}
            >
              <span
                className="w-14 shrink-0 truncate text-[10.5px]"
                style={{ color: 'var(--map-fg-faint)' }}
              >
                {p.name}
              </span>
              <AnimatedBar
                percent={(count / max) * 100}
                fill={p.color}
                height={6}
                trackClassName="flex-1"
                delayMs={pillEntranceDelayMs(3)}
              />
              <span
                className="w-5 shrink-0 text-right text-[10.5px] tabular-nums"
                style={{ color: 'var(--map-fg-muted)' }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {detail && detail.trend7d.some((d) => d.created > 0 || d.resolved > 0) ? (
        <div className="mt-3">
          <div
            className="mb-1 flex items-center gap-3 text-[10px]"
            style={{ color: 'var(--map-fg-faint)' }}
          >
            <span className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--map-accent)' }}
              />{' '}
              Created
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--map-mode-tickets)' }}
              />{' '}
              Resolved
            </span>
            <span className="ml-auto">Last 7 days</span>
          </div>
          <Sparkline data={detail.trend7d} />
        </div>
      ) : (
        detail && (
          <p className="mt-2 text-[10.5px]" style={{ color: 'var(--map-fg-faint)' }}>
            No activity in the last 7 days.
          </p>
        )
      )}
    </Section>
  )
}

function Assignees({
  sector,
  detail,
  loading,
  error,
  onRetry,
}: {
  sector: number | 'peripheral' | null
  detail: ReturnType<typeof useSectorInsights>['data']
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const scopeLabel =
    sector === null ? '' : sector === 'peripheral' ? ' in the peripheral area' : ' in this sector'
  return (
    <Section title="Assignees" icon={<TagIcon className="h-full w-full" />} theme="violet">
      {loading && !detail ? (
        <SkeletonLines count={2} />
      ) : error && !detail ? (
        <ErrorRow message={error} onRetry={onRetry} />
      ) : detail && detail.assignees.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {detail.assignees.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[11.5px]">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
                style={{ background: 'var(--map-surface-active)', color: 'var(--map-fg-muted)' }}
                aria-hidden
              >
                {a.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--map-fg-muted)' }}>
                {a.name}
              </span>
              <span className="tabular-nums font-semibold" style={{ color: 'var(--map-fg)' }}>
                {a.open}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11.5px]" style={{ color: 'var(--map-fg-faint)' }}>
          No open tickets have an assignee{scopeLabel} yet
        </p>
      )}
    </Section>
  )
}

function TicketListBlock({
  sector,
  detail,
  statuses,
  priorities,
  filters,
  onLocate,
}: {
  sector: number | 'peripheral' | null
  detail: ReturnType<typeof useSectorInsights>['data']
  statuses: InsightsTicketData['statuses']
  priorities: InsightsTicketData['priorities']
  filters: InsightsFilters
  onLocate: (lng: number, lat: number) => void
}) {
  const [query, setQuery] = useState('')

  if (!detail) return null

  const listHref =
    typeof sector === 'number' ? `/tickets?sector=${sector}&status=open` : '/tickets?status=open'

  // The per-sector fetch (useSectorInsights) only scopes by sector, so without this the list kept
  // showing every ticket in the sector even after Categories/Priority & Trend/Status & Progress
  // narrowed everything else in the panel down. createdWithinMs is skipped -- SectorTicketRow has
  // no createdAt to filter on.
  const scopedTickets = detail.tickets.filter((t) => {
    if (
      filters.statusSlugs &&
      filters.statusSlugs.length > 0 &&
      !filters.statusSlugs.includes(t.statusSlug)
    )
      return false
    if (
      filters.prioritySlugs &&
      filters.prioritySlugs.length > 0 &&
      !filters.prioritySlugs.includes(t.prioritySlug)
    )
      return false
    if (
      filters.classGroups &&
      filters.classGroups.length > 0 &&
      !filters.classGroups.includes(t.classGroup)
    )
      return false
    return true
  })

  const q = query.trim().toLowerCase()
  const filteredTickets = q
    ? scopedTickets.filter(
        (t) => String(t.number).includes(q) || t.subject.toLowerCase().includes(q),
      )
    : scopedTickets

  const hasActiveListFilter =
    q.length > 0 ||
    (filters.statusSlugs?.length ?? 0) > 0 ||
    (filters.prioritySlugs?.length ?? 0) > 0 ||
    (filters.classGroups?.length ?? 0) > 0

  return (
    <Section
      title="Tickets"
      icon={<TicketIcon className="h-full w-full" />}
      theme="blue"
      count={hasActiveListFilter ? filteredTickets.length : detail.totalCount}
    >
      <div className="relative mb-2">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--map-fg-faint)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by ID or title…"
          aria-label="Search tickets by ID or title"
          className="w-full rounded-lg border py-1.5 pl-8 pr-2.5 text-[11.5px] outline-none transition-shadow placeholder:text-[var(--map-fg-faint)] focus:border-[var(--map-accent)] focus:ring-2 focus:ring-[var(--map-accent)]/25"
          style={{
            borderColor: 'var(--map-border)',
            background: 'var(--map-input-bg)',
            color: 'var(--map-fg)',
          }}
        />
      </div>
      {filteredTickets.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: 'var(--map-fg-faint)' }}>
          {hasActiveListFilter
            ? 'No tickets match the current filters.'
            : 'No tickets in this scope.'}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {filteredTickets.map((t) => {
            const status = statuses.find((s) => s.slug === t.statusSlug)
            const priority = priorities.find((p) => p.slug === t.prioritySlug)
            return (
              <div
                key={t.number}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-[var(--map-surface-hover)]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: priority?.color ?? 'var(--map-fg-faint)' }}
                  title={priority?.name}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-[11px] font-semibold tabular-nums"
                      style={{ color: 'var(--map-fg-faint)' }}
                    >
                      #{t.number}
                    </span>
                    <span className="truncate text-[11.5px]" style={{ color: 'var(--map-fg)' }}>
                      {t.subject}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {status && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold"
                        style={{
                          background: `color-mix(in srgb, ${status.color} 20%, transparent)`,
                          color: status.color,
                        }}
                      >
                        {status.name}
                      </span>
                    )}
                    <span className="text-[10px]" style={{ color: 'var(--map-fg-faint)' }}>
                      {timeAgo(t.lastActivityAt)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onLocate(t.lng, t.lat)}
                  title="Locate on map"
                  aria-label={`Locate ticket #${t.number} on map`}
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-[var(--map-surface-active)]"
                  style={{ color: 'var(--map-fg-faint)' }}
                >
                  <MapPinIcon className="h-3.5 w-3.5" />
                </button>
                <a
                  href={`/tickets/${t.number}`}
                  title="Open ticket"
                  className="shrink-0 text-[10.5px] font-semibold underline-offset-2 hover:underline"
                  style={{ color: 'var(--map-accent)' }}
                >
                  Open
                </a>
              </div>
            )
          })}
        </div>
      )}
      {!hasActiveListFilter && detail.truncated && (
        <a
          href={listHref}
          className="mt-2 block text-[11px] font-semibold underline-offset-2 hover:underline"
          style={{ color: 'var(--map-accent)' }}
        >
          Showing 200 of {detail.totalCount} — open in ticket list →
        </a>
      )}
    </Section>
  )
}

function SkeletonLines({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-3.5 animate-pulse rounded"
          style={{ background: 'var(--map-surface-active)', width: `${70 - i * 12}%` }}
        />
      ))}
    </div>
  )
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="flex items-center gap-2 border-l-2 py-1 pl-2 text-[11px]"
      style={{ borderColor: 'var(--danger)', color: 'var(--map-fg-faint)' }}
    >
      <span>Couldn&apos;t load: {message}</span>
      <button
        type="button"
        onClick={onRetry}
        style={{ color: 'var(--map-accent)' }}
        className="cursor-pointer font-semibold underline-offset-2 hover:underline"
      >
        Retry
      </button>
    </div>
  )
}
