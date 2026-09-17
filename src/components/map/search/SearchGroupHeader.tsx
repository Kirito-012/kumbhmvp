'use client'

import type { ComponentType } from 'react'
import { ChevronDownIcon } from '@/components/map/icons'

export type SearchGroupTheme = 'blue' | 'teal' | 'amber' | 'violet'

/**
 * Shared collapsible group header (icon chip + label + count, optional "select all" and
 * collapse/expand), extracted from Map mode's own unified search (PLAN-evacuation.md §7.1).
 * Map mode's groups collapse/expand and some offer "select all"; Evacuation's search groups are
 * always fully expanded with no bulk-select action, so `collapsed`/`onToggleCollapsed` are
 * optional -- omitting them renders a static (non-interactive) header instead of a button, rather
 * than forcing every caller to invent collapse state it doesn't use.
 *
 * The collapse toggle and "select all" are deliberately two SIBLING buttons, never one nested
 * inside the other: a button inside a button is invalid HTML, a screen reader can't say which of
 * the two the user is on, and the inner one would need `stopPropagation` to avoid firing both.
 * Native buttons also bring their own Enter/Space handling for free.
 */
export default function SearchGroupHeader({
  label,
  icon: Icon,
  theme,
  count,
  collapsed,
  onToggleCollapsed,
  onSelectAll,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  theme: SearchGroupTheme
  count: number
  collapsed?: boolean
  onToggleCollapsed?: () => void
  onSelectAll?: () => void
}) {
  const iconChip = (
    <span
      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
      style={{
        backgroundColor: `var(--map-section-${theme}-bg)`,
        color: `var(--map-section-${theme}-fg)`,
      }}
    >
      <Icon className="h-2.5 w-2.5" />
    </span>
  )
  const labelText = (
    <span
      className="flex-1 truncate text-[10.5px] font-bold uppercase tracking-wide"
      style={{ color: 'var(--map-fg-muted)' }}
    >
      {label}
    </span>
  )

  return (
    <div className="flex w-full items-center gap-1.5 px-2.5 py-1.5 hover:bg-[var(--map-surface-hover)]">
      {onToggleCollapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
        >
          <ChevronDownIcon
            className={`h-3 w-3 shrink-0 text-[var(--map-fg-faint)] transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          {iconChip}
          {labelText}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {iconChip}
          {labelText}
        </span>
      )}
      {onSelectAll && (
        <button
          type="button"
          onClick={onSelectAll}
          aria-label={`Select all ${label}`}
          style={{ color: 'var(--map-accent)' }}
          className="shrink-0 cursor-pointer px-1 text-[10.5px] font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
        >
          All
        </button>
      )}
      <span className="shrink-0 text-[10.5px] tabular-nums" style={{ color: 'var(--map-fg-faint)' }}>
        {count}
      </span>
    </div>
  )
}
