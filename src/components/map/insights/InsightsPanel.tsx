'use client'

import Panel from '@/components/map/Panel'
import { ChartBarIcon } from '@/components/map/icons'
import type { MapMode } from '@/components/map/insights/ModeSwitcher'

/** Right-docked panel shown in place of Stats while a mode is active (see PLAN-heatmap.md §4.3
 *  "panel swap" and §6.2). The hero/status/category/priority/assignee/ticket-list blocks land in
 *  Phase 5 -- this is the Phase 2 shell: same resizable `Panel` chrome, same position and width
 *  reporting (so fitBounds/flyTo padding stays correct), so the real content drops in without a
 *  layout change. */
export default function InsightsPanel({
  mode,
  sector,
  onWidthChange,
  forceCollapsed,
  onExpand,
  onCollapse,
}: {
  mode: Exclude<MapMode, 'map'>
  sector: number | 'peripheral' | null
  onWidthChange?: (width: number) => void
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
}) {
  const subtitle =
    sector === null ? 'All sectors' : sector === 'peripheral' ? 'Peripheral' : `Sector ${sector}`

  return (
    <Panel
      icon={<ChartBarIcon className="h-full w-full" />}
      title="Insights"
      subtitle={subtitle}
      side="right"
      defaultCollapsed
      resizable
      defaultWidth={320}
      minWidth={260}
      maxWidth={640}
      onRenderedWidthChange={onWidthChange}
      forceCollapsed={forceCollapsed}
      onExpand={onExpand}
      onCollapse={onCollapse}
    >
      <div
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center"
        style={{ borderColor: 'var(--map-border)' }}
      >
        <span style={{ color: 'var(--map-fg-faint)' }}>
          <ChartBarIcon className="h-6 w-6" />
        </span>
        <p className="text-[12.5px] font-medium" style={{ color: 'var(--map-fg-muted)' }}>
          {mode === 'heatmap' ? 'Sector hotspot detail' : 'Ticket status detail'}
        </p>
        <p className="text-[11.5px] leading-snug" style={{ color: 'var(--map-fg-faint)' }}>
          Status &amp; progress, categories, priority trend and the ticket list are on their way.
        </p>
      </div>
    </Panel>
  )
}
