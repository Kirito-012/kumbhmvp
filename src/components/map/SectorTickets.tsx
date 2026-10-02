'use client'

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  CircleDot,
  CirclePlus,
  Clock,
  CornerDownRight,
  MapPin,
  SearchX,
} from 'lucide-react'
import { SearchIcon, XIcon } from '@/components/map/icons'
import {
  UNSPECIFIED_SUBCLASS,
  Highlight,
  formatDonePct,
  type CategoryRow,
  type SubRow,
  type Tally,
  type WorkDoneSummary,
} from '@/components/map/SectorWorkDone'
import { useInsightTheme } from '@/components/map/insights/useInsightTheme'
import {
  InlineError,
  STACK_ORDER,
  cssVar,
  doneTextColor,
  formatDuration,
  prefersReducedMotion,
  statusOpacity,
  useGrown,
  useTween,
  useTweenTo,
} from '@/components/map/workDoneUi'
import { CLASS_GROUP_COLORS } from '@/lib/classColors'
import type { Theme } from '@/lib/insights/heatScale'
import { BUCKET_COLORS, BUCKET_LABELS, type StatusBucket } from '@/lib/insights/statusBuckets'
import { TicketField, type InsightsTicketData } from '@/lib/insights/types'

// "Tickets" view of the Work Done tab: an explorer for the sector's tickets.
//   Search (top)        one box: jump to a category, sub-category or ticket, or filter the list
//   Categories (rail)   pick a category -- or the whole sector -- and see how done it is
//   Detail (right)      hero (progress, status split as filter chips, oldest / median)
//                       -> sub-categories (drill in) -> the tickets themselves, each a link
// Below ~900px wide the rail becomes a row of chips above the detail.

type SectorTicket = {
  number: number
  bucket: StatusBucket
  statusName: string
  priorityName: string
  /** Only the top two priorities get a colour; the rest are neutral so the dot means "urgent". */
  priorityColor: string
  priorityOrder: number
  category: string
  subclass: string
  createdAt: number
  resolvedAt: number | null
  /** The map parcel the ticket was filed against, and where it sits (for "Locate"). */
  parcelId: number
  lng: number
  lat: number
}

/** Every ticket filed in this sector, from the bulk tuples the drawer already holds. */
function collectTickets(data: InsightsTicketData, sectorNo: number): SectorTicket[] {
  const topRank = data.priorities.reduce((m, p) => Math.max(m, p.order), 0)
  const out: SectorTicket[] = []
  for (const t of data.tickets) {
    if (t[TicketField.SectorNo] !== sectorNo) continue
    const status = data.statuses[t[TicketField.StatusIdx]]
    const priority = data.priorities[t[TicketField.PriorityIdx]]
    const subIdx = t[TicketField.SubclassIdx]
    out.push({
      number: t[TicketField.Number],
      bucket: status?.bucket ?? 'open',
      statusName: status?.name ?? BUCKET_LABELS.open,
      priorityName: priority?.name ?? '',
      priorityColor:
        priority && priority.order > 0 && priority.order >= topRank - 1
          ? priority.color
          : 'var(--map-fg-faint)',
      priorityOrder: priority?.order ?? 0,
      category: data.classGroups[t[TicketField.ClassGroupIdx]] ?? 'Other',
      subclass: (subIdx >= 0 ? data.subclasses[subIdx] : null) || UNSPECIFIED_SUBCLASS,
      createdAt: t[TicketField.CreatedAt],
      resolvedAt: t[TicketField.ResolvedAt],
      parcelId: t[TicketField.SectorPlanId],
      lng: t[TicketField.Lng],
      lat: t[TicketField.Lat],
    })
  }
  return out
}

type RailSort = 'most' | 'remaining' | 'completion' | 'az'
const RAIL_SORTS: { key: RailSort; label: string; title: string }[] = [
  { key: 'most', label: 'Largest', title: 'Largest categories first' },
  { key: 'remaining', label: 'To do', title: 'Most unresolved tickets first' },
  { key: 'completion', label: '% done', title: 'Highest completion first' },
  { key: 'az', label: 'A–Z', title: 'Alphabetical' },
]

const ratio = (t: Tally) => (t.total > 0 ? t.resolved / t.total : 0)

function sortCategories(rows: CategoryRow[], key: RailSort) {
  const byName = (a: CategoryRow, b: CategoryRow) => a.name.localeCompare(b.name)
  const sorted = [...rows]
  switch (key) {
    case 'most':
      return sorted.sort((a, b) => b.total - a.total || byName(a, b))
    case 'remaining':
      // By outstanding count, not ratio: a 0/1 category must not outrank 0/200.
      return sorted.sort(
        (a, b) =>
          b.total - b.resolved - (a.total - a.resolved) || ratio(a) - ratio(b) || byName(a, b),
      )
    case 'completion':
      return sorted.sort((a, b) => ratio(b) - ratio(a) || b.total - a.total || byName(a, b))
    case 'az':
      return sorted.sort(byName)
  }
}

type TicketSort = 'priority' | 'newest' | 'oldest'
const TICKET_SORTS: { key: TicketSort; label: string; title: string }[] = [
  {
    key: 'priority',
    label: 'Priority',
    title: 'Grouped by priority; the longest-waiting first within each group',
  },
  { key: 'newest', label: 'Newest', title: 'Most recently created first' },
  { key: 'oldest', label: 'Longest wait', title: 'Unresolved first, longest waiting first' },
]

function sortTickets(list: SectorTicket[], key: TicketSort) {
  const settled = (t: SectorTicket) => (t.bucket === 'resolved' ? 1 : 0)
  const out = [...list]
  switch (key) {
    case 'priority':
      return out.sort(
        (a, b) =>
          settled(a) - settled(b) ||
          b.priorityOrder - a.priorityOrder ||
          // A queue: whoever has waited longest is on top. Resolved ones: latest finished first.
          (settled(a)
            ? (b.resolvedAt ?? b.createdAt) - (a.resolvedAt ?? a.createdAt)
            : a.createdAt - b.createdAt) ||
          a.number - b.number,
      )
    case 'newest':
      return out.sort((a, b) => b.createdAt - a.createdAt || b.number - a.number)
    case 'oldest':
      return out.sort((a, b) => settled(a) - settled(b) || a.createdAt - b.createdAt)
  }
}

/** Resolved tickets form one trailing group; the rest are grouped by priority. */
const groupOf = (t: SectorTicket) =>
  t.bucket === 'resolved' ? 'Resolved' : t.priorityName || 'No priority'

/** Oldest still-unresolved ticket and the median time-to-resolve, over the tickets in scope. */
function scopeFacts(list: SectorTicket[], now: number) {
  let oldest: SectorTicket | null = null
  const took: number[] = []
  for (const t of list) {
    if (t.bucket !== 'resolved') {
      if (!oldest || t.createdAt < oldest.createdAt) oldest = t
    } else if (t.resolvedAt != null) {
      took.push(t.resolvedAt - t.createdAt)
    }
  }
  took.sort((a, b) => a - b)
  const mid = took.length >> 1
  const medianMs =
    took.length === 0 ? null : took.length % 2 ? took[mid] : (took[mid - 1] + took[mid]) / 2
  return {
    oldest: oldest ? { number: oldest.number, ageMs: now - oldest.createdAt } : null,
    medianHours: medianMs == null ? null : medianMs / 3_600_000,
  }
}

const DAY_MS = 86_400_000
/** How long an unresolved ticket may wait before it is flagged, then flagged as overdue. */
const WAIT_WARN_MS = 3 * DAY_MS
const WAIT_ALERT_MS = 5 * DAY_MS

/** Colour for a wait: nothing special while it is young, amber then red as it drags on. */
function waitColor(ms: number) {
  if (ms >= WAIT_ALERT_MS) return 'var(--danger)'
  if (ms >= WAIT_WARN_MS) return '#f59e0b'
  return 'var(--map-fg-muted)'
}

const ageLabel = (ms: number) => {
  const h = Math.max(0, ms) / 3_600_000
  return h < 48 ? `${Math.max(1, Math.round(h))} h` : `${Math.floor(h / 24)} d`
}

/** How long an unresolved ticket has been waiting, or how long a resolved one took. */
const spanMs = (t: SectorTicket, now: number) =>
  Math.max(0, (t.bucket === 'resolved' && t.resolvedAt != null ? t.resolvedAt : now) - t.createdAt)

const stamp = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

const num = (n: number) => n.toLocaleString('en-IN')
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

const ALL = '__all__'
const PAGE = 12
const PAGE_MORE = 24
const MAX_SUBS = 6

/** Rail + detail side by side from this container width up; chips + detail below it. */
const LAYOUT = 'grid grid-cols-1 gap-3 @min-[900px]:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]'
const PANEL_STYLE: CSSProperties = {
  backgroundColor: 'var(--map-surface-alt)',
  borderColor: 'var(--map-border)',
}
const SUB_GRID = 'grid grid-cols-[minmax(8rem,14rem)_7.5rem_minmax(0,1fr)] items-center gap-x-3'
/** The page's own columns once there is room (container >= 1300px), see TicketRow. */
const ROW_COLS = '@min-[1300px]:grid-cols-[1.25rem_3.75rem_minmax(0,1fr)_9rem_7.5rem_5rem]'

const STATUS_ICON: Record<StatusBucket, typeof Check> = {
  resolved: Check,
  pending: Clock,
  open: CircleDot,
  new: CirclePlus,
}

const categoryColor = (name: string) =>
  CLASS_GROUP_COLORS[name] ?? CLASS_GROUP_COLORS.Other ?? '#94a3b8'

// ─── Motion ─────────────────────────────────────────────────────────────────────────────────

/**
 * `intro`: the view's opening choreography should play (first visit). `interacted`: the user has
 * already acted on it, so anything that mounts from now on (a new category's rows) is a response
 * to them and staggers from the start rather than queuing behind the intro.
 */
const MotionCtx = createContext({ intro: true, interacted: false })

/**
 * Entrance settings for one element, read ONCE at mount: adding the rise class to an element that
 * is already on screen would replay its animation.
 */
