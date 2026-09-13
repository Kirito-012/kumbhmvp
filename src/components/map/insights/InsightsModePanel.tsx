'use client'

import type { ReactNode } from 'react'
import Panel from '@/components/map/Panel'
import { FlameIcon, TicketIcon } from '@/components/map/icons'
import type { MapMode } from '@/components/map/insights/ModeSwitcher'
import { useInsightTheme } from '@/components/map/insights/charts'
import {
  rollupBySector,
  heatValueForSector,
  type HeatMetric,
  type InsightsFilters,
} from '@/lib/insights/aggregate'
import { computeQuantileBreaks, colorForValue, buildLegend } from '@/lib/insights/heatScale'
import {
  BUCKET_ORDER,
  BUCKET_LABELS,
  BUCKET_COLORS,
  type StatusBucket,
} from '@/lib/insights/statusBuckets'
import { CLASS_GROUP_COLORS } from '@/lib/classColors'
import type { InsightsTicketData } from '@/lib/insights/types'
import { timeAgo } from '@/lib/utils'

type SectorSummary = { sector_no: number; name: string; area_hac: number }

// Same "NN. Title" formatting as MapView's own (module-private) formatSectorLabel -- small enough
// to duplicate rather than export/thread through props just for this.
function formatSectorLabel(sector: Pick<SectorSummary, 'sector_no' | 'name'>): string {
  const title = sector.name.replace(/-\d+$/, '')
  return `${String(sector.sector_no).padStart(2, '0')}. ${title}`
}

const METRIC_OPTIONS: { value: HeatMetric; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'pctOpen', label: '% open' },
  { value: 'total', label: 'Total' },
  { value: 'perHectare', label: 'Per ha' },
]

const CREATED_OPTIONS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: 'Any' },
  { value: 24 * 3_600_000, label: '24h' },
  { value: 7 * 86_400_000, label: '7d' },
  { value: 30 * 86_400_000, label: '30d' },
]

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors"
      style={
        active
          ? {
              borderColor: color ?? 'var(--map-accent)',
              background: color
                ? `color-mix(in srgb, ${color} 18%, transparent)`
                : 'var(--map-accent-bg)',
              color: 'var(--map-fg)',
            }
          : {
              borderColor: 'var(--map-border)',
              color: 'var(--map-fg-muted)',
            }
      }
    >
      {color && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      )}
      {children}
    </button>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3
      className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
      style={{ color: 'var(--map-fg-faint)' }}
    >
      {children}
    </h3>
  )
}

export default function InsightsModePanel({
  mode,
  insightsData,
  loading,
  error,
  onRefresh,
  sectors,
  heatMetric,
  onHeatMetricChange,
  filters,
  onFiltersChange,
  selectedSector,
  onSelectSector,
  forceCollapsed,
  onExpand,
  onCollapse,
  onWidthChange,
}: {
  mode: Exclude<MapMode, 'map'>
  insightsData: InsightsTicketData | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  sectors: SectorSummary[]
  heatMetric: HeatMetric
  onHeatMetricChange: (metric: HeatMetric) => void
  filters: InsightsFilters
  onFiltersChange: (updater: InsightsFilters | ((f: InsightsFilters) => InsightsFilters)) => void
  selectedSector: number | 'peripheral' | null
  onSelectSector: (sector: number | 'peripheral') => void
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  onWidthChange?: (width: number) => void
}) {
  const isHeatmap = mode === 'heatmap'
  const theme = useInsightTheme()

  const hasActiveFilters =
    (filters.statusSlugs?.length ?? 0) > 0 ||
    (filters.prioritySlugs?.length ?? 0) > 0 ||
    (filters.classGroups?.length ?? 0) > 0 ||
    filters.createdWithinMs !== undefined

  function toggleArrayFilter(key: 'statusSlugs' | 'prioritySlugs' | 'classGroups', value: string) {
    onFiltersChange((f) => {
      const current = f[key] ?? []
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      return { ...f, [key]: next.length > 0 ? next : undefined }
    })
  }

  function setCreatedWithin(ms: number | undefined) {
    onFiltersChange((f) => ({ ...f, createdWithinMs: ms }))
  }

  return (
    <Panel
      icon={
        isHeatmap ? (
          <FlameIcon className="h-full w-full" />
        ) : (
          <TicketIcon className="h-full w-full" />
        )
      }
      title={isHeatmap ? 'Heatmap' : 'Ticket status'}
      subtitle="Admin & manager view"
      side="left"
      forceCollapsed={forceCollapsed}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onRenderedWidthChange={onWidthChange}
    >
      {loading && !insightsData && (
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
      )}

      {error && !insightsData && (
        <div
          className="rounded-lg border px-2.5 py-2 text-[12.5px]"
          style={{
            borderColor: 'var(--danger-soft)',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
          }}
        >
          Failed to load insights: {error}{' '}
          <button
            type="button"
            onClick={onRefresh}
            className="cursor-pointer font-semibold underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {insightsData && (
        <InsightsModeBody
          mode={mode}
          insightsData={insightsData}
          sectors={sectors}
          heatMetric={heatMetric}
          onHeatMetricChange={onHeatMetricChange}
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={() => onFiltersChange({})}
          toggleArrayFilter={toggleArrayFilter}
          setCreatedWithin={setCreatedWithin}
          selectedSector={selectedSector}
          onSelectSector={onSelectSector}
          theme={theme}
          generatedAt={insightsData.generatedAt}
          onRefresh={onRefresh}
        />
      )}
    </Panel>
  )
}

