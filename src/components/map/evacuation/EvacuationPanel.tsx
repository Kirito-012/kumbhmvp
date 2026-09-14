'use client'

import Panel from '@/components/map/Panel'
import { ChartBarIcon } from '@/components/map/icons'
import type { EvacFocus } from '@/lib/evacuation/layers'

type SectorSummary = { sector_no: number; name: string; area_hac: number }

function formatSectorLabel(sector: Pick<SectorSummary, 'sector_no' | 'name'>): string {
  const title = sector.name.replace(/-\d+$/, '')
  return `${String(sector.sector_no).padStart(2, '0')}. ${title}`
}

/**
 * Right-docked panel for Evacuation mode -- see PLAN-evacuation.md §7.3 for the full design (hero
 * counts, nearby-care list, legend, per-focus feature list). This is Phase 1's "empty panel
 * shell" (§10 Phase 1): title/subtitle already reflects `evacFocus` (sector/zone/overview) and
 * the Panel docking contract is wired up, but the body is a placeholder -- the hero tiles, legend
 * and feature list are Phase 6's job, once evacLayers.ts/the summary API exist to feed them.
 */
export default function EvacuationPanel({
  evacFocus,
  sectors,
  onClearFocus,
  forceCollapsed,
  onExpand,
  onCollapse,
  onWidthChange,
}: {
  evacFocus: EvacFocus
  sectors: SectorSummary[]
  onClearFocus: () => void
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  onWidthChange?: (width: number) => void
}) {
  const title =
    evacFocus?.kind === 'sector'
      ? (() => {
          const s = sectors.find((x) => x.sector_no === evacFocus.sectorNo)
          return s ? formatSectorLabel(s) : `Sector ${evacFocus.sectorNo}`
        })()
      : evacFocus?.kind === 'zone'
        ? evacFocus.zone
        : 'Evacuation overview'

  return (
    <Panel
      icon={<ChartBarIcon className="h-full w-full" />}
      title={title}
      side="right"
      entrance="slide"
      forceCollapsed={forceCollapsed}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onRenderedWidthChange={onWidthChange}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px]" style={{ color: 'var(--map-fg-muted)' }}>
          Counts, nearby hospitals/police/fire, and a legend are coming soon.
        </p>
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