function useMotion(introBase: number, late = false) {
  const { intro, interacted } = useContext(MotionCtx)
  // `late`: mounting because the user scrolled for more rows -- a response, not part of the opening.
  const [m] = useState(() => {
    const quick = interacted || late
    return { rise: intro, quick, base: quick ? 0 : introBase }
  })
  return {
    rise: m.rise,
    quick: m.quick,
    cls: m.rise ? 'row-rise ' : '',
    at: (i: number): CSSProperties => ({
      ...cssVar('--i', m.base + Math.min(i, 10)),
      // A response to the user: shorter and tighter than the opening sequence.
      // (and travels only a few px, so rows rising don't fight the list sliding down under them)
      ...(m.quick ? { '--rd': '220ms', '--rs': '16ms', '--ry': '3px' } : null),
    }),
  }
}

/**
 * Eases the height of what it wraps as its content changes (a new category's sub-list, "show
 * all"), and collapses to nothing when `open` is false -- so the tickets below glide into place
 * instead of jumping. Painted over a little padding so focus rings and hover fills aren't clipped.
 */
function GlideHeight({ open, children }: { open: boolean; children: ReactNode }) {
  const [inner, setInner] = useState<HTMLDivElement | null>(null)
  const [h, setH] = useState<number | null>(null)
  useEffect(() => {
    if (!inner) return
    const ro = new ResizeObserver(() => setH(inner.offsetHeight))
    ro.observe(inner)
    return () => ro.disconnect()
  }, [inner])
  return (
    <div
      className={`-mx-3 -my-1 overflow-hidden px-3 py-1 ${
        open
          ? 'motion-safe:transition-[height] motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]'
          : 'invisible motion-safe:[transition:height_260ms_cubic-bezier(0.22,1,0.36,1),visibility_0s_260ms]'
      }`}
      style={{ height: !open ? 0 : h === null ? undefined : h + 8 }}
      aria-hidden={open ? undefined : true}
    >
      <div ref={setInner}>{children}</div>
    </div>
  )
}

/**
 * Re-sorting the rail would teleport its rows; this slides each one from where it was to where
 * it now is (FLIP). `order` changes only when the sequence does.
 */
function useFlip(order: string) {
  const els = useRef(new Map<string, HTMLElement>())
  const tops = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion()
    els.current.forEach((el, key) => {
      if (el.offsetParent === null) return // not laid out (narrow layout): nothing to measure
      const top = el.offsetTop
      const prev = tops.current.get(key)
      if (!reduced && prev !== undefined && prev !== top && typeof el.animate === 'function') {
        el.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'translateY(0)' }], {
          duration: 340,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        })
      }
      tops.current.set(key, top)
    })
  }, [order])
  return (key: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(key, el)
    else els.current.delete(key)
  }
}

/** Bumps whenever `value` changes, so a keyed span can fade the new text in. */
function useSwaps(value: string) {
  const [prev, setPrev] = useState(value)
  const [swaps, setSwaps] = useState(0)
  if (prev !== value) {
    setPrev(value)
    setSwaps((n) => n + 1)
  }
  return swaps
}

/** The nearest ancestor that scrolls (null: the page itself). */
function scrollParent(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return p
  }
  return null
}

/** A count that glides to its new value (like the % beside it) instead of jumping. */
function Count({ value }: { value: number }) {
  const v = useTweenTo(value, { intro: false, introMs: 0, introDelay: 0, ms: 450 })
  return <>{num(Math.round(v))}</>
}

