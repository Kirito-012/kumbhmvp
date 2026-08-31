'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePopoverPosition } from '@/lib/use-popover-position'

export type SelectOption = { value: string; label: string; color?: string }

const SIZE_TRIGGER: Record<'sm' | 'md', string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-10 px-3 text-sm',
}

const SIZE_OPTION: Record<'sm' | 'md', string> = {
  sm: 'px-2 py-1.5 text-xs',
  md: 'px-2.5 py-2 text-sm',
}

const SIZE_PILL: Record<'sm' | 'md', string> = {
  sm: 'pl-2.5 pr-2 py-1 text-xs',
  md: 'pl-3 pr-2.5 py-1.5 text-sm',
}

const PILL_MIN_WIDTH = 96

/**
 * Custom-styled dropdown replacing native <select> — the browser's native option list can't be
 * themed (see the unreadable white popup this replaced), so this renders its own popover.
 * The menu is portaled to document.body and fixed-positioned (see usePopoverPosition) so it
 * never gets clipped by an ancestor's overflow (e.g. a table's horizontal-scroll wrapper).
 * Pass `name` to make it participate in a `<form action={...}>` submission via a hidden input,
 * since it's not a real form control.
 */
export function Select({
  value,
  onChange,
  options,
  name,
  placeholder = 'Select…',
  disabled = false,
  variant = 'field',
  size = 'md',
  className,
  menuClassName,
  align = 'left',
}: {
  value: string
  onChange?: (value: string) => void
  options: SelectOption[]
  name?: string
  placeholder?: string
  disabled?: boolean
  variant?: 'field' | 'pill' | 'ghost'
  size?: 'sm' | 'md'
  className?: string
  menuClassName?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)
  const position = usePopoverPosition(triggerRef, open, align)

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
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function choose(next: SelectOption) {
    setOpen(false)
    if (next.value !== value) onChange?.(next.value)
  }

  const triggerVariant = {
    field:
      'w-full border border-border-strong bg-white/[0.03] focus:border-accent/50 focus:bg-white/[0.05] focus:ring-2 focus:ring-accent/20',
    pill: 'w-auto rounded-full border-0 font-medium',
    ghost:
      'w-full border border-border bg-white/[0.02] font-medium text-muted-strong hover:bg-white/[0.06] hover:text-foreground focus:border-accent/40',
  }[variant]

  const pillStyle =
    variant === 'pill' && selected?.color
      ? { backgroundColor: `${selected.color}22`, color: selected.color }
      : undefined

  const menuMinWidth = position
    ? variant === 'pill'
      ? Math.max(position.minWidth, PILL_MIN_WIDTH)
      : position.minWidth
    : undefined

  return (
    <div className={cn('relative', variant === 'pill' ? 'inline-block' : 'w-full')}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={pillStyle}
        className={cn(
          'flex cursor-pointer items-center justify-between gap-2 rounded-lg text-foreground outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          triggerVariant,
          variant === 'pill' ? SIZE_PILL[size] : SIZE_TRIGGER[size],
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {variant === 'pill' && selected?.color && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
              aria-hidden
            />
          )}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{ ...position.style, minWidth: menuMinWidth }}
            className={cn(
              'z-50 overflow-y-auto rounded-lg border border-border bg-background-elevated p-1 shadow-lg',
              menuClassName,
            )}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => choose(o)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-md text-left transition-colors hover:bg-white/[0.06]',
                  SIZE_OPTION[size],
                  o.value === value ? 'text-foreground' : 'text-muted-strong',
                )}
              >
                {o.color && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: o.color }}
                    aria-hidden
                  />
                )}
                <span className="truncate">{o.label}</span>
                {o.value === value && (
                  <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-accent-strong" />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
