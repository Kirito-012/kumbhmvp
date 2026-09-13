'use client'

import { FlameIcon, LayersIcon, TicketIcon } from '@/components/map/icons'

export type MapMode = 'map' | 'heatmap' | 'tickets'

const SEGMENTS: { mode: MapMode; label: string; icon: typeof LayersIcon }[] = [
  { mode: 'map', label: 'Map', icon: LayersIcon },
  { mode: 'heatmap', label: 'Heatmap', icon: FlameIcon },
  { mode: 'tickets', label: 'Tickets', icon: TicketIcon },
]

/** Per-mode indicator tint, as `--map-*` tokens (see globals.css) so it re-themes with the rest
 *  of the map chrome instead of needing its own theme-watching effect -- Map reuses the accent
 *  blue every other active control already uses. */
const INDICATOR_VAR: Record<MapMode, string> = {
  map: 'var(--map-accent)',
  heatmap: 'var(--map-mode-heatmap)',
  tickets: 'var(--map-mode-tickets)',
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

  return (
    <div
      role="radiogroup"
      aria-label="Map mode"
      style={{
        borderColor: 'var(--map-panel-border)',
        background: 'var(--map-panel-bg)',
      }}
      className="relative inline-flex h-10 shrink-0 items-center rounded-lg border p-1 shadow-lg backdrop-blur-md"
    >
      <div
        aria-hidden="true"
        style={{
          width: `${100 / SEGMENTS.length}%`,
          transform: `translateX(${activeIndex * 100}%)`,
          background: INDICATOR_VAR[mode],
        }}
        className="absolute inset-y-1 left-1 rounded-md transition-transform duration-200 ease-out"
      />
      {SEGMENTS.map(({ mode: segMode, label, icon: Icon }) => {
        const active = segMode === mode
        return (
          <button
            key={segMode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(segMode)}
            style={{ color: active ? '#fff' : 'var(--map-fg-muted)' }}
            className="relative z-10 inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-[12.5px] font-semibold transition-colors"
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="hidden lg:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