/** Soft edge where a scroll area continues past the visible part. */
function useScrollFade<T extends HTMLElement>(axis: 'x' | 'y') {
  const [el, setEl] = useState<T | null>(null)
  const [edge, setEdge] = useState({ start: false, end: false })
  useEffect(() => {
    if (!el) return
    const update = () => {
      const pos = axis === 'y' ? el.scrollTop : el.scrollLeft
      const size = axis === 'y' ? el.clientHeight : el.clientWidth
      const total = axis === 'y' ? el.scrollHeight : el.scrollWidth
      const start = pos > 2
      const end = pos + size < total - 2
      setEdge((e) => (e.start === start && e.end === end ? e : { start, end }))
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [el, axis])
  const dir = axis === 'y' ? 'to bottom' : 'to right'
  const mask = `linear-gradient(${dir}, transparent 0, #000 ${edge.start ? 24 : 0}px, #000 calc(100% - ${edge.end ? 28 : 0}px), transparent 100%)`
  return [setEl, { maskImage: mask, WebkitMaskImage: mask } as CSSProperties] as const
}

// ─── Small parts ────────────────────────────────────────────────────────────────────────────

/**
 * Status split as one bar. `reveal` (0..1) is how much of it has been wiped in from the left; the
 * segments' own widths glide when the counts change, so switching category re-proportions the bar
 * instead of redrawing it. The track shows through as the 1px gaps between segments.
 */
function StatusBar({
  counts,
  total,
  height,
  reveal,
  smooth = false,
  delay = 0,
  active = null,
  className = '',
}: {
  counts: Tally['counts']
  total: number
  height: number
  reveal: number
  /** A status filter in force: the other segments recede. */
  active?: StatusBucket | null
  /** Ease `reveal` with a CSS transition (it is a plain 0 -> 1 flip) rather than driving it per frame. */
  smooth?: boolean
  delay?: number
  className?: string
}) {
  const theme = useInsightTheme()
  const first = STACK_ORDER.find((b) => counts[b] > 0)
  return (
    <div
      className={`overflow-hidden rounded-full ${className}`}
      style={{
        height,
        backgroundColor: 'color-mix(in srgb, var(--map-switch-track) 45%, transparent)',
      }}
      aria-hidden="true"
    >
      <div
        className={`flex h-full w-full ${smooth ? 'motion-safe:transition-[clip-path] motion-safe:duration-[650ms] motion-safe:ease-out motion-safe:[transition-delay:var(--d)]' : ''}`}
        style={{
          ...cssVar('--d', `${delay}ms`),
          clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`,
        }}
      >
        {total > 0 &&
          STACK_ORDER.map((b) => (
            <span
              key={b}
              className="block h-full motion-safe:transition-[flex-grow,margin-left,opacity] motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                flexGrow: counts[b],
                flexBasis: 0,
                minWidth: counts[b] > 0 ? 3 : 0,
                marginLeft: counts[b] > 0 && b !== first ? 1 : 0,
                backgroundColor: BUCKET_COLORS[b][theme],
                opacity: active && active !== b ? 0.18 : statusOpacity(b, theme),
              }}
            />
          ))}
      </div>
    </div>
  )
}

/** A category's identity colour: a slim bar, so it can't be mistaken for a checkbox or a status dot. */
function Swatch({ color }: { color: string }) {
  return (
    <span
      className="h-3.5 w-[3px] shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  )
}

function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
  className = '',
}: {
  label: string
  options: { key: K; label: string; title: string }[]
  value: K
  onChange: (key: K) => void
  className?: string
}) {
  // A toggle-button group (aria-pressed), not role=radiogroup: that role promises a roving
  // tabindex and arrow keys this doesn't implement.
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex rounded-lg border p-0.5 ${className}`}
      style={{ borderColor: 'var(--map-border)', backgroundColor: 'var(--map-surface-alt)' }}
    >
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            title={o.title}
            onClick={() => onChange(o.key)}
            className="flex-1 cursor-pointer whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
            style={
              active
                ? { backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }
                : { color: 'var(--map-fg-muted)' }
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Search ─────────────────────────────────────────────────────────────────────────────────

/** Words typed, lower-cased ("#2043 critical" -> ["2043", "critical"]). */
const searchTokens = (q: string) => q.toLowerCase().replace(/#/g, ' ').split(/\s+/).filter(Boolean)

/** What a ticket is searched by: what its row shows, plus its status and priority. */
function ticketHaystack(t: SectorTicket, plot: string | undefined) {
  const where = plot ? `plot ${plot}` : `parcel ${t.parcelId}`
  return `${t.number} ${t.subclass} ${t.category} ${where} ${t.statusName} ${BUCKET_LABELS[t.bucket]} ${t.priorityName}`.toLowerCase()
}

/** Every word must appear somewhere ("critical parking" = critical AND parking). */
const matchesTokens = (tokens: string[], t: SectorTicket, plot: string | undefined) => {
  const hay = ticketHaystack(t, plot)
  return tokens.every((tok) => hay.includes(tok))
}

type Hit =
  | { kind: 'category'; id: string; cat: CategoryRow }
  | { kind: 'sub'; id: string; cat: CategoryRow; sub: SubRow }
  | { kind: 'ticket'; id: string; ticket: SectorTicket }
  | { kind: 'all'; id: string; count: number }

const HIT_LIMITS = { category: 4, sub: 5, ticket: 6 }

/** Everything the search box can take you to: categories, sub-categories, tickets, or the list. */
function findHits(
  q: string,
  categories: CategoryRow[],
  tickets: SectorTicket[],
  plots: ReadonlyMap<number, string> | undefined,
) {
  const tokens = searchTokens(q)
  const hits: Hit[] = []
  if (tokens.length === 0) return { tokens, hits, defaultId: null as string | null, matched: 0 }
  const nameHit = (name: string) => {
    const n = name.toLowerCase()
    return tokens.every((tok) => n.includes(tok))
  }
  for (const c of categories.filter((c) => nameHit(c.name)).slice(0, HIT_LIMITS.category)) {
    hits.push({ kind: 'category', id: `c:${c.name}`, cat: c })
  }
  let subs = 0
  // (A category with just one sub-category has nothing to drill into, so its sub-category isn't offered.)
  outer: for (const c of categories) {
    if (c.subs.length <= 1) continue
    for (const s of c.subs) {
      if (s.name === c.name || !nameHit(s.name)) continue
      hits.push({ kind: 'sub', id: `s:${c.name}/${s.name}`, cat: c, sub: s })
      if (++subs >= HIT_LIMITS.sub) break outer
    }
  }
  const matched = sortTickets(
    tickets.filter((t) => matchesTokens(tokens, t, plots?.get(t.number))),
    'priority',
  )
  // Typing a ticket's number puts that ticket first.
  const digits = /^#?\d+$/.test(q.trim()) ? q.trim().replace('#', '') : null
  if (digits)
    matched.sort(
      (a, b) => Number(String(b.number) === digits) - Number(String(a.number) === digits),
    )
  for (const t of matched.slice(0, HIT_LIMITS.ticket)) {
    hits.push({ kind: 'ticket', id: `t:${t.number}`, ticket: t })
  }
  if (matched.length > 1) hits.push({ kind: 'all', id: 'all', count: matched.length })

  // Enter goes where the words most likely point: a category or sub-category by name; a ticket by
  // its number; otherwise, a status / priority / plot word, the list of every ticket matching.
  const first = hits[0]
  let defaultId: string | null = first?.id ?? null
  if (first && first.kind !== 'category' && first.kind !== 'sub') {
    const exact =
      digits && hits.find((h) => h.kind === 'ticket' && String(h.ticket.number) === digits)
    defaultId = exact ? exact.id : (hits.find((h) => h.kind === 'all')?.id ?? first.id)
  }
  return { tokens, hits, defaultId, matched: matched.length }
}

const SECTION_LABEL: Record<Exclude<Hit['kind'], 'all'>, string> = {
  category: 'Categories',
  sub: 'Sub-categories',
  ticket: 'Tickets',
}

/**
 * The view's one search box. Typing lists what matches -- categories, sub-categories and tickets
 * (by number, name, plot, status or priority) -- and Enter or a click goes there; "Show all N
 * matching tickets" turns the text into a live filter on the ticket list. A combobox: arrow keys
 * move through the results, Esc closes them, and a second Esc clears the text.
 */
function SearchHub({
  value,
  onChange,
  applied,
  hits,
  defaultId,
  tokens,
  matched,
  onPick,
  onClear,
  boundsRef,
  now,
  plots,
}: {
  value: string
  onChange: (value: string) => void
  /** The text is currently filtering the ticket list. */
  applied: boolean
  hits: Hit[]
  defaultId: string | null
  tokens: string[]
  /** Tickets matching in the whole sector (the list shows only a few of them). */
  matched: number
  onPick: (hit: Hit) => void
  onClear: () => void
  /** The view's own box: the results list is kept inside it. */
  boundsRef: RefObject<HTMLElement | null>
  now: number
  plots: ReadonlyMap<number, string> | undefined
}) {
  const theme = useInsightTheme()
  const { cls, at } = useMotion(0)
  const uid = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  // Esc closes the results but keeps the text.
  const [closed, setClosed] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [maxH, setMaxH] = useState(380)
  const q = value.trim()
  const open = focused && q !== '' && !closed
  let idx = hits.findIndex((h) => h.id === activeId)
  if (idx < 0)
    idx = Math.max(
      0,
      hits.findIndex((h) => h.id === defaultId),
    )
  const active = hits[idx]

  function measure() {
    const bounds = boundsRef.current?.getBoundingClientRect()
    const me = wrapRef.current?.getBoundingClientRect()
    if (bounds && me) setMaxH(Math.max(180, Math.min(460, bounds.bottom - me.bottom - 16)))
  }
  function pick(h: Hit) {
    onPick(h)
    setClosed(true)
  }
  const mark = (text: string) => (
    <Highlight text={text} query={tokens.find((t) => text.toLowerCase().includes(t)) ?? ''} />
  )
  // Props shared by every result: the input keeps focus (mouse-down is cancelled) and the pointer
  // sets the highlighted result.
  const optionProps = (i: number, h: Hit) => ({
    id: `${uid}-${i}`,
    role: 'option' as const,
    'aria-selected': i === idx,
    onMouseMove: () => setActiveId(h.id),
    onMouseDown: (e: ReactMouseEvent) => e.preventDefault(),
    className:
      'flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[13px] outline-none',
    style: i === idx ? { backgroundColor: 'var(--map-accent-bg)' } : undefined,
  })

  const sections: ReactNode[] = []
  let lastKind: Hit['kind'] | null = null
  hits.forEach((h, i) => {
    if (h.kind !== lastKind && h.kind !== 'all') {
      sections.push(
        <div
          key={`head-${h.kind}`}
          role="presentation"
          className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide first:pt-1.5"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          {SECTION_LABEL[h.kind]}
          {h.kind === 'ticket' && matched > HIT_LIMITS.ticket ? (
            <span className="ml-1.5 font-normal normal-case tracking-normal tabular-nums">
              {num(HIT_LIMITS.ticket)} of {num(matched)}
            </span>
          ) : null}
        </div>,
      )
    }
    lastKind = h.kind
    const key = h.id
    if (h.kind === 'category') {
      const left = h.cat.total - h.cat.resolved
      sections.push(
        <div key={key} {...optionProps(i, h)} onClick={() => pick(h)}>
          <Swatch color={categoryColor(h.cat.name)} />
          <span className="min-w-0 flex-1 truncate font-medium" style={{ color: 'var(--map-fg)' }}>
            {mark(h.cat.name)}
          </span>
          <span
            className="shrink-0 text-[12px] tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {left === 0 ? 'Done' : `${num(left)} left`} · {formatDonePct(h.cat)}
          </span>
        </div>,
      )
    } else if (h.kind === 'sub') {
      sections.push(
        <div key={key} {...optionProps(i, h)} onClick={() => pick(h)}>
          <CornerDownRight
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: 'var(--map-fg-muted)' }}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--map-fg)' }}>
            <span className="font-medium">{mark(h.sub.name)}</span>
            <span style={{ color: 'var(--map-fg-muted)' }}> in {h.cat.name}</span>
          </span>
          <span
            className="shrink-0 text-[12px] tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {plural(h.sub.total, 'ticket')}
          </span>
        </div>,
      )
    } else if (h.kind === 'ticket') {
      const t = h.ticket
      const Icon = STATUS_ICON[t.bucket]
      const resolved = t.bucket === 'resolved'
      const plot = plots?.get(t.number)
      const span = spanMs(t, now)
      const wait = resolved
        ? t.resolvedAt != null
          ? `Resolved in ${ageLabel(t.resolvedAt - t.createdAt)}`
          : 'Resolved'
        : `Waiting ${ageLabel(span)}`
      sections.push(
        <a
          key={key}
          href={`/tickets/${t.number}`}
          target="_blank"
          rel="noopener noreferrer"
          {...optionProps(i, h)}
          onClick={() => setClosed(true)}
        >
          <Icon
            className="h-4 w-4 shrink-0"
            strokeWidth={2.25}
            style={{ color: resolved ? doneTextColor(theme) : BUCKET_COLORS[t.bucket][theme] }}
            aria-hidden="true"
          />
          <span className="shrink-0 tabular-nums" style={{ color: 'var(--map-fg-muted)' }}>
            #{mark(String(t.number))}
          </span>
          <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--map-fg)' }}>
            <span className="font-medium">{mark(t.subclass)}</span>
            <span style={{ color: 'var(--map-fg-muted)' }}>
              {' '}
              · {mark(plot ? `Plot ${plot}` : `Parcel ${t.parcelId}`)}
              {t.priorityName ? <> · {mark(t.priorityName)}</> : null}
            </span>
          </span>
          <span
            className="shrink-0 text-[12px] tabular-nums"
            style={{
              color: resolved
                ? doneTextColor(theme)
                : span >= WAIT_ALERT_MS
                  ? 'var(--danger)'
                  : 'var(--map-fg-muted)',
            }}
          >
            {wait}
          </span>
        </a>,
      )
    } else {
      const p = optionProps(i, h)
      sections.push(
        <div
          key={key}
          {...p}
          onClick={() => pick(h)}
          className={`${p.className} mt-1 border-t font-semibold`}
          style={{ ...p.style, borderColor: 'var(--map-border)' }}
        >
          <span style={{ color: 'var(--map-accent)' }}>
            Show all {num(h.count)} matching tickets in the list
          </span>
          <span
            className="ml-auto text-[12px] font-normal"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            ↵
          </span>
        </div>,
      )
    }
  })

  return (
    <div ref={wrapRef} className={`${cls}relative z-20 mb-3 shrink-0`} style={at(0)}>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--map-fg-muted)]" />
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        aria-activedescendant={open && active ? `${uid}-${idx}` : undefined}
        aria-autocomplete="list"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setClosed(false)
          setActiveId(null)
          measure()
        }}
        onFocus={() => {
          setFocused(true)
          measure()
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) {
              setClosed(false)
              measure()
              return
            }
            if (hits.length === 0) return
            const next = (idx + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length
            setActiveId(hits[next].id)
            document.getElementById(`${uid}-${next}`)?.scrollIntoView({ block: 'nearest' })
          } else if (e.key === 'Enter') {
            if (open && active) {
              e.preventDefault()
              pick(active)
            }
          } else if (e.key === 'Escape') {
            if (open) {
              e.preventDefault()
              e.stopPropagation()
              setClosed(true)
            } else if (value) {
              e.preventDefault()
              e.stopPropagation()
              onClear()
            }
          }
        }}
        placeholder="Search tickets, categories, sub-categories, plots, status…"
        aria-label="Search tickets, categories and sub-categories"
        autoComplete="off"
        spellCheck={false}
        className="h-10 w-full rounded-xl border pl-10 pr-10 text-[13.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--map-accent)] [&::-webkit-search-cancel-button]:hidden"
        style={{
          backgroundColor: 'var(--map-surface-alt)',
          borderColor: applied ? 'var(--map-accent)' : 'var(--map-border)',
          color: 'var(--map-fg)',
        }}
      />
      {value && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onClear()
            setClosed(false)
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-[var(--map-fg-muted)] hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {open && (
        <div
          id={`${uid}-list`}
          role="listbox"
          aria-label="Search results"
          className="kumbh-scroll swap-in absolute inset-x-0 top-full mt-1.5 overflow-y-auto rounded-xl border py-1"
          style={{
            maxHeight: maxH,
            backgroundColor: 'var(--map-surface)',
            borderColor: 'var(--map-border)',
            boxShadow: '0 14px 32px -10px rgba(0, 0, 0, 0.45)',
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {hits.length === 0 ? (
            <div role="status" className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
              <SearchX
                className="h-5 w-5"
                style={{ color: 'var(--map-fg-muted)' }}
                aria-hidden="true"
              />
              <p className="text-[13px] font-semibold" style={{ color: 'var(--map-fg)' }}>
                Nothing matches “{q}”
              </p>
              <p className="text-[12px]" style={{ color: 'var(--map-fg-muted)' }}>
                Try a ticket number, a plot, a status or priority, or a category name.
              </p>
            </div>
          ) : (
            <>
              {sections}
              <div
                className="hidden px-3 pb-1 pt-2 text-[11px] @min-[900px]:block"
                style={{ color: 'var(--map-fg-muted)' }}
                aria-hidden="true"
              >
                ↑ ↓ to move · ↵ to open · Esc to close
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Rail ───────────────────────────────────────────────────────────────────────────────────

function RailRow({
  label,
  tally,
  color,
  selected,
  index,
  onSelect,
  onKeyDown,
  buttonRef,
  itemRef,
}: {
  label: string
  tally: Tally
  color: string | null
  selected: boolean
  index: number
  onSelect: () => void
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  buttonRef: (el: HTMLButtonElement | null) => void
  /** The list item, so the rail can slide it when the sort order changes. */
  itemRef: (el: HTMLElement | null) => void
}) {
  const theme = useInsightTheme()
  const { rise, cls, at } = useMotion(3)
  const grown = useGrown(rise)
  const left = tally.total - tally.resolved
  const done = tally.total > 0 && left === 0
  const pct = formatDonePct(tally)
  return (
    <li ref={itemRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onSelect}
        onKeyDown={onKeyDown}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${label}: ${tally.resolved} of ${tally.total} resolved (${pct})`}
        className={`${cls}group relative block w-full cursor-pointer rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]`}
        style={{
          ...at(index),
          backgroundColor: selected ? 'var(--map-accent-bg)' : undefined,
        }}
      >
        <span className="flex items-center gap-2.5">
          {color ? (
            <Swatch color={color} />
          ) : (
            <span className="w-[3px] shrink-0" aria-hidden="true" />
          )}
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium"
            style={{ color: selected ? 'var(--map-accent-fg)' : 'var(--map-fg)' }}
            title={label}
          >
            {label}
          </span>
          <span
            className="shrink-0 text-[12px] tabular-nums"
            style={{ color: done ? doneTextColor(theme) : 'var(--map-fg-muted)' }}
          >
            {done ? (
              <span className="flex items-center gap-1 font-semibold">
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                Done
              </span>
            ) : (
              `${num(left)} left`
            )}
          </span>
        </span>
        <span className="mt-1.5 flex items-center gap-2.5 pl-[13px]">
          <StatusBar
            className={`flex-1 transition-opacity duration-200 ${
              selected ? '' : 'opacity-60 group-hover:opacity-100 group-focus-visible:opacity-100'
            }`}
            counts={tally.counts}
            total={tally.total}
            height={4}
            reveal={grown ? 1 : 0}
            smooth
            delay={160 + index * 30}
          />
          <span
            className="w-9 text-right text-[12px] font-semibold tabular-nums"
            style={{ color: 'var(--map-fg)' }}
          >
            {pct}
          </span>
        </span>
      </button>
    </li>
  )
}

/** The rail's stand-in below the wide breakpoint: one pill per category. */
function CategoryChip({
  label,
  n,
  color,
  on,
  index,
  onSelect,
  buttonRef,
}: {
  label: string
  n: number
  color: string | null
  on: boolean
  index: number
  onSelect: () => void
  buttonRef: (el: HTMLButtonElement | null) => void
}) {
  const { cls, at } = useMotion(2)
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={on}
      onClick={onSelect}
      className={`${cls}flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]`}
      style={{
        ...at(index),
        borderColor: on ? 'var(--map-accent)' : 'var(--map-border)',
        backgroundColor: on ? 'var(--map-accent-bg)' : undefined,
        color: on ? 'var(--map-accent-fg)' : 'var(--map-fg)',
      }}
    >
      {color && <Swatch color={color} />}
      {label}
      <span className="tabular-nums" style={{ color: 'var(--map-fg-muted)' }}>
        {num(n)}
      </span>
    </button>
  )
}

// ─── Detail ─────────────────────────────────────────────────────────────────────────────────

function StatusChips({
  tally,
  active,
  onChange,
}: {
  tally: Tally
  active: StatusBucket | null
  onChange: (b: StatusBucket | null) => void
}) {
  const theme = useInsightTheme()
  const { cls, at } = useMotion(6)
  return (
    <div role="group" aria-label="Filter tickets by status" className="flex flex-wrap gap-2">
      {STACK_ORDER.map((b, i) => {
        const n = tally.counts[b]
        const on = active === b
        const color = BUCKET_COLORS[b][theme]
        return (
          <button
            key={b}
            type="button"
            aria-pressed={on}
            // A pressed chip must stay clickable even when the scope it filters has none left.
            disabled={n === 0 && !on}
            title={on ? 'Show all statuses' : `Show only ${BUCKET_LABELS[b].toLowerCase()} tickets`}
            onClick={() => onChange(on ? null : b)}
            className={`${cls}flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)] enabled:hover:bg-[var(--map-surface-hover)] disabled:cursor-default disabled:opacity-45`}
            style={{
              ...at(i),
              borderColor: on ? color : 'var(--map-border)',
              backgroundColor: on ? `color-mix(in srgb, ${color} 18%, transparent)` : undefined,
              color: 'var(--map-fg)',
            }}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color, opacity: statusOpacity(b, theme) }}
              aria-hidden="true"
            />
            <span style={{ color: on ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}>
              {BUCKET_LABELS[b]}
            </span>
            <b className="tabular-nums">
              <Count value={n} />
            </b>
          </button>
        )
      })}
    </div>
  )
}

function Hero({
  eyebrow,
  title,
  subtitle,
  tally,
  color,
  status,
  onStatus,
  onBack,
  facts,
}: {
  eyebrow: string
  title: string
  subtitle: string
  tally: Tally
  color: string | null
  status: StatusBucket | null
  onStatus: (b: StatusBucket | null) => void
  /** Present when the hero is showing a sub-category: steps back up to its category. */
  onBack?: () => void
  facts: ReturnType<typeof scopeFacts>
}) {
  const theme = useInsightTheme()
  const { rise, cls, at } = useMotion(3)
  const swaps = useSwaps(`${eyebrow}|${title}`)
  const swapCls = swaps > 0 ? 'swap-in' : ''
  const share = tally.total > 0 ? tally.resolved / tally.total : 0
  const pct = share * 100
  // Entrance: the green run is wiped in while the figure counts up with it (the same two beats as
  // the Insights ring), then the unresolved segments follow. After that, a change of scope
  // glides the figure from where it is, and the bar re-proportions itself.
  const shown = useTweenTo(pct, { intro: rise, introMs: 700, introDelay: 160, ms: 450 })
  const tDone = useTween(rise, 700, 160)
  // Fixed at mount: the unresolved run waits for the green one only if there is a green one to wait
  // for, and must not re-time (and so re-wipe) if a ticket is resolved while the view is open.
  const [restDelay] = useState(() => (tally.resolved > 0 ? 800 : 160))
  const tRest = useTween(rise, 300, restDelay)
  const sweep = share * tDone + (1 - share) * tRest
  const complete = tally.total > 0 && tally.resolved === tally.total
  // The count-up must never claim a finish line it hasn't reached ("100%" for 99.6%) or a start it
  // has passed ("0%" for a job that has begun).
  const counted = Math.min(pct < 100 ? 99 : 100, Math.max(pct > 0 ? 1 : 0, Math.round(shown)))
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className={`${cls}flex h-6 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide`}
            style={{ ...at(0), color: 'var(--map-fg-muted)' }}
          >
            {color && <Swatch color={color} />}
            <span key={swaps} className={swapCls}>
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="-ml-1.5 inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 pr-2 uppercase tracking-wide transition-colors hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
                  style={{ color: 'var(--map-accent)' }}
                  title={`Back to all ${eyebrow} tickets (Esc)`}
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                  {eyebrow}
                </button>
              ) : (
                eyebrow
              )}
            </span>
          </p>
          <h3
            className={`${cls}mt-0.5 truncate text-[22px] font-semibold leading-tight`}
            style={{ ...at(1), color: 'var(--map-fg)' }}
            title={title}
          >
            <span key={swaps} className={swapCls}>
              {title}
            </span>
          </h3>
          <p
            className={`${cls}mt-1 text-[12.5px]`}
            style={{ ...at(2), color: 'var(--map-fg-muted)' }}
          >
            <span key={swaps} className={swapCls}>
              {subtitle}
            </span>
          </p>
        </div>
        <div className={`${cls}shrink-0 text-right`} style={at(2)}>
          <div
            className="text-[40px] font-semibold leading-none tracking-tight tabular-nums"
            style={{ color: complete ? doneTextColor(theme) : 'var(--map-fg)' }}
          >
            {Math.abs(shown - pct) < 0.05 ? formatDonePct(tally) : `${counted}%`}
          </div>
          <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: 'var(--map-fg-muted)' }}>
            {complete ? (
              <span
                className="inline-flex items-center gap-1 font-semibold"
                style={{ color: doneTextColor(theme) }}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                All resolved
              </span>
            ) : (
              <>
                <Count value={tally.resolved} /> of <Count value={tally.total} /> resolved
              </>
            )}
          </div>
        </div>
      </div>
      <StatusBar
        className="mt-4"
        counts={tally.counts}
        total={tally.total}
        height={10}
        reveal={sweep}
        active={status}
      />
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <StatusChips tally={tally} active={status} onChange={onStatus} />
        <dl className={`${cls}flex flex-wrap items-start gap-x-7 gap-y-2`} style={at(5)}>
          {facts.oldest && (
            <div>
              <dt className="text-[11px]" style={{ color: 'var(--map-fg-muted)' }}>
                Longest waiting
              </dt>
              <dd
                className="mt-0.5 flex items-baseline gap-1.5 text-[16px] font-semibold leading-tight tabular-nums"
                style={{
                  color: facts.oldest.ageMs >= WAIT_ALERT_MS ? 'var(--danger)' : 'var(--map-fg)',
                }}
              >
                {ageLabel(facts.oldest.ageMs)}
                <a
                  href={`/tickets/${facts.oldest.number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded text-[12px] font-normal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
                  style={{ color: 'var(--map-accent)' }}
                  aria-label={`Ticket ${facts.oldest.number}, opens in a new tab`}
                >
                  #{facts.oldest.number}
                </a>
              </dd>
            </div>
          )}
          {facts.medianHours != null && (
            <div>
              <dt className="text-[11px]" style={{ color: 'var(--map-fg-muted)' }}>
                Median to resolve
              </dt>
              <dd
                className="mt-0.5 text-[16px] font-semibold leading-tight tabular-nums"
                style={{ color: 'var(--map-fg)' }}
              >
                {formatDuration(facts.medianHours)}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}

function SubList({
  subs,
  active,
  status,
  onSelect,
}: {
  subs: SubRow[]
  active: string | null
  /** The status filter, if any: the bars fade the other statuses. */
  status: StatusBucket | null
  onSelect: (name: string | null) => void
}) {
  const theme = useInsightTheme()
  const { rise, cls, at } = useMotion(7)
  const grown = useGrown(rise)
  const [showAll, setShowAll] = useState(false)
  // A selected sub-category stays visible even if it would fall below the fold.
  const visible = showAll
    ? subs
    : subs.filter((s, i) => i < MAX_SUBS || (active !== null && s.name === active))
  const max = subs.reduce((m, s) => Math.max(m, s.total), 1)
  return (
    <section aria-label="Sub-categories">
      <h4
        className={`${cls}text-[13px] font-semibold`}
        style={{ ...at(0), color: 'var(--map-fg)' }}
      >
        Sub-categories{' '}
        <span className="font-normal tabular-nums" style={{ color: 'var(--map-fg-muted)' }}>
          {subs.length}
        </span>
      </h4>
      {/* Column-major, so a list sorted largest-first still reads top to bottom in each half. Only
          split once there are enough rows for two columns to look intentional. */}
      <ul
        className={`-mx-2 mt-2 ${visible.length >= 6 ? '@min-[1300px]:columns-2 @min-[1300px]:gap-x-6' : ''}`}
      >
        {visible.map((s, i) => (
          <SubRowItem
            key={s.name}
            row={s}
            on={active === s.name}
            r={s.total / max}
            index={i}
            grown={grown}
            theme={theme}
            status={status}
            onSelect={() => onSelect(active === s.name ? null : s.name)}
          />
        ))}
      </ul>
      {subs.length > MAX_SUBS && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1 cursor-pointer rounded-md px-1.5 py-1 text-[12px] font-semibold hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
          style={{ color: 'var(--map-accent)' }}
        >
          {showAll ? 'Show fewer' : `Show all ${subs.length} sub-categories`}
        </button>
      )}
    </section>
  )
}

function SubRowItem({
  row,
  on,
  r,
  index,
  grown,
  theme,
  status,
  onSelect,
}: {
  row: SubRow
  on: boolean
  /** Length of this row's bar relative to the longest. */
  r: number
  index: number
  grown: boolean
  theme: Theme
  status: StatusBucket | null
  onSelect: () => void
}) {
  const { cls, at, quick } = useMotion(8)
  const left = row.total - row.resolved
  return (
    <li className="break-inside-avoid">
      <button
        type="button"
        aria-pressed={on}
        onClick={onSelect}
        title={`${row.name}: ${row.resolved} of ${row.total} resolved`}
        className={`${cls}${SUB_GRID} h-9 w-full cursor-pointer rounded-lg px-2 text-left transition-colors hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]`}
        style={{ ...at(index), backgroundColor: on ? 'var(--map-accent-bg)' : undefined }}
      >
        <span
          className="truncate text-[13px]"
          style={{ color: on ? 'var(--map-accent-fg)' : 'var(--map-fg)' }}
        >
          {row.name}
        </span>
        {left === 0 ? (
          <span
            className="flex items-center gap-1 text-[12px] font-semibold"
            style={{ color: doneTextColor(theme) }}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            All done
          </span>
        ) : (
          <span className="whitespace-nowrap text-[13px] tabular-nums">
            <b style={{ color: 'var(--map-fg)' }}>{formatDonePct(row)}</b>
            <span style={{ color: 'var(--map-fg-muted)' }}> · {num(left)} left</span>
          </span>
        )}
        <span className="flex h-3 items-center" aria-hidden="true">
          <span
            className="flex h-full flex-none gap-px overflow-hidden rounded-[4px] motion-safe:transition-[clip-path] motion-safe:ease-out motion-safe:[transition-delay:var(--d)] motion-safe:[transition-duration:var(--dur)]"
            style={{
              // Opening: the bars draw in after the rows settle. A response to a click: right away.
              ...cssVar('--d', `${quick ? 40 + index * 20 : 260 + index * 40}ms`),
              ...cssVar(
                '--dur',
                `${quick ? Math.round(240 + 120 * r) : Math.round(300 + 400 * r)}ms`,
              ),
              width: `calc(min(100% - 2.5rem, 36rem) * ${r})`,
              clipPath: grown ? 'inset(0 0 0 0 round 4px)' : 'inset(0 100% 0 0 round 4px)',
            }}
          >
            {STACK_ORDER.map((b) =>
              row.counts[b] > 0 ? (
                <span
                  key={b}
                  className="block h-full min-w-[3px] motion-safe:transition-opacity motion-safe:duration-300"
                  style={{
                    flexGrow: row.counts[b],
                    flexBasis: 0,
                    backgroundColor: BUCKET_COLORS[b][theme],
                    opacity: status && status !== b ? 0.18 : statusOpacity(b, theme),
                  }}
                />
              ) : null,
            )}
          </span>
          <span
            className="ml-2 w-8 text-[12px] tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {num(row.total)}
          </span>
        </span>
      </button>
    </li>
  )
}

function GroupHead({
  label,
  count,
  color,
  index,
  late,
}: {
  label: string
  count: number
  color: string
  index: number
  late: boolean
}) {
  const { cls, at } = useMotion(9, late)
  return (
    <li
      role="presentation"
      className={`${cls}flex items-center gap-2.5 px-2 pb-1 pt-4 first:pt-2`}
      style={at(index)}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--map-fg-muted)' }}
      >
        {label}
      </span>
      <span className="text-[11px] tabular-nums" style={{ color: 'var(--map-fg-muted)' }}>
        {num(count)}
      </span>
      <span
        className="h-px flex-1"
        style={{ backgroundColor: 'var(--map-border)' }}
        aria-hidden="true"
      />
    </li>
  )
}

/**
 * One ticket. Two lines up to a point, then (container >= 1300px) a single line:
 * glyph | #id | title + detail | wait bar | wait | status.
 * The title is the sub-class -- or the plot, when the sub-class wouldn't tell tickets apart (every
 * ticket in scope shares it, or it just repeats the category already named above the list). The
 * bar is how long it has waited (or took), coloured by how overdue that is, so colour means
 * urgency; the glyph carries status.
 * The whole row opens the ticket; "Locate" (a sibling link, so links aren't nested) opens the map
 * on its parcel and lives in a gutter the row reserves, so it never covers text. Both open in a
 * new tab so the drawer and its filters stay as they are.
 */
function TicketRow({
  ticket,
  now,
  plot,
  uniform,
  showCategory,
  showPriority,
  sectorNo,
  longest,
  index,
  late,
}: {
  ticket: SectorTicket
  now: number
  /** The parcel's plot number, when the sector's detail has been loaded for this ticket. */
  plot: string | undefined
  /** Every ticket in scope has the same sub-class, so it can't be what tells them apart. */
  uniform: boolean
  showCategory: boolean
  showPriority: boolean
  sectorNo: number
  /** Longest wait / turnaround among the tickets in scope: the wait bars are drawn against it. */
  longest: number
  index: number
  /** Loaded by scrolling, not part of the opening. */
  late: boolean
}) {
  const theme = useInsightTheme()
  const { rise, cls, at } = useMotion(10, late)
  const grown = useGrown(rise)
  const color = BUCKET_COLORS[ticket.bucket][theme]
  const Icon = STATUS_ICON[ticket.bucket]
  const resolved = ticket.bucket === 'resolved'
  const tookMs = resolved && ticket.resolvedAt != null ? ticket.resolvedAt - ticket.createdAt : null
  const span = spanMs(ticket, now)
  const overdue = !resolved && span >= WAIT_ALERT_MS
  const barColor = resolved ? doneTextColor(theme) : waitColor(span)
  const idLabel = plot ? `Plot ${plot}` : `Parcel ${ticket.parcelId}`
  const leadWithId = uniform || (!showCategory && ticket.subclass === ticket.category)
  const title = leadWithId ? idLabel : ticket.subclass
  const waitText = resolved
    ? tookMs != null
      ? `Resolved in ${ageLabel(tookMs)}`
      : 'Resolved'
    : `Waiting ${ageLabel(span)}`
  const mapHref = `/?parcel=${ticket.parcelId}&lng=${ticket.lng}&lat=${ticket.lat}&sector=${sectorNo}`

  // The rest of what distinguishes this ticket, joined with dots.
  const bits: ReactNode[] = []
  if (showPriority && ticket.priorityName) {
    bits.push(
      <span key="priority" className="flex shrink-0 items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: ticket.priorityColor }}
          aria-hidden="true"
        />
        {ticket.priorityName}
      </span>,
    )
  }
  // (the category is left out when the sub-class, shown as the title, already says it)
  if (showCategory && (leadWithId || ticket.category !== ticket.subclass)) {
    bits.push(
      <span key="category" className="truncate">
        {ticket.category}
      </span>,
    )
  }
  if (!leadWithId) {
    bits.push(
      <span key="id" className="shrink-0 whitespace-nowrap tabular-nums">
        {idLabel}
      </span>,
    )
  }
  if (bits.length === 0) {
    bits.push(
      <span key="opened" className="tabular-nums">
        Opened{' '}
        {new Date(ticket.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
      </span>,
    )
  }

  return (
    <li className="group relative rounded-lg pr-10 transition-colors focus-within:bg-[var(--map-surface-hover)] hover:bg-[var(--map-surface-hover)]">
      <a
        href={`/tickets/${ticket.number}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Ticket ${ticket.number}: ${title}${leadWithId ? '' : `, ${idLabel}`}. ${
          ticket.priorityName ? `${ticket.priorityName} priority. ` : ''
        }${ticket.statusName}. ${waitText}. Opens in a new tab`}
        className={`${cls}grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)] ${ROW_COLS}`}
        style={at(index)}
      >
        <Icon
          className="h-4 w-4"
          strokeWidth={2.25}
          style={{ color: resolved ? doneTextColor(theme) : color }}
          aria-hidden="true"
        />
        {/* Narrow: "#id title" on one line, the detail wrapping beneath. Wide: the id is its own
            column and the title and detail share the next one. */}
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 @min-[1300px]:contents">
          <span
            className="shrink-0 text-[13px] tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            #{ticket.number}
          </span>
          <span className="contents @min-[1300px]:flex @min-[1300px]:min-w-0 @min-[1300px]:items-baseline @min-[1300px]:gap-3">
            <span
              className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium @min-[1300px]:flex-initial @min-[1300px]:shrink-[2]"
              style={{ color: 'var(--map-fg)' }}
            >
              <span className="truncate" title={title}>
                {title}
              </span>
              <ArrowUpRight
                className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                style={{ color: 'var(--map-fg-muted)' }}
                aria-hidden="true"
              />
            </span>
            <span
              className="mt-0.5 flex w-full min-w-0 items-center gap-1.5 text-[12px] @min-[1300px]:mt-0 @min-[1300px]:w-auto"
              style={{ color: 'var(--map-fg-muted)' }}
            >
              {bits.flatMap((b, i) =>
                i === 0
                  ? [b]
                  : [
                      <span key={`dot-${i}`} aria-hidden="true">
                        ·
                      </span>,
                      b,
                    ],
              )}
            </span>
          </span>
        </span>
        {/* How long it waited (or took), against the longest in scope. It draws in just after its
            own row appears, not on the page's clock, so it is seen growing. */}
        <span
          className="hidden h-1 min-w-0 overflow-hidden rounded-full @min-[1300px]:order-4 @min-[1300px]:block"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--map-switch-track) 40%, transparent)',
          }}
          aria-hidden="true"
        >
          <span
            className="block h-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              width: `${Math.max(2, Math.min(100, (span / Math.max(longest, 1)) * 100))}%`,
              backgroundColor: barColor,
              opacity: resolved || span >= WAIT_WARN_MS ? 0.95 : 0.5,
              transform: grown ? 'scaleX(1)' : 'scaleX(0)',
              transitionDelay: 'calc(var(--i, 0) * var(--rs, 24ms) + 140ms)',
            }}
          />
        </span>
        <span className="flex flex-col items-end gap-0.5 @min-[1300px]:contents">
          <span
            className="whitespace-nowrap text-[12px] font-medium @min-[1300px]:order-6 @min-[1300px]:justify-self-end"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {ticket.statusName}
          </span>
          <span
            className="whitespace-nowrap text-[11.5px] tabular-nums @min-[1300px]:order-5 @min-[1300px]:justify-self-end @min-[1300px]:text-[12px]"
            style={{
              color: resolved
                ? doneTextColor(theme)
                : overdue
                  ? 'var(--danger)'
                  : 'var(--map-fg-muted)',
            }}
            title={
              resolved && ticket.resolvedAt != null
                ? `Opened ${stamp(ticket.createdAt)} · resolved ${stamp(ticket.resolvedAt)}`
                : `Opened ${stamp(ticket.createdAt)}`
            }
          >
            {waitText}
          </span>
        </span>
      </a>
      {/* Revealed by hovering or focusing the row (always shown where there is no hover, so touch
          can reach it), and not clickable while hidden: a tap near the row's right edge must open
          the ticket, not the map. */}
      <a
        href={mapHref}
        target="_blank"
        rel="noopener noreferrer"
        title="Locate on map"
        aria-label={`Locate ticket ${ticket.number} on the map, opens in a new tab`}
        className="pointer-events-none absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border opacity-0 transition-opacity hover:bg-[var(--map-surface-hover)] focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)] group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        style={{
          backgroundColor: 'var(--map-surface-alt)',
          borderColor: 'var(--map-border)',
          color: 'var(--map-fg-muted)',
        }}
      >
        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </li>
  )
}

