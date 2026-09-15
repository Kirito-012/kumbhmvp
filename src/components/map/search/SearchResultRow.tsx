'use client'

import type { ComponentType } from 'react'

/**
 * Shared search-result row (icon + label, or label + sub-label), extracted from Evacuation mode's
 * search dropdown (PLAN-evacuation.md §7.1), which previously duplicated this same button markup
 * three times over -- once each for its "Jump to sector" / "Zones" / place-result groups. Map mode
 * has no direct analog (its own search only ever surfaces layer/class/sector toggle rows, never
 * individual-feature results -- decision #2 keeps single-feature search Evacuation-only), so this
 * one is shared within Evacuation mode rather than across both modes.
 *
 * Two shapes, chosen by whether `sublabel` is given: a one-line icon+label row (sector/zone
 * matches) or a two-line label-over-sublabel row with no icon (place results, which already carry
 * their own sector/zone context in the sublabel).
 */
export default function SearchResultRow({
  id,
  label,
  sublabel,
  icon: Icon,
  highlighted,
  onMouseEnter,
  onClick,
}: {
  id: string
  label: string
  sublabel?: string | null
  icon?: ComponentType<{ className?: string }>
  highlighted: boolean
  onMouseEnter: () => void
  onClick: () => void
}) {
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={highlighted}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={{ backgroundColor: highlighted ? 'var(--map-surface-hover)' : 'transparent' }}
      className={
        sublabel
          ? 'flex w-full cursor-pointer flex-col items-start px-3 py-1.5 text-left'
          : 'flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12.5px]'
      }
    >
      {sublabel ? (
        <>
          <span className="text-[12.5px]" style={{ color: 'var(--map-fg)' }}>
            {label}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--map-fg-faint)' }}>
            {sublabel}
          </span>
        </>
      ) : (
        <>
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--map-fg-faint)]" />}
          {label}
        </>
      )}
    </button>
  )
}
