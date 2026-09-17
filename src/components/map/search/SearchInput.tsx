'use client'

import { forwardRef } from 'react'
import { SearchIcon, XIcon } from '@/components/map/icons'

/**
 * Shared search-input-with-icon, extracted from Map mode's own unified search (PLAN-evacuation.md
 * §7.1) so Evacuation mode's search doesn't duplicate the same input chrome. Map mode's own input
 * is a plain filtering textbox with no clear button (its dropdown's own empty state / browse-mode
 * summary line cover that); Evacuation's is a real combobox with roving keyboard highlight and a
 * clear button -- both are opt-in via `combobox`/`onClear` rather than two separate components,
 * since the visual shell (icon, border, focus ring) is identical either way.
 */
const SearchInput = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: (value: string) => void
    onFocus?: () => void
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
    placeholder: string
    ariaLabel: string
    /** Full combobox wiring for a caller that implements roving-highlight keyboard nav over a
     *  listbox (Evacuation's search). Omit for a plain textbox that just filters a group below it
     *  (Map mode's own search -- see its original comment on why it deliberately never claimed
     *  role="combobox" without implementing the roving-focus contract that role promises). */
    combobox?: {
      expanded: boolean
      controls: string
      activeDescendant?: string
    }
    /** Shows an inline clear ("X") button once there's text; the caller decides what clearing
     *  means (Evacuation's also refocuses the input afterward). Omitted entirely for Map mode. */
    onClear?: () => void
  }
>(function SearchInput({ value, onChange, onFocus, onKeyDown, placeholder, ariaLabel, combobox, onClear }, ref) {
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--map-fg-faint)]" />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        {...(combobox
          ? {
              role: 'combobox' as const,
              'aria-autocomplete': 'list' as const,
              'aria-expanded': combobox.expanded,
              'aria-controls': combobox.controls,
              'aria-activedescendant': combobox.activeDescendant,
            }
          : {})}
        style={{
          borderColor: 'var(--map-border)',
          backgroundColor: 'var(--map-input-bg)',
          color: 'var(--map-fg)',
        }}
        className={`w-full rounded-xl border py-2.5 pl-9 ${onClear ? 'pr-8' : 'pr-3'} text-[14px] placeholder:text-[var(--map-fg-faint)] outline-none transition-shadow focus:border-[var(--map-accent)] focus:ring-2 focus:ring-[var(--map-accent)]/25`}
      />
      {onClear && value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--map-fg-faint)] hover:text-[var(--map-fg-muted)]"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
})

export default SearchInput
