'use client'

import { useEffect, useId, useRef, useState } from 'react'
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
 * When the active option has a colour, the trigger becomes a solid fill in
 * that colour (not just a tint) with text flipped to whichever of
 * white/near-black reads against it (see readableTextOn) -- the selection
 * should be readable at a glance, not just hinted at. A trailing "x" clears
 * the selection and returns focus to the search input.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Search…',
  emptyLabel,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  /** Label for the "no filter" option, shown first in the list. Omit to skip it. */
  emptyLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const listboxId = useId()
  const triggerRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const position = usePopoverPosition(triggerRef, open)

  const selected = options.find((o) => o.value === value)
  // Mirrors the map's Class filter: opening the box shows the current
  // selection's label until the user actually types, so it doesn't blank
  // out just from focusing in.
  const inputValue = selected ? search || selected.label : search

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
  const filtered = query ? options.filter((o) => o.label.toLowerCase().includes(query)) : options

  function choose(next: SearchableSelectOption | null) {
    setOpen(false)
    setSearch('')
    onChange(next?.value ?? '')
  }

  const fill = selected?.color ? solidFillColor(selected.color) : undefined
  const fillText = fill ? readableTextOn(fill) : undefined
  const isFilled = Boolean(selected?.color) && !open

  return (
    <div className={cn('relative w-full', className)}>
      <div className="relative">
        {!isFilled && (
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        )}
        <input
          ref={triggerRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          value={inputValue}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const first = filtered[0]
              if (first) choose(first)
            }
            if (e.key === 'Escape') {
              setOpen(false)
              setSearch('')
            }
          }}
          placeholder={placeholder}
          style={
            isFilled && fill
              ? { backgroundColor: fill, borderColor: fill, color: fillText }
              : undefined
          }
          className={cn(
            'h-9 w-full rounded-lg border text-sm outline-none transition-colors',
            isFilled ? 'pl-3 pr-8 font-medium' : 'pl-8 pr-2.5',
            isFilled
              ? 'placeholder:text-current/70'
              : 'border-border-strong bg-overlay text-foreground placeholder:text-muted focus:border-accent/50 focus:bg-overlay-strong focus:ring-2 focus:ring-accent/20',
          )}
        />
        {isFilled && (
          <button
            type="button"
            aria-label={`Clear ${selected?.label} filter`}
            onClick={(e) => {
              e.stopPropagation()
              choose(null)
              triggerRef.current?.focus()
            }}
            style={{ color: fillText, backgroundColor: `${fillText}1a` }}
            className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full opacity-80 transition-opacity hover:opacity-100"
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
            className="z-50 overflow-y-auto rounded-lg border border-border bg-background-elevated p-1 shadow-lg"
          >
            {emptyLabel && (
              <button
                type="button"
                role="option"
                aria-selected={value === ''}
                onClick={() => choose(null)}
                className={cn(
                  'flex w-full cursor-pointer items-center rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-overlay-strong',
                  value === '' ? 'text-foreground' : 'text-muted-strong',
                )}
              >
                {emptyLabel}
              </button>
            )}
            {filtered.length === 0 && <p className="px-2.5 py-2 text-sm text-muted">No matches</p>}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => choose(o)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-overlay-strong',
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
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