function TicketList({
  tickets,
  total,
  now,
  showCategory,
  sectorNo,
  plots,
  uniform,
  longest,
  scopeLabel,
  query,
  onClearQuery,
  sort,
  onSort,
  filterLabel,
  onClearFilters,
  resetKey,
}: {
  /** Tickets after the status / sub-category / search filters, already sorted. */
  tickets: SectorTicket[]
  /** Tickets in scope before the search box narrows them. */
  total: number
  now: number
  showCategory: boolean
  sectorNo: number
  /** Plot numbers by ticket number, for the tickets whose detail has been loaded. */
  plots: ReadonlyMap<number, string> | undefined
  /** Every ticket in scope has the same sub-class. */
  uniform: boolean
  /** Longest wait / turnaround in scope (the wait bars' full length). */
  longest: number
  /** What the list is of -- the category (or sub-category) name -- so the sticky bar still says
   *  where you are once the hero has scrolled away. */
  scopeLabel: string
  /** The search text narrowing the list ("" unless the search box is filtering it). */
  query: string
  onClearQuery: () => void
  sort: TicketSort
  onSort: (s: TicketSort) => void
  /** Describes the active status/sub-category filters, if any. */
  filterLabel: string | null
  onClearFilters: () => void
  /** Changes with the category / status / sub-category / sort: pages back to the first rows and
   *  re-staggers them. */
  resetKey: string
}) {
  const theme = useInsightTheme()
  const { cls, at } = useMotion(9)
  const [shown, setShown] = useState(PAGE)
  // Adjust-state-during-render: the page resets with the filters (and the search text), without
  // remounting the search box or sort buttons and so dropping their focus.
  const pageKey = `${resetKey}|${query}`
  const [lastPageKey, setLastPageKey] = useState(pageKey)
  if (lastPageKey !== pageKey) {
    setLastPageKey(pageKey)
    setShown(PAGE)
  }
  const visible = tickets.slice(0, shown)
  const rest = tickets.length - visible.length
  const hasMore = rest > 0

  // Reaching the end of the list loads the next page, so a long list simply keeps going; the
  // button stays for keyboards and for anyone who wants to be explicit.
  const [moreEl, setMoreEl] = useState<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!moreEl || typeof IntersectionObserver === 'undefined') return
    // The list scrolls inside the panel, so the panel -- not the window -- is the root; only then
    // does the margin make the next page start loading before the button is actually reached.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE_MORE)
      },
      { root: scrollParent(moreEl), rootMargin: '0px 0px 160px 0px' },
    )
    io.observe(moreEl)
    return () => io.disconnect()
  }, [moreEl, shown])

  const grouped = sort === 'priority'
  const groupCounts = new Map<string, number>()
  if (grouped) {
    for (const t of tickets) groupCounts.set(groupOf(t), (groupCounts.get(groupOf(t)) ?? 0) + 1)
  }
  // `at` is an element's place in its entrance: its position in the list for the first page, then
  // its position within the batch for rows that were loaded by scrolling (so they don't queue
  // behind an offset meant for the opening). `late` marks the latter.
  const items: (
    | { kind: 'head'; label: string; count: number; color: string; at: number; late: boolean }
    | { kind: 'row'; ticket: SectorTicket; at: number; late: boolean }
  )[] = []
  let lastGroup: string | null = null
  for (let ti = 0; ti < visible.length; ti++) {
    const t = visible[ti]
    const late = ti >= PAGE
    const at = late ? (ti - PAGE) % PAGE_MORE : items.length
    if (grouped) {
      const g = groupOf(t)
      if (g !== lastGroup) {
        items.push({
          kind: 'head',
          label: g,
          count: groupCounts.get(g) ?? 0,
          color: g === 'Resolved' ? BUCKET_COLORS.resolved[theme] : t.priorityColor,
          at,
          late,
        })
        lastGroup = g
      }
    }
    items.push({ kind: 'row', ticket: t, at, late })
  }

  return (
    <section aria-label="Tickets">
      {/* Sticky: search and sort stay in reach however far the list is scrolled. Painted over an
          opaque base so rows don't show through the translucent panel colour. A sticky element
          sticks to its scroller's content edge, so it is pulled up by that scroller's top padding
          (the panel's p-5 when the panel scrolls, the view's pt-3 when the whole view does). */}
      <div
        className="sticky -top-3 z-10 @min-[900px]:-top-5 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 @min-[900px]:-mx-5 @min-[900px]:px-5"
        style={{
          backgroundImage: 'linear-gradient(var(--map-surface-alt), var(--map-surface-alt))',
          backgroundColor: 'var(--map-surface)',
          boxShadow: '0 1px 0 var(--map-border)',
        }}
      >
        <div className={`${cls}mr-auto flex min-w-0 items-baseline gap-2`} style={at(0)}>
          <h4
            className="flex min-w-0 shrink items-baseline gap-1.5 text-[13px] font-semibold"
            style={{ color: 'var(--map-fg)' }}
          >
            Tickets
            <span
              className="truncate font-normal"
              style={{ color: 'var(--map-fg-muted)' }}
              title={scopeLabel}
            >
              · {scopeLabel}
            </span>
          </h4>
          <span
            className="truncate text-[12px] tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
            aria-live="polite"
          >
            {query ? `${num(tickets.length)} of ${num(total)}` : num(tickets.length)}
            <span className="sr-only"> tickets</span>
            {filterLabel && ` · ${filterLabel}`}
          </span>
          {query && (
            <button
              type="button"
              onClick={onClearQuery}
              title="Clear search"
              aria-label={`Clear search “${query}”`}
              className="flex min-w-0 max-w-[11rem] cursor-pointer items-center gap-1 self-center rounded-md px-1.5 py-0.5 text-[12px] font-medium transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
              style={{ backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
            >
              <span className="truncate">“{query}”</span>
              <XIcon className="h-3 w-3 shrink-0" />
            </button>
          )}
        </div>
        <div className={cls} style={at(1)}>
          <Segmented label="Sort tickets" options={TICKET_SORTS} value={sort} onChange={onSort} />
        </div>
      </div>

      {tickets.length === 0 ? (
        <div role="status" className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--map-surface-hover)', color: 'var(--map-fg-muted)' }}
          >
            <SearchX className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--map-fg)' }}>
            No tickets match
          </p>
          <p className="text-[12px]" style={{ color: 'var(--map-fg-muted)' }}>
            Try a different status, sub-category or search.
          </p>
          <button
            type="button"
            onClick={() => {
              onClearQuery()
              onClearFilters()
            }}
            className="mt-1 cursor-pointer rounded-lg border px-3 py-1 text-[12px] font-semibold transition-colors hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
            style={{ borderColor: 'var(--map-border)', color: 'var(--map-fg)' }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul key={resetKey} className="-mx-2 flex flex-col">
          {items.map((it) =>
            it.kind === 'head' ? (
              <GroupHead
                key={`h-${it.label}`}
                label={it.label}
                count={it.count}
                color={it.color}
                index={it.at}
                late={it.late}
              />
            ) : (
              <TicketRow
                key={it.ticket.number}
                ticket={it.ticket}
                now={now}
                showCategory={showCategory}
                showPriority={!grouped}
                plot={plots?.get(it.ticket.number)}
                uniform={uniform}
                sectorNo={sectorNo}
                longest={longest}
                index={it.at}
                late={it.late}
              />
            ),
          )}
        </ul>
      )}
      {hasMore && (
        <button
          ref={setMoreEl}
          type="button"
          onClick={() => setShown((n) => n + PAGE_MORE)}
          className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[12.5px] font-semibold transition-colors hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
          style={{ borderColor: 'var(--map-border)', color: 'var(--map-accent)' }}
        >
          Show {Math.min(PAGE_MORE, rest)} more
          <span className="font-normal tabular-nums" style={{ color: 'var(--map-fg-muted)' }}>
            · {num(rest)} left
          </span>
        </button>
      )}
    </section>
  )
}

