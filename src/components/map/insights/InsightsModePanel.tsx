'use client'

import Panel from '@/components/map/Panel'
import { FlameIcon, TicketIcon } from '@/components/map/icons'
import type { MapMode } from '@/components/map/insights/ModeSwitcher'

/** Left-docked panel shown in place of the search panel while a mode is active (see
 *  PLAN-heatmap.md §4.3 "panel swap"). Metric switch, legend, filters and the ranked-sector list
 *  land in Phase 5 -- this is the Phase 2 shell: same `Panel` chrome, same position, so switching
 *  modes never causes a layout jump once the real content arrives. */
export default function InsightsModePanel({
  mode,
  forceCollapsed,
  onExpand,
  onCollapse,
}: {
  mode: Exclude<MapMode, 'map'>
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
}) {
  const isHeatmap = mode === 'heatmap'

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
    >
      <div
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center"
        style={{ borderColor: 'var(--map-border)' }}
      >
        <span style={{ color: 'var(--map-fg-faint)' }}>
          {isHeatmap ? <FlameIcon className="h-6 w-6" /> : <TicketIcon className="h-6 w-6" />}
        </span>
        <p className="text-[12.5px] font-medium" style={{ color: 'var(--map-fg-muted)' }}>
          {isHeatmap ? 'Heatmap controls' : 'Ticket-status controls'}
        </p>
        <p className="text-[11.5px] leading-snug" style={{ color: 'var(--map-fg-faint)' }}>
          The metric switch, legend and ranked sector list are on their way.
        </p>
      </div>
    </Panel>
  )
}
