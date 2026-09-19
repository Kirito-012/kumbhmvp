'use client'

import { useRef } from 'react'
import { EvacuationIcon, LayersIcon, TicketIcon } from '@/components/map/icons'

export type MapMode = 'map' | 'heatmap' | 'tickets' | 'evacuation'

// Appended at the end (rather than, say, alphabetised) so the existing 1/2/3 keyboard shortcuts
// keep meaning what they always have -- see PLAN-evacuation.md §5.2. 4 selects Evacuation.
const SEGMENTS: { mode: MapMode; label: string; icon: typeof LayersIcon }[] = [
  { mode: 'map', label: 'Map', icon: LayersIcon },
  // Hidden for now -- Heatmap mode is not ready to show yet.
  // { mode: 'heatmap', label: 'Heatmap', icon: FlameIcon },
  { mode: 'tickets', label: 'Tickets', icon: TicketIcon },
  { mode: 'evacuation', label: 'Evacuation', icon: EvacuationIcon },
]

/** Per-mode indicator tint, as `--map-*` tokens (see globals.css) so it re-themes with the rest
 *  of the map chrome instead of needing its own theme-watching effect -- Map reuses the accent
 *  blue every other active control already uses. */
const INDICATOR_VAR: Record<MapMode, string> = {
  map: 'var(--map-accent)',
  heatmap: 'var(--map-mode-heatmap)',
  tickets: 'var(--map-mode-tickets)',
  evacuation: 'var(--map-mode-evacuation)',
}

/** Segmented pill placed after the measure button in the top-left control strip (see MapView's
 *  control-strip row) -- only rendered when the signed-in user's `canUseInsights` grant is true,
 *  since surveyors must never see this switch (see PLAN-heatmap.md decision #6). */
export default function ModeSwitcher({
  mode,
  onChange,
}: {
  mode: MapMode
  onChange: (mode: MapMode) => void
}) {
  const activeIndex = SEGMENTS.findIndex((s) => s.mode === mode)
  // Roving tabindex (WAI-ARIA APG radiogroup pattern): only the checked segment is a tab stop,
  // and arrow keys move both focus and the selection between the other segments. Without this,
  // role="radio"/aria-checked describe a radiogroup that Tab still walks button-by-button and
  // that has no arrow-key behaviour at all -- the roles would be present but not actually
  // keyboard-operable the way a screen reader user expects a radiogroup to be.
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  function moveTo(index: number) {
    const next = SEGMENTS[(index + SEGMENTS.length) % SEGMENTS.length]
    onChange(next.mode)
    buttonRefs.current[(index + SEGMENTS.length) % SEGMENTS.length]?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      moveTo(index + 1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveTo(index - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      moveTo(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      moveTo(SEGMENTS.length - 1)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Map mode"
      style={{
        borderColor: 'var(--map-panel-border)',
        backgroundColor: 'var(--map-panel-bg)',
      }}
      className="relative inline-flex h-10 shrink-0 items-center rounded-lg border p-1 shadow-lg backdrop-blur-md"
    >
      <div
        aria-hidden="true"
        style={{
          // Fixed 2rem (matches each button's w-8) rather than a percentage of the container --
          // a percentage here resolves against the *padded* box (this div's positioned ancestor
          // includes the p-1 padding), not the 32px buttons themselves, so it was a few px wider
          // than each icon and drifted further off-center at every step (worse toward Tickets).
          transform: `translateX(${activeIndex * 2}rem)`,
          backgroundColor: INDICATOR_VAR[mode],
        }}
        className="absolute inset-y-1 left-1 w-8 rounded-md transition-transform duration-200 ease-out"
      />
      {SEGMENTS.map(({ mode: segMode, label, icon: Icon }, index) => {
        const active = segMode === mode
        return (
          <button
            key={segMode}
            ref={(el) => {
              buttonRefs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(segMode)}
            onKeyDown={(e) => onKeyDown(e, index)}
            style={{ color: active ? '#fff' : 'var(--map-fg-muted)' }}
            className="relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
          >
            <Icon className="h-4 w-4 shrink-0" />
          </button>
        )
      })}
    </div>
  )
}