// ─── Skeleton ───────────────────────────────────────────────────────────────────────────────

function TicketsSkeleton() {
  const bar = (w: string, h = 'h-3') => (
    <div
      className={`${h} rounded motion-safe:animate-pulse`}
      style={{ width: w, backgroundColor: 'var(--map-switch-track)', opacity: 0.5 }}
    />
  )
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-0 flex-1 overflow-hidden px-4 pb-4 pt-3 @min-[900px]:flex @min-[900px]:flex-col"
    >
      <span className="sr-only">Loading tickets…</span>
      <div className="mb-3 shrink-0">{bar('100%', 'h-10 rounded-xl')}</div>
      <div
        className={`${LAYOUT} @min-[900px]:min-h-0 @min-[900px]:flex-1 @min-[900px]:grid-rows-[minmax(0,1fr)]`}
      >
        <section
          className="hidden min-h-0 flex-col overflow-hidden rounded-xl border p-4 @min-[900px]:flex"
          style={PANEL_STYLE}
        >
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--map-fg)' }}>
            Categories
          </h3>
          <div className="mb-3 mt-0.5 flex h-[18px] items-center">{bar('7rem', 'h-2.5')}</div>
          <div className="flex flex-col gap-0.5">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-[58px] px-3 py-2">
                <div className="flex h-5 items-center justify-between">
                  {bar('55%')}
                  {bar('3.5rem')}
                </div>
                <div className="mt-1.5 flex h-4 items-center pl-[13px]">{bar('100%', 'h-1')}</div>
              </div>
            ))}
          </div>
        </section>
        <section
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border p-4 @min-[900px]:p-5"
          style={PANEL_STYLE}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2.5">
              {bar('5rem', 'h-2.5')}
              {bar('12rem', 'h-5')}
              {bar('15rem', 'h-3')}
            </div>
            {bar('4.5rem', 'h-9')}
          </div>
          <div className="mt-4">{bar('100%', 'h-2.5')}</div>
          <div className="mt-3.5 flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[32px] w-[96px] rounded-full motion-safe:animate-pulse"
                style={{ backgroundColor: 'var(--map-switch-track)', opacity: 0.35 }}
              />
            ))}
          </div>
          {/* The ticket list's toolbar and its one-line rows (the default view has no sub-list). */}
          <div
            className="-mx-4 mt-6 flex items-center gap-3 border-b px-4 pb-2 @min-[900px]:-mx-5 @min-[900px]:px-5"
            style={{ borderColor: 'var(--map-border)' }}
          >
            <div className="mr-auto">{bar('9rem', 'h-3.5')}</div>
            {bar('14rem', 'h-7')}
          </div>
          <div className="flex flex-col">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="flex h-10 items-center gap-3 px-2">
                <div
                  className="h-4 w-4 shrink-0 rounded-full motion-safe:animate-pulse"
                  style={{ backgroundColor: 'var(--map-switch-track)', opacity: 0.4 }}
                />
                {bar('3rem')}
                {bar(`${34 - (i % 3) * 6}%`)}
                <div className="flex-1" />
                {bar('4.5rem', 'h-2.5')}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

