'use client'

import { useState, type ReactNode } from 'react'
import Panel from '@/components/map/Panel'
import { FlameIcon, TicketIcon, SearchIcon } from '@/components/map/icons'
import type { MapMode } from '@/components/map/insights/ModeSwitcher'
import { useInsightTheme } from '@/components/map/insights/charts'
import {
  rollupBySector,
  heatValueForSector,
  type HeatMetric,
  type InsightsFilters,
  type SectorRollup,
} from '@/lib/insights/aggregate'
import { computeQuantileBreaks, colorForValue, heatGradientCss } from '@/lib/insights/heatScale'
import {
  BUCKET_ORDER,
  BUCKET_LABELS,
  BUCKET_COLORS,
  type StatusBucket,
} from '@/lib/insights/statusBuckets'
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
  { value: 'total', label: 'Total' },
  { value: 'pctOpen', label: '% open' },
]

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
  selectedSector: number | 'peripheral' | null
  onSelectSector: (sector: number | 'peripheral') => void
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  onWidthChange?: (width: number) => void
}) {
  const isHeatmap = mode === 'heatmap'
  const theme = useInsightTheme()

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
  selectedSector: number | 'peripheral' | null
  onSelectSector: (sector: number | 'peripheral') => void
  theme: ReturnType<typeof useInsightTheme>
  generatedAt: string
  onRefresh: () => void
}) {
  const isHeatmap = mode === 'heatmap'
  const [sectorQuery, setSectorQuery] = useState('')

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

  // Ticket mode has no metric switch of its own -- it always ranks/colours the list by open-ticket
  // count, same as Heatmap's old 'open' default before §11.8 dropped that as a HeatMetric value.
  const rankValue = (rollup: SectorRollup | undefined) =>
    isHeatmap ? heatValueForSector(rollup, heatMetric) : (rollup?.open ?? 0)

  const values = new Map<number, number>()
  for (const [sectorNo, rollup] of rollups) {
    if (sectorNo === null) continue
    values.set(sectorNo, rankValue(rollup))
  }
  const breaks = computeQuantileBreaks(Array.from(values.values()))

  const rankedNamed = sectors
    .map((s) => ({
      key: s.sector_no as number | 'peripheral',
      label: formatSectorLabel(s),
      value: values.get(s.sector_no) ?? 0,
    }))
    .sort((a, b) => b.value - a.value)
  const peripheralValue = rankValue(rollups.get(null))
  const ranked = [
    ...rankedNamed,
    { key: 'peripheral' as const, label: 'Peripheral', value: peripheralValue },
  ]
  const maxValue = Math.max(1, ...ranked.map((r) => r.value))

  const metricValueLabel = (value: number) =>
    isHeatmap && heatMetric === 'pctOpen' ? `${Math.round(value)}%` : String(Math.round(value))

  const sectorQ = sectorQuery.trim().toLowerCase()
  const visibleRanked = sectorQ
    ? ranked.filter((row) => row.label.toLowerCase().includes(sectorQ))
    : ranked

  return (
    <div className="flex flex-col gap-4">
      {isHeatmap && (
        <div>
          <SectionLabel>Metric</SectionLabel>
          <div
            className="grid grid-cols-2 gap-1 rounded-lg border p-0.5"
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
          <div className="flex flex-col gap-1.5">
            <div
              className="h-2.5 w-full shrink-0 rounded-full"
              style={{ background: heatGradientCss(theme) }}
              aria-hidden
            />
            <div
              className="flex items-center justify-between text-[11.5px]"
              style={{ color: 'var(--map-fg-muted)' }}
            >
              <span>Fewer</span>
              <span>{heatMetric === 'pctOpen' ? 'More open tickets' : 'More tickets'}</span>
            </div>
            {heatMetric === 'pctOpen' && (
              <p className="text-[10.5px]" style={{ color: 'var(--map-fg-faint)' }}>
                Map shows open-ticket density · list ranked by % open
              </p>
            )}
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
        <SectionLabel>Sectors</SectionLabel>
        <div className="relative mb-1.5">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--map-fg-faint)]" />
          <input
            type="text"
            value={sectorQuery}
            onChange={(e) => setSectorQuery(e.target.value)}
            placeholder="Search sectors…"
            aria-label="Search sectors"
            className="w-full rounded-lg border py-1.5 pl-8 pr-2.5 text-[11.5px] outline-none transition-shadow placeholder:text-[var(--map-fg-faint)] focus:border-[var(--map-accent)] focus:ring-2 focus:ring-[var(--map-accent)]/25"
            style={{
              borderColor: 'var(--map-border)',
              background: 'var(--map-input-bg)',
              color: 'var(--map-fg)',
            }}
          />
        </div>
        {visibleRanked.length === 0 && (
          <p className="px-1.5 py-1 text-[11.5px]" style={{ color: 'var(--map-fg-faint)' }}>
            No sectors match your search.
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {visibleRanked.map((row) => {
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
