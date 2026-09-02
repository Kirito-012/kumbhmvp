'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Search, Ticket as TicketIcon, User as UserIcon, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePopoverPosition } from '@/lib/use-popover-position'

const DEBOUNCE_MS = 200
const MIN_QUERY_LENGTH = 2
const MENU_MIN_WIDTH = 320

type TicketResult = {
  number: number
  subject: string
  status: { name: string; color: string } | null
}
type PersonResult = { id: string; name: string; email: string }
type SearchResponse = { tickets: TicketResult[]; people: PersonResult[] }

// Flattened, in display order, so ArrowUp/ArrowDown/Enter can index into one list regardless of
// which section (Tickets vs People) a result belongs to.
type FlatResult =
  | { kind: 'ticket'; href: string; ticket: TicketResult }
  | { kind: 'person'; href: string; person: PersonResult }

export function GlobalSearch() {
  const router = useRouter()
  const listboxId = useId()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const triggerRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const position = usePopoverPosition(triggerRef, open)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR/hydration guard before the portal can touch document.body, same pattern as NotificationBell.tsx
  useEffect(() => setMounted(true), [])

  const runSearch = useCallback((q: string) => {
    abortRef.current?.abort()
    if (q.trim().length < MIN_QUERY_LENGTH) {
      setResults(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: SearchResponse) => {
        setResults(data)
        setActiveIndex(-1)
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setResults(null)
      })
      .finally(() => setLoading(false))
  }, [])

  function handleChange(value: string) {
    setQuery(value)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS)
  }

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
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const flatResults: FlatResult[] = results
    ? [
        ...results.tickets.map((t): FlatResult => ({
          kind: 'ticket',
          href: `/tickets/${t.number}`,
          ticket: t,
        })),
        ...results.people.map((p): FlatResult => ({
          kind: 'person',
          href: `/tickets?assignee=${p.id}`,
          person: p,
        })),
      ]
    : []

  function goTo(result: FlatResult) {
    setOpen(false)
    setQuery('')
    setResults(null)
    router.push(result.href)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || flatResults.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % flatResults.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + flatResults.length) % flatResults.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = activeIndex >= 0 ? flatResults[activeIndex] : flatResults[0]
      if (target) goTo(target)
    }
  }

  const showEmpty =
    open &&
    query.trim().length >= MIN_QUERY_LENGTH &&
    !loading &&
    results !== null &&
    flatResults.length === 0
  const showHint = open && query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH

  return (
    <div className="relative hidden w-72 shrink-0 sm:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        ref={triggerRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search tickets, people…"
        className="h-9 w-full rounded-lg border border-border bg-overlay pl-9 pr-8 text-sm text-foreground placeholder:text-muted/70 outline-none transition-colors focus:border-accent/40 focus:bg-overlay-strong"
      />
      {loading && (
        <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted" />
      )}

      {mounted &&
        open &&
        position &&
        (results || showHint) &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            style={{ ...position.style, minWidth: Math.max(position.minWidth, MENU_MIN_WIDTH) }}
            className="z-50 overflow-y-auto rounded-lg border border-border bg-background-elevated p-1 shadow-lg"
          >
            {showHint && <p className="px-2.5 py-2 text-xs text-muted">Keep typing to search…</p>}

            {showEmpty && (
              <p className="px-2.5 py-2 text-xs text-muted">
                No matches for &ldquo;{query.trim()}&rdquo;
              </p>
            )}

            {results && results.tickets.length > 0 && (
              <div className="mb-1">
                <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted/70">
                  Tickets
                </p>
                {results.tickets.map((t) => {
                  const flatIdx = flatResults.findIndex(
                    (r) => r.kind === 'ticket' && r.ticket.number === t.number,
                  )
                  return (
                    <button
                      key={t.number}
                      type="button"
                      role="option"
                      aria-selected={flatIdx === activeIndex}
                      onMouseEnter={() => setActiveIndex(flatIdx)}
                      onClick={() =>
                        goTo({ kind: 'ticket', href: `/tickets/${t.number}`, ticket: t })
                      }
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                        flatIdx === activeIndex ? 'bg-overlay-strong' : 'hover:bg-overlay-strong',
                      )}
                    >
                      <TicketIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-foreground">{t.subject}</span>
                      <span className="shrink-0 font-mono text-xs text-muted">#{t.number}</span>
                      {t.status && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: t.status.color }}
                          aria-hidden
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {results && results.people.length > 0 && (
              <div>
                <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted/70">
                  People
                </p>
                {results.people.map((p) => {
                  const flatIdx = flatResults.findIndex(
                    (r) => r.kind === 'person' && r.person.id === p.id,
                  )
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={flatIdx === activeIndex}
                      onMouseEnter={() => setActiveIndex(flatIdx)}
                      onClick={() =>
                        goTo({ kind: 'person', href: `/tickets?assignee=${p.id}`, person: p })
                      }
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                        flatIdx === activeIndex ? 'bg-overlay-strong' : 'hover:bg-overlay-strong',
                      )}
                    >
                      <UserIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-foreground">{p.name}</span>
                      <span className="shrink-0 truncate text-xs text-muted">{p.email}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
