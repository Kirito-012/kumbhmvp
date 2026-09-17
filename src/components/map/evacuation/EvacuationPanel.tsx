'use client'

import type { ReactNode } from 'react'
import Panel from '@/components/map/Panel'
import { EvacuationIcon, MapPinIcon } from '@/components/map/icons'
import { useInsightTheme, Reveal, AnimatedBar, pillEntranceDelayMs } from '@/components/map/insights/charts'
import { EVAC_COLORS, type EvacFocus } from '@/lib/evacuation/layers'
import type { EvacSummary, EvacSummaryFeature } from './useEvacuationSummary'
import { EVAC_LAYER_LABELS } from '@/lib/evacuation/layers'
import type { EvacSearchResult } from './useEvacuationSearch'

type SectorSummary = { sector_no: number; name: string; area_hac: number }

function formatSectorLabel(sector: Pick<SectorSummary, 'sector_no' | 'name'>): string {
  const title = sector.name.replace(/-\d+$/, '')
  return `${String(sector.sector_no).padStart(2, '0')}. ${title}`
}

/** Turns a summary-API feature (id/label/sublabel/bbox/anchor -- no sector/zone/source fields,
 *  since the summary route never needed them) into the shape `selectEvacResult` in MapView
 *  expects, so a hero/care/feature-list row can reuse the exact same fly-in + highlight +
 *  layer-on logic as a search result instead of duplicating it here. */
function asSearchResult(feature: EvacSummaryFeature): EvacSearchResult {
  return {
    id: feature.id,
    label: feature.label,
    sublabel: feature.sublabel,
    sectorNo: null,
    sectorName: null,
    zone: null,
    bbox: feature.bbox,
    anchor: feature.anchor,
    source: 'summary',
  }
}

const HERO_METRICS: Array<{
  key: 'entry_exit' | 'entry_exit_line' | 'traffic_route' | 'direction_line' | 'emergency_exit'
  label: string
}> = [
  { key: 'entry_exit', label: 'Entry/exit points' },
  { key: 'entry_exit_line', label: 'Entry/exit routes' },
  { key: 'traffic_route', label: 'Traffic routes' },
  { key: 'direction_line', label: 'Direction signage' },
  { key: 'emergency_exit', label: 'Emergency exits' },
]

function heroTileColor(key: (typeof HERO_METRICS)[number]['key'], theme: 'light' | 'dark'): string {
  switch (key) {
    case 'entry_exit':
      return EVAC_COLORS.entry[theme]
    case 'emergency_exit':
      return EVAC_COLORS.emergencyExit[theme]
    case 'traffic_route':
      return 'var(--map-section-blue-fg)'
    case 'entry_exit_line':
      return 'var(--map-section-teal-fg)'
    case 'direction_line':
      return 'var(--map-section-violet-fg)'
  }
}

function EvacSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3
        className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--map-fg-muted)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  )
}

function ClickableFeatureRow({
  feature,
  onClick,
}: {
  feature: EvacSummaryFeature
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-[var(--map-surface-hover)]"
    >
      <MapPinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--map-fg-faint)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px]" style={{ color: 'var(--map-fg)' }}>
          {feature.label}
        </span>
        {feature.sublabel && (
          <span className="block truncate text-[10.5px]" style={{ color: 'var(--map-fg-faint)' }}>
            {feature.sublabel}
          </span>
        )}
      </span>
    </button>
  )
}

function LegendLine({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-0 w-6 shrink-0"
      style={{
        borderTopWidth: 2,
        borderTopColor: color,
        borderTopStyle: dashed ? 'dashed' : 'solid',
      }}
    />
  )
}

function LegendBadge({ text, color }: { text: string; color: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-4 w-6 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {text}
    </span>
  )
}

function LegendSwatch({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-6 shrink-0 rounded-[3px]"
      style={{ backgroundColor: color, opacity }}
    />
  )
}

