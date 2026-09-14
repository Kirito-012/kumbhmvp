'use client'

import Panel from '@/components/map/Panel'
import { EvacuationIcon } from '@/components/map/icons'
import {
  EVAC_CORE_KEYS,
  EVAC_SUPPORT_KEYS,
  EVAC_FLOOD_KEYS,
  EVAC_LAYER_LABELS,
  EVAC_SHP_SOURCED_KEYS,
  type EvacKey,
} from '@/lib/evacuation/layers'

/** Section label styled the same as InsightsModePanel's own `SectionLabel` (module-private
 *  there) -- kept as a tiny local duplicate rather than exported/shared, same call the Insights
 *  panels' own charts.tsx makes for its handful of shared primitives. */
function SectionLabel({ children }: { children: string }) {
  return (
    <h3
      className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
      style={{ color: 'var(--map-fg-faint)' }}
    >
      {children}
    </h3>
  )
}

function LayerRow({ evacKey, on }: { evacKey: EvacKey; on: boolean }) {
  const shpSourced = EVAC_SHP_SOURCED_KEYS.includes(evacKey)
  return (
    <div className="flex items-center gap-2 py-1 text-[12.5px]" style={{ color: 'var(--map-fg)' }}>
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: on ? 'var(--map-accent)' : 'var(--map-switch-track)' }}
      />
      <span className="min-w-0 flex-1 truncate">{EVAC_LAYER_LABELS[evacKey]}</span>
      {shpSourced && (
        <span className="shrink-0 text-[10px]" style={{ color: 'var(--map-fg-faint)' }}>
          25 Aug 2026
        </span>
      )}
    </div>
  )
}

/**
 * Left-docked panel for Evacuation mode -- see PLAN-evacuation.md §7.2 for the full design
 * (search, scenario/direction/corridor chips, interactive layer toggles). This is Phase 1's
 * "empty panel shell" (§10 Phase 1): it establishes the Panel chrome, entrance animation and
 * docking plumbing (forceCollapsed/onExpand/onCollapse/onWidthChange, same contract every other
 * docked panel here already implements) and shows the current evacVisibility read-only, but has
 * no search box or interactive toggles yet -- those, and the filter chips, are Phase 4's job.
 */
export default function EvacuationModePanel({
  evacVisibility,
  forceCollapsed,
  onExpand,
  onCollapse,
  onWidthChange,
}: {
  evacVisibility: Record<EvacKey, boolean>
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  onWidthChange?: (width: number) => void
}) {
  return (
    <Panel
      icon={<EvacuationIcon className="h-full w-full" />}
      title="Evacuation"
      subtitle="Entry/exit · routes · signage"
      side="left"
      entrance="slide"
      forceCollapsed={forceCollapsed}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onRenderedWidthChange={onWidthChange}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px]" style={{ color: 'var(--map-fg-muted)' }}>
          Search, filters and interactive layer toggles are coming soon. For now, here&rsquo;s what
          this mode shows and hides.
        </p>
        <div>
          <SectionLabel>Evacuation layers</SectionLabel>
          {EVAC_CORE_KEYS.map((key) => (
            <LayerRow key={key} evacKey={key} on={evacVisibility[key]} />
          ))}
        </div>
        <div>
          <SectionLabel>Supporting layers</SectionLabel>
          {EVAC_SUPPORT_KEYS.map((key) => (
            <LayerRow key={key} evacKey={key} on={evacVisibility[key]} />
          ))}
        </div>
        <div>
          <SectionLabel>Flood risk</SectionLabel>
          {EVAC_FLOOD_KEYS.map((key) => (
            <LayerRow key={key} evacKey={key} on={evacVisibility[key]} />
          ))}
        </div>
      </div>
    </Panel>
  )
}
