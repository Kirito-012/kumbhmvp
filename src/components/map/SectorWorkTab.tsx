'use client'

import { useEffect, useState } from 'react'
import SectorOverview from '@/components/map/SectorOverview'
import { useSectorInsights } from '@/components/map/insights/useSectorInsights'
import SectorWorkHeads, { DemoBadge } from '@/components/map/SectorWorkHeads'
import { TicketProgress, type WorkDoneSummary } from '@/components/map/SectorWorkDone'

type View = 'heads' | 'tickets' | 'insights'

const VIEWS: { key: View; label: string; hint: string }[] = [
  {
    key: 'heads',
    label: 'Work heads',
    hint: 'Main heads and sub-heads from the planning document',
  },
  { key: 'insights', label: 'Insights', hint: 'Resolution, ticket volume and category breakdown' },
  { key: 'tickets', label: 'Tickets', hint: 'Tickets filed in this sector, by category' },
]

/**
 * Body of the Sector Report drawer's "Work Done" tab: a switch between the planning document's
 * Main Heads / Sub-Heads (demo data for now) and the live ticket progress by category.
 */
export default function SectorWorkTab({
  sectorNo,
  summary,
  error,
  onRetry,
  expanded = false,
}: {
  sectorNo: number
  summary: WorkDoneSummary | null
  error: string | null
  onRetry: () => void
  /** Drawer is in Expanded view: jump to the dashboard, which is built for that much room. */
  expanded?: boolean
}) {
  const [view, setView] = useState<View>(expanded ? 'insights' : 'heads')
  // Adjust-state-during-render (not an effect): entering Expanded view lands on Insights without
  // a frame of the previous view; the user's own later tab choice then wins.
  const [wasExpanded, setWasExpanded] = useState(expanded)
  if (wasExpanded !== expanded) {
    setWasExpanded(expanded)
    if (expanded) setView('insights')
  }
  // Insights data lives here, not in the view, so switching away and back neither refetches nor
  // replays the entrance: the first visit gets the full choreography, return visits just appear.
  // It is requested (and the chart code warmed up) as soon as the Work Done tab opens, so by the
  // time the Insights view is selected the trend is usually already here and draws with the rest.
  const [insightsLeft, setInsightsLeft] = useState(false)
  const insights = useSectorInsights(true, sectorNo)
  useEffect(() => {
    void import('@/components/map/SectorTicketCharts')
  }, [])
  // Category the Tickets view should open on (set when a bar in Insights is selected).
  const [focusCategory, setFocusCategory] = useState<string | undefined>(undefined)

  function selectView(next: View, category?: string) {
    if (view === 'insights' && next !== 'insights') setInsightsLeft(true)
    setFocusCategory(category)
    setView(next)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <div
          role="group"
          aria-label="Work Done view"
          className="flex rounded-lg border p-0.5"
          style={{ borderColor: 'var(--map-border)', backgroundColor: 'var(--map-surface-alt)' }}
        >
          {VIEWS.map((v) => {
            const active = v.key === view
            return (
              <button
                key={v.key}
                type="button"
                aria-pressed={active}
                title={v.hint}
                onClick={() => selectView(v.key)}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors"
                style={
                  active
                    ? { backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }
                    : { color: 'var(--map-fg-muted)' }
                }
              >
                {v.label}
                {v.key === 'heads' && <DemoBadge />}
              </button>
            )
          })}
        </div>
      </div>
      {view === 'heads' ? (
        <SectorWorkHeads sectorNo={sectorNo} />
      ) : view === 'insights' ? (
        <SectorOverview
          tickets={summary}
          error={error}
          onRetry={onRetry}
          insights={insights}
          animate={!insightsLeft}
          onOpenCategory={(name) => selectView('tickets', name)}
        />
      ) : (
        <TicketProgress
          summary={summary}
          error={error}
          onRetry={onRetry}
          initialOpen={focusCategory}
        />
      )}
    </div>
  )
}