function LegendRow({ sample, label }: { sample: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-[11px]" style={{ color: 'var(--map-fg-muted)' }}>
      {sample}
      <span className="truncate">{label}</span>
    </div>
  )
}

/**
 * Right-docked panel for Evacuation mode (PLAN-evacuation.md §7.3): a hero tile row (counts for
 * the 5 core layers, sized as share-of-max bars -- same AnimatedBar/pillEntranceDelayMs pattern
 * as the Heatmap/Ticket panels' own hero), a "Nearby care" list of hospitals/police/fire when a
 * sector or zone is focused, a static legend of every evac-* style, and a per-focus feature list
 * grouped by layer. All fed by /api/evacuation/summary, fetched once in MapView (useEvacuationSummary)
 * and passed down as `summary`/`loading`/`error` -- lifted there so EvacuationModePanel's Corridor
 * chips can share the same fetch for its counts instead of duplicating it.
 *
 * The hero shows "Entry/exit points" as one combined count rather than splitting Entry vs Exit --
 * the underlying kumbh.entry_exit table only carries direction on individual rows (`remark`), and
 * /api/evacuation/summary's COUNTED_LAYERS never aggregates a per-direction split server-side,
 * so a true "entry points · exit points" pair the original sketch imagined would need a new query
 * shape for a number nothing else in the mode needs. Five real counted layers beats two invented
 * ones.
 */