function InsightsModeBody({
  mode,
  insightsData,
  sectors,
  heatMetric,
  onHeatMetricChange,
  filters,
  hasActiveFilters,
  onClearFilters,
  toggleArrayFilter,
  setCreatedWithin,
  selectedSector,
  onSelectSector,
  theme,
  generatedAt,
  onRefresh,
}: {
  mode: Exclude<MapMode, 'map'>
  insightsData: InsightsTicketData
  sectors: SectorSummary[]
  heatMetric: HeatMetric
  onHeatMetricChange: (metric: HeatMetric) => void
  filters: InsightsFilters
  hasActiveFilters: boolean
  onClearFilters: () => void
  toggleArrayFilter: (key: 'statusSlugs' | 'prioritySlugs' | 'classGroups', value: string) => void
  setCreatedWithin: (ms: number | undefined) => void
  selectedSector: number | 'peripheral' | null
  onSelectSector: (sector: number | 'peripheral') => void
  theme: ReturnType<typeof useInsightTheme>
  generatedAt: string
  onRefresh: () => void
}) {
  const isHeatmap = mode === 'heatmap'
  const metric: HeatMetric = isHeatmap ? heatMetric : 'open'

  const rollups = rollupBySector(
    insightsData.tickets,
    insightsData.statuses,
    insightsData.priorities,
    insightsData.classGroups,
    filters,
  )

  const bucketCounts: Record<StatusBucket, number> = {
    new: 0,
    progress: 0,
    resolved: 0,
    closed: 0,
  }
  for (const rollup of rollups.values()) {
    bucketCounts.new += rollup.newCount
    bucketCounts.progress += rollup.progressCount
    bucketCounts.resolved += rollup.resolved
    bucketCounts.closed += rollup.closed
  }

  const sectorAreaByNo = new Map(sectors.map((s) => [s.sector_no, s.area_hac]))
  const values = new Map<number, number>()
  for (const [sectorNo, rollup] of rollups) {
    if (sectorNo === null) continue
    values.set(sectorNo, heatValueForSector(rollup, metric, sectorAreaByNo.get(sectorNo) ?? 0))
  }
  const breaks = computeQuantileBreaks(Array.from(values.values()))

  const rankedNamed = sectors
    .map((s) => ({
      key: s.sector_no as number | 'peripheral',
      label: formatSectorLabel(s),
      value: values.get(s.sector_no) ?? 0,
    }))
    .sort((a, b) => b.value - a.value)
  const peripheralRollup = rollups.get(null)
  const peripheralValue = peripheralRollup ? heatValueForSector(peripheralRollup, metric, 0) : 0
  const ranked = [
    ...rankedNamed,
    { key: 'peripheral' as const, label: 'Peripheral', value: peripheralValue },
  ]
  const maxValue = Math.max(1, ...ranked.map((r) => r.value))

  const metricValueLabel = (value: number) =>
    metric === 'pctOpen'
      ? `${Math.round(value)}%`
      : metric === 'perHectare'
        ? value.toFixed(1)
        : String(Math.round(value))

  return (
    <div className="flex flex-col gap-4">
      {isHeatmap && (
        <div>
          <SectionLabel>Metric</SectionLabel>
          <div
            className="grid grid-cols-4 gap-1 rounded-lg border p-0.5"
            style={{ borderColor: 'var(--map-border)' }}
          >
            {METRIC_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onHeatMetricChange(opt.value)}
                aria-pressed={heatMetric === opt.value}
                className="cursor-pointer rounded-md px-1 py-1 text-[10.5px] font-semibold transition-colors"
                style={
                  heatMetric === opt.value
                    ? { background: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }
                    : { color: 'var(--map-fg-muted)' }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>Legend</SectionLabel>
        {isHeatmap ? (
          <div className="flex flex-col gap-1">
            {buildLegend(breaks, theme).map((entry) => (
              <div
                key={entry.label}
                className="flex items-center gap-2 text-[11.5px]"
                style={{ color: 'var(--map-fg-muted)' }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: entry.color }}
                  aria-hidden
                />
                {entry.label}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {BUCKET_ORDER.map((bucket) => {
              const count = bucketCounts[bucket]
              return (
                <div
                  key={bucket}
                  className="flex items-center gap-2 text-[11.5px]"
                  style={{
                    color: count > 0 ? 'var(--map-fg-muted)' : 'var(--map-fg-faint)',
                    opacity: count > 0 ? 1 : 0.6,
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: BUCKET_COLORS[bucket][theme] }}
                    aria-hidden
                  />
                  <span className="flex-1">{BUCKET_LABELS[bucket]}</span>
                  <span className="tabular-nums font-medium">{count}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <SectionLabel>Filters</SectionLabel>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="cursor-pointer text-[10.5px] font-semibold underline-offset-2 hover:underline"
              style={{ color: 'var(--map-accent)' }}
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {insightsData.statuses.map((s) => (
              <Chip
                key={s.slug}
                active={filters.statusSlugs?.includes(s.slug) ?? false}
                color={s.color}
                onClick={() => toggleArrayFilter('statusSlugs', s.slug)}
              >
                {s.name}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...insightsData.priorities]
              .sort((a, b) => a.order - b.order)
              .map((p) => (
                <Chip
                  key={p.slug}
                  active={filters.prioritySlugs?.includes(p.slug) ?? false}
                  color={p.color}
                  onClick={() => toggleArrayFilter('prioritySlugs', p.slug)}
                >
                  {p.name}
                </Chip>
              ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {insightsData.classGroups.map((cls) => (
              <Chip
                key={cls}
                active={filters.classGroups?.includes(cls) ?? false}
                color={CLASS_GROUP_COLORS[cls] ?? CLASS_GROUP_COLORS.Other}
                onClick={() => toggleArrayFilter('classGroups', cls)}
              >
                {cls}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CREATED_OPTIONS.map((opt) => (
              <Chip
                key={opt.label}
                active={filters.createdWithinMs === opt.value}
                onClick={() => setCreatedWithin(opt.value)}
              >
                {opt.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div>
        <SectionLabel>Sectors</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {ranked.map((row) => {
            const isSelected =
              row.key === 'peripheral'
                ? selectedSector === 'peripheral'
                : selectedSector === row.key
            const color =
              row.key === 'peripheral'
                ? 'var(--map-fg-faint)'
                : colorForValue(row.value, breaks, theme)
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onSelectSector(row.key)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors"
                style={{
                  background: isSelected ? 'var(--map-accent-bg)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--map-surface-hover)'
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: color }}
                  aria-hidden
                />
                <span
                  className="min-w-0 flex-1 truncate text-[11.5px]"
                  style={{
                    color: isSelected ? 'var(--map-fg)' : 'var(--map-fg-muted)',
                    fontWeight: isSelected ? 600 : 500,
                  }}
                >
                  {row.label}
                </span>
                <span
                  className="w-10 shrink-0 text-right text-[11px] tabular-nums"
                  style={{ color: 'var(--map-fg-faint)' }}
                >
                  {metricValueLabel(row.value)}
                </span>
                <span
                  className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full"
                  style={{ background: 'var(--map-border)' }}
                >
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(row.value / maxValue) * 100}%`, background: color }}
                  />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="flex items-center justify-between border-t pt-2.5 text-[10.5px]"
        style={{ borderColor: 'var(--map-border)', color: 'var(--map-fg-faint)' }}
      >
        <span>Updated {timeAgo(generatedAt)}</span>
        <button
          type="button"
          onClick={onRefresh}
          className="cursor-pointer font-semibold underline-offset-2 hover:underline"
          style={{ color: 'var(--map-accent)' }}
        >
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}
