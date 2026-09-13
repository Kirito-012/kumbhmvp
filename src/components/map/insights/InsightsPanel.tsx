'use client'

import type { ReactNode } from 'react'
import Panel from '@/components/map/Panel'
import {
  ChartBarIcon,
  GridIcon,
  SlidersIcon,
  TagIcon,
  TicketIcon,
  MapPinIcon,
} from '@/components/map/icons'
import type { MapMode } from '@/components/map/insights/ModeSwitcher'
import {
  useInsightTheme,
  ProgressRing,
  StackedStatusBar,
  Sparkline,
  bucketColor,
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
  children,
}: {
  title: string
  icon: ReactNode
  theme: keyof typeof SECTION_THEMES
  count?: number
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
        {count !== undefined && (
          <span
            className="ml-auto rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums"
            style={{ background: t.bg, color: t.text }}
          >
            {count}
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
          <InsightsHero
            mode={mode}
            sector={sector}
            insightsData={insightsData}
            filters={filters}
            sectors={sectors}
            theme={theme}
          />

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
          ) : (
            <>
              <StatusProgress
                sector={sector}
                insightsData={insightsData}
                filters={filters}
                theme={theme}
                detail={detail}
              />
              <Categories
                sector={sector}
                insightsData={insightsData}
                filters={filters}
                onFilterClassGroup={onFilterClassGroup}
              />
              <PriorityTrend
                sector={sector}
                insightsData={insightsData}
                filters={filters}
                detail={detail}
              />
            </>
          )}

          <Assignees detail={detail} loading={loading} error={error} onRetry={refetch} />

          <TicketListBlock
            sector={sector}
            detail={detail}
            statuses={insightsData.statuses}
            priorities={insightsData.priorities}
            onLocate={onLocate}
          />
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
  theme,
}: {
  mode: Exclude<MapMode, 'map'>
  sector: number | 'peripheral' | null
  insightsData: InsightsTicketData
  filters: InsightsFilters
  sectors: SectorSummary[]
  theme: ReturnType<typeof useInsightTheme>
}) {
  const scoped = scopeTuples(insightsData.tickets, sector)
  const totals = bucketTotals(scoped, insightsData.statuses)
  const total = scoped.length
  const resolvedPct = total > 0 ? Math.round(((totals.resolved + totals.closed) / total) * 100) : 0

  if (mode === 'tickets') {
    return (
      <div className="flex items-center gap-4">
        <ProgressRing percent={resolvedPct} label={`${resolvedPct}%`} sublabel="resolved" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px]" style={{ color: 'var(--map-fg-faint)' }}>
            {total.toLocaleString()} ticket{total === 1 ? '' : 's'}
          </p>
          <div className="mt-2">
            <StackedStatusBar counts={totals} total={total} />
          </div>
        </div>
      </div>
    )
  }

  // Heatmap hero -- rank/comparison only make sense for one specific numbered sector, since
  // "median" and "#N of 32" are both computed across sectors (PLAN-heatmap.md §6.2 item 1).
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

  const openCount =
    typeof sector === 'number' ? (allRollups.get(sector)?.open ?? 0) : totals.new + totals.progress
  const rank =
    typeof sector === 'number' ? opensByNamedSector.filter((v) => v > openCount).length + 1 : null

  return (
    <div>
      <p
        className="text-[30px] font-semibold leading-none tabular-nums"
        style={{ color: 'var(--map-fg)' }}
      >
        {openCount.toLocaleString()}
      </p>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--map-fg-faint)' }}>
        open tickets
      </p>
      {rank !== null && sectors.length > 0 && (
        <div
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          <span
            className="rounded-full px-1.5 py-0.5 font-semibold"
            style={{ background: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
          >
            #{rank} of {sectors.length} sectors
          </span>
          {median > 0 && <span>{(openCount / median).toFixed(1)}× the sector median</span>}
        </div>
      )}
      <div
        className="mt-2 h-1 w-8 rounded-full"
        style={{ background: bucketColor('progress', theme) }}
        aria-hidden
      />
    </div>
  )
}