export default function EvacuationPanel({
  evacFocus,
  sectors,
  onClearFocus,
  onSelectResult,
  summary,
  loading,
  error,
  forceCollapsed,
  onExpand,
  onCollapse,
  onWidthChange,
}: {
  evacFocus: EvacFocus
  sectors: SectorSummary[]
  onClearFocus: () => void
  onSelectResult: (layer: string, result: EvacSearchResult) => void
  /** Lifted to MapView (see its own comment) so EvacuationModePanel's Corridor chips can share
   *  the same /api/evacuation/summary fetch instead of a second one. */
  summary: EvacSummary | null
  loading: boolean
  error: string | null
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  onWidthChange?: (width: number) => void
}) {
  const theme = useInsightTheme()

  const title =
    evacFocus?.kind === 'sector'
      ? (() => {
          const s = sectors.find((x) => x.sector_no === evacFocus.sectorNo)
          return s ? formatSectorLabel(s) : `Sector ${evacFocus.sectorNo}`
        })()
      : evacFocus?.kind === 'zone'
        ? evacFocus.zone
        : 'Evacuation overview'

  const counts = summary?.counts ?? {}
  const maxCount = Math.max(1, ...HERO_METRICS.map((m) => counts[m.key] ?? 0))
  const focus = summary?.focus ?? null

  return (
    <Panel
      icon={<EvacuationIcon className="h-full w-full" />}
      title={title}
      side="right"
      entrance="slide"
      forceCollapsed={forceCollapsed}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onRenderedWidthChange={onWidthChange}
    >
      <div className="flex flex-col gap-4">
        {loading && !summary && (
          <div className="relative h-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--map-border)' }}>
            <div className="absolute inset-y-0 w-1/3 animate-[loading-sweep_1.1s_ease-in-out_infinite] rounded-full bg-[var(--map-accent)]" />
          </div>
        )}
        {error && (
          <p className="text-[12px]" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        {summary && (
          <Reveal index={0}>
            <EvacSection title="Overview">
              <div className="grid grid-cols-2 gap-1.5">
                {HERO_METRICS.map((metric) => {
                  const count = counts[metric.key] ?? 0
                  const color = heroTileColor(metric.key, theme)
                  return (
                    <div
                      key={metric.key}
                      className="rounded-lg border px-2 py-1.5"
                      style={{ borderColor: 'var(--map-border)' }}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className="truncate text-[10px]"
                          style={{ color: 'var(--map-fg-faint)' }}
                        >
                          {metric.label}
                        </span>
                        <span
                          className="shrink-0 text-[12.5px] font-semibold tabular-nums"
                          style={{ color: 'var(--map-fg)' }}
                        >
                          {count}
                        </span>
                      </div>
                      <div className="mt-1">
                        <AnimatedBar
                          percent={(count / maxCount) * 100}
                          fill={color}
                          height={5}
                          delayMs={pillEntranceDelayMs(0)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </EvacSection>
          </Reveal>
        )}

        {focus && focus.care.length > 0 && (
          <Reveal index={1}>
            <EvacSection title="Nearby care">
              <div className="flex flex-col">
                {focus.care.map((item) => (
                  <ClickableFeatureRow
                    key={item.id}
                    feature={item}
                    onClick={() => onSelectResult('public_service_facilities', asSearchResult(item))}
                  />
                ))}
              </div>
            </EvacSection>
          </Reveal>
        )}

        <Reveal index={focus ? 2 : 1}>
          <EvacSection title="Legend">
            <p className="mb-1.5 text-[10.5px]" style={{ color: 'var(--map-fg-faint)' }}>
              Routes and signage are colored green for entry, red for exit — solid vs. dashed marks
              peak vs. normal day.
            </p>
            <div className="flex flex-col">
              <LegendRow sample={<LegendBadge text="EN" color={EVAC_COLORS.entry[theme]} />} label="Entry point" />
              <LegendRow sample={<LegendBadge text="EXT" color={EVAC_COLORS.exit[theme]} />} label="Exit point" />
              <LegendRow
                sample={<LegendLine color={EVAC_COLORS.entry[theme]} />}
                label="Entry/exit route"
              />
              <LegendRow
                sample={<LegendLine color={EVAC_COLORS.entry[theme]} />}
                label="Traffic route · peak day"
              />
              <LegendRow
                sample={<LegendLine color={EVAC_COLORS.entry[theme]} dashed />}
                label="Traffic route · normal day"
              />
              <LegendRow
                sample={<LegendLine color={EVAC_COLORS.entry[theme]} />}
                label="Direction signage"
              />
              <LegendRow
                sample={<LegendLine color={EVAC_COLORS.emergencyExit[theme]} />}
                label="Emergency exit"
              />
              <LegendRow
                sample={<LegendSwatch color={EVAC_COLORS.floodArea[theme]} opacity={0.35} />}
                label="Flood risk area"
              />
              <LegendRow
                sample={<LegendLine color={EVAC_COLORS.floodLine[theme]} dashed />}
                label="Flood line"
              />
            </div>
          </EvacSection>
        </Reveal>

        {focus && focus.layers.some((g) => g.features.length > 0) && (
          <Reveal index={focus ? 3 : 2}>
            <EvacSection title="Features in view">
              <div className="flex flex-col gap-2.5">
                {focus.layers
                  .filter((g) => g.features.length > 0)
                  .map((group) => (
                    <div key={group.layer}>
                      <h4
                        className="mb-0.5 px-1.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--map-fg-faint)' }}
                      >
                        {EVAC_LAYER_LABELS[group.layer as keyof typeof EVAC_LAYER_LABELS] ?? group.layer}
                      </h4>
                      <div className="flex flex-col">
                        {group.features.slice(0, 8).map((feature) => (
                          <ClickableFeatureRow
                            key={feature.id}
                            feature={feature}
                            onClick={() => onSelectResult(group.layer, asSearchResult(feature))}
                          />
                        ))}
                        {group.features.length > 8 && (
                          <p
                            className="px-1.5 pt-0.5 text-[10.5px]"
                            style={{ color: 'var(--map-fg-faint)' }}
                          >
                            +{group.features.length - 8} more
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </EvacSection>
          </Reveal>
        )}

        {evacFocus && (
          <button
            type="button"
            onClick={onClearFocus}
            className="cursor-pointer self-start text-[12.5px] font-semibold underline-offset-2 hover:underline"
            style={{ color: 'var(--map-accent)' }}
          >
            Clear {evacFocus.kind === 'zone' ? 'zone' : 'sector'}
          </button>
        )}
      </div>
    </Panel>
  )
}
