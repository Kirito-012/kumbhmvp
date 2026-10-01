'use client'

import { useState } from 'react'
import SectorWorkHeads, { DemoBadge } from '@/components/map/SectorWorkHeads'
import { TicketProgress, type WorkDoneSummary } from '@/components/map/SectorWorkDone'

type View = 'heads' | 'tickets'

const VIEWS: { key: View; label: string; hint: string }[] = [
  {
    key: 'heads',
    label: 'Work heads',
    hint: 'Main heads and sub-heads from the planning document',
  },
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
}: {
  sectorNo: number
  summary: WorkDoneSummary | null
  error: string | null
  onRetry: () => void
}) {
  const [view, setView] = useState<View>('heads')
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
                onClick={() => setView(v.key)}
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
      ) : (
        <TicketProgress summary={summary} error={error} onRetry={onRetry} />
      )}
    </div>
  )
}