function StatusProgress({
  sector,
  insightsData,
  filters,
  theme,
  detail,
}: {
  sector: number | 'peripheral' | null
  insightsData: InsightsTicketData
  filters: InsightsFilters
  theme: ReturnType<typeof useInsightTheme>
  detail: ReturnType<typeof useSectorInsights>['data']
}) {
  const filtered = scopeTuples(insightsData.tickets, sector).filter((t) =>
    matchesFilters(
      t,
      insightsData.statuses,
      insightsData.priorities,
      insightsData.classGroups,
      filters,
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
          return (
            <div
              key={bucket}
              className="rounded-lg border px-2 py-1.5"
              style={{ borderColor: 'var(--map-border)' }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: bucketColor(bucket, theme) }}
                  aria-hidden
                />
                <span className="truncate text-[10.5px]" style={{ color: 'var(--map-fg-faint)' }}>
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
            </div>
          )
        })}
      </div>

      <div
        className="mt-2.5 flex flex-col gap-1.5 text-[11.5px]"
        style={{ color: 'var(--map-fg-muted)' }}
      >
        <div className="flex items-center justify-between">
          <span>Median time to resolve</span>
          <span className="font-semibold tabular-nums" style={{ color: 'var(--map-fg)' }}>
            {detail?.medianResolveHours != null
              ? detail.medianResolveHours < 24
                ? `${Math.round(detail.medianResolveHours)}h`
                : `${(detail.medianResolveHours / 24).toFixed(1)}d`
              : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0">Oldest open</span>
          {detail?.oldestOpen ? (
            <a
              href={`/tickets/${detail.oldestOpen.number}`}
              className="truncate font-semibold underline-offset-2 hover:underline"
              style={{ color: 'var(--map-accent)' }}
              title={detail.oldestOpen.subject}
            >
              #{detail.oldestOpen.number} · {detail.oldestOpen.ageDays}d old
            </a>
          ) : (
            <span style={{ color: 'var(--map-fg-faint)' }}>None</span>
          )}
        </div>
      </div>
    </Section>
  )
}

function Categories({
  sector,
  insightsData,
  filters,
  onFilterClassGroup,
}: {
  sector: number | 'peripheral' | null
  insightsData: InsightsTicketData
  filters: InsightsFilters
  onFilterClassGroup: (classGroup: string) => void
}) {
  const filtered = scopeTuples(insightsData.tickets, sector).filter((t) =>
    matchesFilters(
      t,
      insightsData.statuses,
      insightsData.priorities,
      insightsData.classGroups,
      filters,
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
  const rows = Array.from(byClass.entries())
    .map(([name, counts]) => ({ name, ...counts, total: counts.open + counts.resolved }))
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

  return (
    <Section
      title="Categories"
      icon={<GridIcon className="h-full w-full" />}
      theme="teal"
      count={rows.length}
    >
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const color = CLASS_GROUP_COLORS[row.name] ?? CLASS_GROUP_COLORS.Other
          const active = filters.classGroups?.includes(row.name) ?? false
          return (
            <button
              key={row.name}
              type="button"
              onClick={() => onFilterClassGroup(row.name)}
              aria-pressed={active}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors"
              style={{ background: active ? 'var(--map-accent-bg)' : 'transparent' }}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: color }}
                aria-hidden
              />
              <span
                className="min-w-0 flex-1 truncate text-[11.5px]"
                style={{ color: 'var(--map-fg-muted)' }}
              >
                {row.name}
              </span>
              <span
                className="w-16 shrink-0 overflow-hidden rounded-full"
                style={{ height: 5, background: 'var(--map-border)' }}
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${row.total > 0 ? (row.open / row.total) * 100 : 0}%`,
                    background: color,
                  }}
                />
              </span>
              <span
                className="w-6 shrink-0 text-right text-[11px] tabular-nums"
                style={{ color: 'var(--map-fg-faint)' }}
              >
                {row.open}
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
}: {
  sector: number | 'peripheral' | null
  insightsData: InsightsTicketData
  filters: InsightsFilters
  detail: ReturnType<typeof useSectorInsights>['data']
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
          return (
            <div key={p.slug} className="flex items-center gap-2">
              <span
                className="w-14 shrink-0 truncate text-[10.5px]"
                style={{ color: 'var(--map-fg-faint)' }}
              >
                {p.name}
              </span>
              <span
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: 'var(--map-border)' }}
              >
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(count / max) * 100}%`, background: p.color }}
                />
              </span>
              <span
                className="w-5 shrink-0 text-right text-[10.5px] tabular-nums"
                style={{ color: 'var(--map-fg-muted)' }}
              >
                {count}
              </span>
            </div>
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
  detail,
  loading,
  error,
  onRetry,
}: {
  detail: ReturnType<typeof useSectorInsights>['data']
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
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
          No tickets assigned in this sector yet
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
  onLocate,
}: {
  sector: number | 'peripheral' | null
  detail: ReturnType<typeof useSectorInsights>['data']
  statuses: InsightsTicketData['statuses']
  priorities: InsightsTicketData['priorities']
  onLocate: (lng: number, lat: number) => void
}) {
  if (!detail) return null

  const listHref =
    typeof sector === 'number' ? `/tickets?sector=${sector}&status=open` : '/tickets?status=open'

  return (
    <Section
      title="Tickets"
      icon={<TicketIcon className="h-full w-full" />}
      theme="blue"
      count={detail.totalCount}
    >
      {detail.tickets.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: 'var(--map-fg-faint)' }}>
          No tickets in this scope.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {detail.tickets.map((t) => {
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
      {detail.truncated && (
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
