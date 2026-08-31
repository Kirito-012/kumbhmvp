'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Search, Check } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { cn, initialsFor } from '@/lib/utils'
import { usePopoverPosition } from '@/lib/use-popover-position'
import { updateTicketFieldAction } from '@/server/actions/ticket.actions'

type UserOption = { id: string; name: string }
type PersonView = { id: string; name: string; initials: string } | null

const UNASSIGNED = { name: 'Unassigned', initials: '—', color: '#3f3f46' }

export function AssigneeDropdown({
  ticketNumber,
  assignee,
  users,
  disabled,
}: {
  ticketNumber: number
  assignee: PersonView
  users: UserOption[]
  disabled: boolean
}) {
  const [current, setCurrent] = useState(assignee)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pending, startTransition] = useTransition()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const position = usePopoverPosition(triggerRef, open)

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
        setQuery('')
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const filtered = useMemo(
    () => users.filter((u) => (u.name ?? '').toLowerCase().includes(query.trim().toLowerCase())),
    [users, query],
  )

  function choose(user: UserOption | null) {
    setCurrent(user ? { id: user.id, name: user.name, initials: initialsFor(user.name) } : null)
    setOpen(false)
    setQuery('')
    startTransition(async () => {
      try {
        await updateTicketFieldAction(ticketNumber, { assigneeId: user?.id ?? null })
      } catch {
        setCurrent(assignee)
      }
    })
  }

  const person = current
    ? { name: current.name, initials: current.initials, color: '#10b981' }
    : UNASSIGNED

  if (disabled) {
    return (
      <div className="flex items-center gap-2">
        <Avatar person={person} size="sm" />
        <span className="truncate text-xs text-muted-strong">{current?.name ?? 'Unassigned'}</span>
      </div>
    )
  }

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/[0.06] disabled:cursor-wait disabled:opacity-60"
      >
        <Avatar person={person} size="sm" />
        <span className="max-w-[120px] truncate text-xs text-muted-strong">
          {current?.name ?? 'Unassigned'}
        </span>
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            style={{ ...position.style, minWidth: Math.max(position.minWidth, 224) }}
            className="z-50 flex flex-col rounded-lg border border-border bg-background-elevated p-2 shadow-lg"
          >
            <div className="relative mb-1.5 shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                className="h-8 w-full rounded-md border border-border-strong bg-white/[0.03] pl-8 pr-2 text-xs text-foreground placeholder:text-muted/60 outline-none focus:border-accent/50"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <button
                type="button"
                onClick={() => choose(null)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-strong hover:bg-white/[0.06]"
              >
                <Avatar person={UNASSIGNED} size="sm" />
                Unassigned
                {!current && <Check className="ml-auto h-3.5 w-3.5 text-accent-strong" />}
              </button>
              {filtered.length === 0 && <p className="px-2 py-2 text-xs text-muted">No matches</p>}
              {filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => choose(u)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/[0.06]',
                    current?.id === u.id ? 'text-foreground' : 'text-muted-strong',
                  )}
                >
                  <Avatar
                    person={{ name: u.name, initials: initialsFor(u.name), color: '#9ca3af' }}
                    size="sm"
                  />
                  <span className="truncate">{u.name}</span>
                  {current?.id === u.id && (
                    <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-accent-strong" />
                  )}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
