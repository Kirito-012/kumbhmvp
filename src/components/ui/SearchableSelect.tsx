'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePopoverPosition } from '@/lib/use-popover-position'
import { readableTextOn, solidFillColor } from '@/lib/classColors'

export type SearchableSelectOption = { value: string; label: string; color?: string }

/**
 * Type-to-filter combobox: a text input that doubles as the trigger (typing
 * filters the portaled listbox below it), with an optional colour dot per
 * option — mirrors the map's Class filter (MapView.tsx) but themed for
 * light/dark, and portaled via usePopoverPosition so it can't get clipped
 * inside a scrolling toolbar.
 *
 * When there's a colour for the active option (its own, or `selectionColor`
 * for lists where a per-option dot would carry no information) the closed
 * trigger becomes a solid fill in that colour with text flipped to whichever
 * of white/near-black reads against it (see readableTextOn) -- the selection
 * should be readable at a glance, not just hinted at. A trailing "x" clears
 * the selection and returns focus to the search input.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Search…',
  emptyLabel,
  selectionColor,
  className,
  inputClassName,
  menuClassName,
}: {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  /** Label for the "no filter" option, shown first in the list. Omit to skip it. */
  emptyLabel?: string
  /** Fill colour for the closed trigger when a selection is active, for lists whose options
   *  don't each carry their own colour. A per-option `color` still wins when present. */
  selectionColor?: string
  className?: string
  /** Extra classes for the input itself — for hosts whose surface the app-wide input tokens
   *  aren't tuned against (e.g. the dashboard's fixed-dark category panel). */
  inputClassName?: string
  /** Extra classes for the portaled listbox, for the same reason as `inputClassName`. */
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listboxId = useId()
  const triggerRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const position = usePopoverPosition(triggerRef, open)

  const selected = options.find((o) => o.value === value)

  // Open = a search box (empty to start, with the selection demoted to the placeholder); closed =
  // a label. Carrying the selection in `value` while open is what made typing *append* to it --
  // "Ram" after picking sector 3 became "3. RANIPUR-03CHANDIRam" and matched nothing.
  const inputValue = open ? search : (selected?.label ?? '')

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const query = search.trim().toLowerCase()
  const filtered = useMemo(
    () => (query ? options.filter((o) => o.label.toLowerCase().includes(query)) : options),
    [options, query],
  )

  // One flat list so the keyboard treats the "clear" row as just another option. `null` is that
  // row; everything else is a real option.
  const rows = useMemo<(SearchableSelectOption | null)[]>(
    () => (emptyLabel ? [null, ...filtered] : filtered),
    [emptyLabel, filtered],
  )

  // Keep the highlighted row inside the scroll box, so arrowing past the ~7 visible rows of a
  // 33-sector list actually goes somewhere visible.
  useEffect(() => {
    if (!open) return
    menuRef.current
      ?.querySelector(`[data-row-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  function openMenu() {
    setSearch('')
    setActiveIndex(0)
    setOpen(true)
  }

  function choose(next: SearchableSelectOption | null) {
    setOpen(false)
    setSearch('')
    onChange(next?.value ?? '')
  }

  const fillSource = selected ? (selected.color ?? selectionColor) : undefined
  const fill = fillSource ? solidFillColor(fillSource) : undefined
  const fillText = fill ? readableTextOn(fill) : undefined
  const isFilled = Boolean(fill) && !open
  const hasDots = options.some((o) => o.color)

  return (
    <div className={cn('relative w-full text-muted', className)}>
      <div className="relative">
        {!isFilled && (
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-current" />
        )}
        <input
          ref={triggerRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listboxId}-row-${activeIndex}` : undefined}
          value={inputValue}
          onFocus={openMenu}
          // Focus alone can't reopen the menu after choosing: `choose` closes it while the input
          // still holds focus, so the next click fires no focus event at all and nothing happens.
          onMouseDown={() => {
            if (!open) openMenu()
          }}
          onChange={(e) => {
            const next = e.target.value
            setSearch(next)
            // Re-filtering shrinks the list under the highlight; leaving it where it was would
            // ring a different option than the one Enter goes on to pick. Once a query is typed
            // the highlight skips the "clear" row too: Enter on it would wipe the very filter
            // being typed, which is the opposite of what someone mid-search is asking for.
            setActiveIndex(emptyLabel && next.trim() ? 1 : 0)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (!open) {
                openMenu()
                return
              }
              const delta = e.key === 'ArrowDown' ? 1 : -1
              setActiveIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(rows.length - 1, 0)))
            }
            if (e.key === 'Home' && open) {
              e.preventDefault()
              setActiveIndex(0)
            }
            if (e.key === 'End' && open) {
              e.preventDefault()
              setActiveIndex(Math.max(rows.length - 1, 0))
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (open && activeIndex < rows.length) choose(rows[activeIndex])
            }
            if (e.key === 'Escape') {
              setOpen(false)
              setSearch('')
            }
          }}
          placeholder={open && selected ? selected.label : placeholder}
          style={
            isFilled && fill
              ? { backgroundColor: fill, borderColor: fill, color: fillText }
              : undefined
          }
          className={cn(
            'h-9 w-full rounded-lg border text-sm outline-none transition-colors',
            isFilled ? 'pl-3 pr-9 font-medium' : 'pl-8 pr-2.5',
            isFilled
              ? 'placeholder:text-current/70'
              : cn(
                  'border-border-strong bg-overlay text-foreground placeholder:text-muted focus:border-accent/50 focus:bg-overlay-strong focus:ring-2 focus:ring-accent/20',
                  inputClassName,
                ),
          )}
        />
        {isFilled && (
          <button
            type="button"
            aria-label={`Clear ${selected?.label} filter`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              choose(null)
              triggerRef.current?.focus()
            }}
            style={{ color: fillText, backgroundColor: `${fillText}1a` }}
            // 24px square, to clear WCAG 2.5.8's minimum target size on touch.
            className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full opacity-80 transition-opacity hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            style={{ ...position.style, minWidth: position.minWidth }}
            className={cn(
              'z-50 overflow-y-auto rounded-lg border border-border-strong bg-background-elevated p-1 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.55)]',
              menuClassName,
            )}
          >
            {emptyLabel && (
              <button
                type="button"
                role="option"
                id={`${listboxId}-row-0`}
                data-row-index={0}
                aria-selected={value === ''}
                onMouseEnter={() => setActiveIndex(0)}
                onClick={() => choose(null)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                  activeIndex === 0 && 'bg-overlay-strong',
                  value === '' ? 'text-foreground' : 'text-muted-strong',
                )}
              >
                {/* Spacer matching the option dots, so this row's label starts on the same left
                    edge as every other one instead of jogging 18px inward at the top of the list. */}
                {hasDots && <span className="h-2.5 w-2.5 shrink-0" aria-hidden />}
                <span className="truncate">{emptyLabel}</span>
              </button>
            )}
            {filtered.length === 0 && <p className="px-2.5 py-2 text-sm text-muted">No matches</p>}
            {filtered.map((o, i) => {
              const rowIndex = emptyLabel ? i + 1 : i
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  id={`${listboxId}-row-${rowIndex}`}
                  data-row-index={rowIndex}
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActiveIndex(rowIndex)}
                  onClick={() => choose(o)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    activeIndex === rowIndex && 'bg-overlay-strong',
                    o.value === value ? 'text-foreground' : 'text-muted-strong',
                  )}
                >
                  {o.color && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: o.color }}
                      aria-hidden
                    />
                  )}
                  <span className="truncate">{o.label}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