// ─── View ───────────────────────────────────────────────────────────────────────────────────

export default function SectorTickets({
  summary,
  data,
  sectorNo,
  error,
  onRetry,
  plots,
  active = true,
  initialOpen,
  animate = true,
}: {
  /** Category / sub-category rollup (null while the bulk ticket data is still loading). */
  summary: WorkDoneSummary | null
  /** The bulk ticket data the rollup came from -- source of the individual tickets. */
  data: InsightsTicketData | null
  sectorNo: number
  error: string | null
  onRetry: () => void
  /** Plot numbers by ticket number (from the sector's detail, which only covers the most pressing
   *  tickets); the rest fall back to their parcel id. */
  plots?: ReadonlyMap<number, string>
  /** False while another Work Done view is showing (this one stays mounted, hidden). */
  active?: boolean
  /** Category to open on arrival (a drill-through from the Insights bars). */
  initialOpen?: string
  /** Play the opening choreography. Off when the user is simply returning to this view. */
  animate?: boolean
}) {
  const [railSort, setRailSort] = useState<RailSort>('most')
  const [selected, setSelected] = useState<string | null>(initialOpen ?? null)
  const [status, setStatus] = useState<StatusBucket | null>(null)
  const [sub, setSub] = useState<string | null>(null)
  // The one search box. `applied`: its text also filters the ticket list ("Show all N matching
  // tickets"); until then it only lists where to go.
  const [searchText, setSearchText] = useState('')
  const [applied, setApplied] = useState(false)
  const [ticketSort, setTicketSort] = useState<TicketSort>('priority')
  // Fixed for the life of the view so every row's "6d ago" is measured from the same instant.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    // A frame later, so this isn't a state update inside the effect body itself.
    const id = requestAnimationFrame(() => setNow(Date.now()))
    return () => cancelAnimationFrame(id)
  }, [active, data])
  // After the user's first move, what mounts is a response to them (see MotionCtx).
  const [interacted, setInteracted] = useState(false)
  // When a skeleton with the same chrome was on screen the panels are already there: only their
  // contents animate in, so the panels don't vanish and rise a second time.
  const [sawSkeleton, setSawSkeleton] = useState(false)
  if (!summary && !sawSkeleton) setSawSkeleton(true)
  const panelRise = animate && !sawSkeleton

  const railRefs = useRef(new Map<string, HTMLButtonElement>())
  const chipRefs = useRef(new Map<string, HTMLButtonElement>())
  const detailRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [railRef, railFadeStyle] = useScrollFade<HTMLUListElement>('y')
  const [chipRef, chipFadeStyle] = useScrollFade<HTMLDivElement>('x')

  const allTickets = useMemo(() => (data ? collectTickets(data, sectorNo) : []), [data, sectorNo])
  const categories = summary ? sortCategories(summary.categories, railSort) : []
  const current = summary?.categories.find((c) => c.name === selected) ?? null
  const subRow = current && sub ? (current.subs.find((s) => s.name === sub) ?? null) : null
  const scopeTally: Tally | null = subRow ?? current ?? summary
  const categoryName = current?.name ?? null
  const subName = subRow?.name ?? null

  // A category whose only sub-category is itself has nothing to drill into. Otherwise the sub-list
  // sits in a slot that opens and closes (and keeps the last category's rows while it closes).
  const lone = (c: CategoryRow) => c.subs.length <= 1
  const subsFor = current && !lone(current) ? current : null
  const [subsShown, setSubsShown] = useState(subsFor)
  if (subsFor && subsFor !== subsShown) setSubsShown(subsFor)
  const railItem = useFlip(categories.map((c) => c.name).join('|'))
  const summaryCategories = summary?.categories
  // Where the search box can take you (and, once applied, which tickets the list keeps).
  const search = useMemo(
    () => findHits(searchText, summaryCategories ?? [], allTickets, plots),
    [searchText, summaryCategories, allTickets, plots],
  )

  // Tickets in the chosen category / sub-category, then narrowed by status and search.
  const scoped = allTickets.filter(
    (t) =>
      (categoryName === null || t.category === categoryName) &&
      (subName === null || t.subclass === subName),
  )
  const listTokens = applied ? search.tokens : []
  const tickets = sortTickets(
    scoped.filter(
      (t) =>
        (status === null || t.bucket === status) &&
        (listTokens.length === 0 || matchesTokens(listTokens, t, plots?.get(t.number))),
    ),
    ticketSort,
  )
  // The KPIs describe what the status filter shows, so "Longest waiting" never points at a ticket
  // that isn't in the list.
  const facts = scopeFacts(status ? scoped.filter((t) => t.bucket === status) : scoped, now)
  const uniform = scoped.length > 0 && scoped.every((t) => t.subclass === scoped[0].subclass)
  // The age bars share one scale per scope, so filtering by status doesn't re-proportion them.
  let longest = 1
  for (const t of scoped) longest = Math.max(longest, spanMs(t, now))

  // The view stays mounted while another Work Done view is showing, so a drill-through from
  // Insights arrives as a changed prop rather than a fresh mount.
  const [lastOpen, setLastOpen] = useState(initialOpen)
  if (initialOpen !== lastOpen) {
    setLastOpen(initialOpen)
    if (initialOpen !== undefined) {
      setSelected(initialOpen)
      setStatus(null)
      setSub(null)
      setSearchText('')
      setApplied(false)
    }
  }

  const arrivalKey = initialOpen
  useEffect(() => {
    if (!arrivalKey) return
    railRefs.current.get(arrivalKey)?.scrollIntoView({ block: 'nearest' })
    chipRefs.current.get(arrivalKey)?.scrollIntoView({ block: 'nearest', inline: 'center' })
    detailRef.current?.scrollTo({ top: 0 })
    rootRef.current?.scrollTo({ top: 0 })
  }, [arrivalKey])

  // Escape steps back one level -- sub-category, then status filter, then the applied search --
  // before it is allowed to reach the map and close the whole drawer. A capture-phase listener on
  // the document: the map's own handler is a bubble-phase listener on that same node, which
  // stopPropagation from inside React can't hold back, and this works wherever focus happens to
  // be. The search box, while it has text, handles its own Escape first.
  useEffect(() => {
    if (!active || (!subName && !status && !applied)) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (e.target instanceof HTMLInputElement && e.target.value !== '') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (subName) setSub(null)
      else if (status) setStatus(null)
      else {
        setSearchText('')
        setApplied(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [active, subName, status, applied])

  function selectCategory(name: string | null) {
    setSelected(name)
    setStatus(null)
    setSub(null)
    detailRef.current?.scrollTo({ top: 0 })
    rootRef.current?.scrollTo({ top: 0 })
  }

  function selectSub(category: string, name: string) {
    setSelected(category)
    setStatus(null)
    setSub(name)
    detailRef.current?.scrollTo({ top: 0 })
    rootRef.current?.scrollTo({ top: 0 })
  }

  function clearSearch() {
    setSearchText('')
    setApplied(false)
  }

  /** Go where a search result points: a category or sub-category, a ticket (in its own tab), or
   *  every ticket in the sector that matches the text. */
  function pickHit(hit: Hit) {
    if (hit.kind === 'category') {
      selectCategory(hit.cat.name)
      clearSearch()
    } else if (hit.kind === 'sub') {
      selectSub(hit.cat.name, hit.sub.name)
      clearSearch()
    } else if (hit.kind === 'ticket') {
      window.open(`/tickets/${hit.ticket.number}`, '_blank', 'noopener,noreferrer')
    } else {
      selectCategory(null)
      setApplied(true)
    }
  }

  function onRailKey(e: KeyboardEvent<HTMLButtonElement>, index: number, keys: string[]) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = keys[(index + (e.key === 'ArrowDown' ? 1 : -1) + keys.length) % keys.length]
    selectCategory(next === ALL ? null : next)
    requestAnimationFrame(() => railRefs.current.get(next)?.focus())
  }

  if (error && !summary) return <InlineError message={error} onRetry={onRetry} />
  if (!summary || !scopeTally) return <TicketsSkeleton />

  if (summary.total === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-5 py-10 text-center">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--map-fg)' }}>
          No tickets in this sector yet
        </p>
        <p className="text-[12px]" style={{ color: 'var(--map-fg-muted)' }}>
          They will be listed here once tickets are filed against its parcels.
        </p>
      </div>
    )
  }

  const railKeys = [ALL, ...categories.map((c) => c.name)]
  const selKey = categoryName ?? ALL
  const heroColor = current ? categoryColor(current.name) : null
  const share = (t: Tally, of: Tally) =>
    of.total > 0 ? `${Math.max(1, Math.round((t.total / of.total) * 100))}%` : '0%'

  const hero = subRow
    ? {
        eyebrow: current!.name,
        title: subRow.name,
        subtitle: `${plural(subRow.total, 'ticket')} · ${share(subRow, current!)} of ${current!.name}`,
      }
    : current
      ? {
          eyebrow: 'Category',
          title: current.name,
          subtitle: `${plural(current.total, 'ticket')} · ${share(current, summary)} of the sector${
            lone(current)
              ? ''
              : ` · ${plural(current.subs.length, 'sub-category', 'sub-categories')}`
          }`,
        }
      : {
          eyebrow: 'Whole sector',
          title: 'All categories',
          subtitle: `${plural(summary.total, 'ticket')} · ${plural(summary.categories.length, 'category', 'categories')}`,
        }

  // The sub-category is already named in the list's heading (scopeLabel); only a status filter is extra.
  const filterLabel = status ? BUCKET_LABELS[status] : null
  const railNote = (
    <p className="text-[11px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
      Counts every ticket filed in this sector, ignoring map filters.
    </p>
  )

  return (
    <MotionCtx.Provider value={{ intro: animate || interacted, interacted }}>
      <div
        ref={rootRef}
        className="kumbh-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3 @min-[900px]:flex @min-[900px]:flex-col @min-[900px]:overflow-hidden"
        onPointerDownCapture={() => setInteracted(true)}
        onKeyDownCapture={() => setInteracted(true)}
        // Scrolling for more rows is the user's doing too (a wheel or a drag on touch).
        onWheelCapture={() => setInteracted(true)}
        onTouchStartCapture={() => setInteracted(true)}
      >
        {error && (
          <div
            role="alert"
            className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 text-[12px]"
            style={{
              borderColor: 'var(--danger)',
              backgroundColor: 'var(--danger-soft)',
              color: 'var(--danger)',
            }}
          >
            <span>Couldn’t refresh ticket data — showing the last loaded figures.</span>
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 cursor-pointer font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}
        <SearchHub
          value={searchText}
          onChange={(v) => {
            setSearchText(v)
            if (!v.trim()) setApplied(false)
          }}
          applied={applied}
          hits={search.hits}
          defaultId={search.defaultId}
          tokens={search.tokens}
          matched={search.matched}
          onPick={pickHit}
          onClear={clearSearch}
          boundsRef={rootRef}
          now={now}
          plots={plots}
        />
        <div
          className={`${LAYOUT} @min-[900px]:min-h-0 @min-[900px]:flex-1 @min-[900px]:grid-rows-[minmax(0,1fr)]`}
        >
          {/* Rail: wide containers only. */}
          <section
            aria-label="Categories"
            className={`${panelRise ? 'insight-rise ' : ''}hidden min-h-0 flex-col rounded-xl border @min-[900px]:flex`}
            style={{ ...PANEL_STYLE, ...cssVar('--i', 0) }}
          >
            <header className="px-4 pt-4">
              <h3 className="text-[15px] font-semibold" style={{ color: 'var(--map-fg)' }}>
                Categories
              </h3>
              <p className="mt-0.5 text-[12px]" style={{ color: 'var(--map-fg-muted)' }}>
                {plural(summary.categories.length, 'category', 'categories')} ·{' '}
                {plural(summary.total, 'ticket')}
              </p>
            </header>
            <div className="px-3 pb-2 pt-3">
              <Segmented
                label="Sort categories"
                options={RAIL_SORTS}
                value={railSort}
                onChange={setRailSort}
              />
            </div>
            <ul
              ref={railRef}
              style={railFadeStyle}
              className="kumbh-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
            >
              <RailRow
                label="All categories"
                tally={summary}
                color={null}
                selected={selKey === ALL}
                index={0}
                onSelect={() => selectCategory(null)}
                onKeyDown={(e) => onRailKey(e, 0, railKeys)}
                buttonRef={(el) => {
                  if (el) railRefs.current.set(ALL, el)
                  else railRefs.current.delete(ALL)
                }}
                itemRef={railItem(ALL)}
              />
              {categories.map((c, i) => (
                <RailRow
                  key={c.name}
                  label={c.name}
                  tally={c}
                  color={categoryColor(c.name)}
                  selected={selKey === c.name}
                  index={i + 1}
                  onSelect={() => selectCategory(c.name)}
                  onKeyDown={(e) => onRailKey(e, i + 1, railKeys)}
                  buttonRef={(el) => {
                    if (el) railRefs.current.set(c.name, el)
                    else railRefs.current.delete(c.name)
                  }}
                  itemRef={railItem(c.name)}
                />
              ))}
            </ul>
            <div className="border-t px-4 py-2.5" style={{ borderColor: 'var(--map-border)' }}>
              {railNote}
            </div>
          </section>

          <div className="min-w-0 @min-[900px]:min-h-0">
            {/* Chips: the rail's stand-in below the wide breakpoint. */}
            <div
              ref={chipRef}
              style={chipFadeStyle}
              role="group"
              aria-label="Category"
              className="kumbh-scroll -mx-4 -mt-1 mb-3 flex gap-2 overflow-x-auto overflow-y-hidden px-4 pb-1 pt-1 @min-[900px]:hidden"
            >
              {[{ key: ALL, label: 'All', n: summary.total, color: null as string | null }]
                .concat(
                  categories.map((c) => ({
                    key: c.name,
                    label: c.name,
                    n: c.total,
                    color: categoryColor(c.name),
                  })),
                )
                .map((c, i) => (
                  <CategoryChip
                    key={c.key}
                    label={c.label}
                    n={c.n}
                    color={c.color}
                    on={selKey === c.key}
                    index={i}
                    onSelect={() => selectCategory(c.key === ALL ? null : c.key)}
                    buttonRef={(el) => {
                      if (el) chipRefs.current.set(c.key, el)
                      else chipRefs.current.delete(c.key)
                    }}
                  />
                ))}
            </div>

            <section
              ref={detailRef}
              aria-label={`${hero.title} tickets`}
              className={`${panelRise ? 'insight-rise ' : ''}kumbh-scroll min-w-0 rounded-xl border p-4 @min-[900px]:h-full @min-[900px]:overflow-y-auto @min-[900px]:p-5`}
              style={{ ...PANEL_STYLE, ...cssVar('--i', 1) }}
            >
              <div className="flex flex-col">
                <div className="pb-6">
                  <Hero
                    eyebrow={hero.eyebrow}
                    title={hero.title}
                    subtitle={hero.subtitle}
                    tally={scopeTally}
                    color={heroColor}
                    status={status}
                    onStatus={setStatus}
                    onBack={subRow ? () => setSub(null) : undefined}
                    facts={facts}
                  />
                </div>
                {/* The slot stays mounted so the sub-list can open, close and re-measure with the
                    tickets below gliding rather than jumping. The gap below it lives inside. */}
                <GlideHeight open={subsFor !== null}>
                  {subsShown && (
                    <div className="pb-6">
                      <SubList
                        key={subsShown.name}
                        subs={subsShown.subs}
                        active={subsFor ? subName : null}
                        status={status}
                        onSelect={setSub}
                      />
                    </div>
                  )}
                </GlideHeight>
                <TicketList
                  tickets={tickets}
                  total={scoped.length}
                  now={now}
                  showCategory={current === null}
                  sectorNo={sectorNo}
                  plots={plots}
                  uniform={uniform}
                  longest={longest}
                  scopeLabel={
                    subName ? `${categoryName} › ${subName}` : (categoryName ?? 'All categories')
                  }
                  query={applied ? searchText.trim() : ''}
                  onClearQuery={clearSearch}
                  sort={ticketSort}
                  onSort={setTicketSort}
                  filterLabel={filterLabel}
                  onClearFilters={() => {
                    setStatus(null)
                    setSub(null)
                  }}
                  resetKey={`${selKey}|${status}|${subName}|${ticketSort}`}
                />
              </div>
            </section>
            <div className="mt-3 px-1 @min-[900px]:hidden">{railNote}</div>
          </div>
        </div>
      </div>
    </MotionCtx.Provider>
  )
}
