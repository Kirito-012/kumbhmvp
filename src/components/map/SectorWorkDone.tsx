'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDownIcon, SearchIcon, XIcon } from '@/components/map/icons'
import { CLASS_GROUP_COLORS } from '@/lib/classColors'
import {
  BUCKET_COLORS,
  BUCKET_LABELS,
  BUCKET_ORDER,
  type StatusBucket,
} from '@/lib/insights/statusBuckets'
import { TicketField, type InsightsTicketData } from '@/lib/insights/types'
import { useInsightTheme } from '@/components/map/insights/useInsightTheme'

// Deliberately imports nothing from insights/charts.tsx: that module pulls in recharts, and this
// file is reachable from MapView's static SectorReportDrawer import in Map mode.

type BucketCounts = Record<StatusBucket, number>

type Tally = { counts: BucketCounts; total: number; resolved: number }

type SubRow = Tally & { name: string }
type CategoryRow = Tally & { name: string; subs: SubRow[] }

export type WorkDoneSummary = Tally & { categories: CategoryRow[] }

/** Label for tickets whose parcel snapshot carries no subclass. */
const UNSPECIFIED_SUBCLASS = 'Unspecified'

type SortKey = 'most' | 'remaining' | 'completion' | 'az'
const SORT_OPTIONS: { key: SortKey; label: string; title: string }[] = [
  { key: 'most', label: 'Most tickets', title: 'Largest categories first' },
  { key: 'remaining', label: 'Most remaining', title: 'Most unresolved tickets first' },
  { key: 'completion', label: 'Completion %', title: 'Highest completion first' },
  { key: 'az', label: 'A–Z', title: 'Alphabetical' },
]

function emptyTally(): Tally {
  return { counts: { new: 0, open: 0, pending: 0, resolved: 0 }, total: 0, resolved: 0 }
}

function addTo(tally: Tally, bucket: StatusBucket) {
  tally.counts[bucket]++
  tally.total++
  if (bucket === 'resolved') tally.resolved++
}

function ratio(t: Tally) {
  return t.total > 0 ? t.resolved / t.total : 0
}

/** Whole percent, but never rounds a partial job up to "100%" or a started one down to "0%". */
export function formatDonePct(t: Tally) {
  if (t.total === 0) return '0%'
  const pct = (t.resolved / t.total) * 100
  if (pct > 0 && pct < 1) return '<1%'
  if (pct < 100 && pct > 99) return '99%'
  return `${Math.round(pct)}%`
}

/** Rolls the sector's tickets up into category → sub-category tallies, split by status bucket. */
export function summarizeWorkDone(data: InsightsTicketData, sectorNo: number): WorkDoneSummary {
  const total = emptyTally()
  const byClass = new Map<string, { tally: Tally; subs: Map<string, Tally> }>()
  for (const t of data.tickets) {
    if (t[TicketField.SectorNo] !== sectorNo) continue
    const bucket = data.statuses[t[TicketField.StatusIdx]]?.bucket ?? 'open'
    const cls = data.classGroups[t[TicketField.ClassGroupIdx]] ?? 'Other'
    const subIdx = t[TicketField.SubclassIdx]
    const sub = (subIdx >= 0 ? data.subclasses[subIdx] : null) || UNSPECIFIED_SUBCLASS

    addTo(total, bucket)
    let entry = byClass.get(cls)
    if (!entry) {
      entry = { tally: emptyTally(), subs: new Map() }
      byClass.set(cls, entry)
    }
    addTo(entry.tally, bucket)
    let subTally = entry.subs.get(sub)
    if (!subTally) {
      subTally = emptyTally()
      entry.subs.set(sub, subTally)
    }
    addTo(subTally, bucket)
  }

  const categories: CategoryRow[] = [...byClass.entries()].map(([name, { tally, subs }]) => ({
    name,
    ...tally,
    subs: [...subs.entries()]
      .map(([subName, subTally]) => ({ name: subName, ...subTally }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  }))
  return { ...total, categories }
}

function sortCategories(rows: CategoryRow[], key: SortKey) {
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

function formatShare(share: number) {
  const pct = share * 100
  if (pct > 0 && pct < 1) return '<1%'
  return `${Math.round(pct)}%`
}

/** "3 pending · 2 open" -- only the non-zero unresolved buckets; resolved is the pill/bar. */
function unresolvedSummary(t: Tally) {
  const parts = (['pending', 'open', 'new'] as StatusBucket[])
    .filter((b) => t.counts[b] > 0)
    .map((b) => `${t.counts[b]} ${BUCKET_LABELS[b].toLowerCase()}`)
  return parts.length > 0 ? parts.join(' · ') : 'All resolved'
}

function breakdownTitle(t: Tally) {
  return BUCKET_ORDER.map((b) => `${BUCKET_LABELS[b]} ${t.counts[b]}`).join(' · ')
}

/**
 * Status-segmented progress bar: resolved first (the "done" part reads left-to-right like a normal
 * progress bar), then the unresolved buckets from furthest-along to least. Segments grow in from 0
 * on mount so the tab doesn't just pop in flat.
 */
function StackedBar({ tally, height }: { tally: Tally; height: number }) {
  const theme = useInsightTheme()
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const order: StatusBucket[] = ['resolved', 'pending', 'open', 'new']
  return (
    <div
      // gap-px lets the opaque track show through as the segment separator; a border in a
      // translucent surface token can't act as a cut-out. Decorative: every bar sits beside a
      // visible or sr-only text equivalent, so it is hidden from assistive tech.
      className="flex w-full gap-px overflow-hidden rounded-full"
      style={{ height, backgroundColor: 'var(--map-switch-track)' }}
      aria-hidden="true"
      title={breakdownTitle(tally)}
    >
      {tally.total > 0 &&
        order.map((b) =>
          tally.counts[b] > 0 ? (
            <span
              key={b}
              // min-w keeps a 1-ticket segment visible in a 500-ticket bar. Unresolved hues are
              // softened so the green "done" run reads as the progress, not one of four equals.
              className="block h-full min-w-[3px] motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-out"
              style={{
                width: grown ? `${(tally.counts[b] / tally.total) * 100}%` : '0%',
                backgroundColor: BUCKET_COLORS[b][theme],
                opacity: b === 'resolved' ? 1 : 0.62,
              }}
            />
          ) : null,
        )}
    </div>
  )
}

export function ProgressRing({ fraction: done, label }: { fraction: number; label: string }) {
  const theme = useInsightTheme()
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          stroke="var(--map-switch-track)"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke={BUCKET_COLORS.resolved[theme]}
          strokeDasharray={c}
          strokeDashoffset={grown ? c * (1 - done) : c}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700 motion-safe:ease-out"
          style={{ opacity: done > 0 ? 1 : 0 }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[15px] font-bold tabular-nums"
        style={{ color: 'var(--map-fg)' }}
      >
        {label}
      </span>
    </div>
  )
}

function DonePill({ tally }: { tally: Tally }) {
  return (
    <PctPill
      fraction={tally.total > 0 && tally.resolved === tally.total ? 1 : ratio(tally)}
      label={formatDonePct(tally)}
    />
  )
}

/** Completion pill shared by the ticket and work-head views: neutral at 0, tinted once started. */
export function PctPill({ fraction, label }: { fraction: number; label: string }) {
  const theme = useInsightTheme()
  const complete = fraction >= 1
  const color = BUCKET_COLORS.resolved[theme]
  // Green only means progress: neutral at 0%, tinted once anything is resolved, solid when done.
  const style = complete
    ? theme === 'dark'
      ? { backgroundColor: color, color: '#052e16' }
      : { backgroundColor: '#15803d', color: '#ffffff' }
    : fraction > 0
      ? {
          backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
          color: 'var(--map-fg)',
        }
      : { backgroundColor: 'var(--map-switch-track)', color: 'var(--map-fg-muted)' }
  return (
    <span
      className="inline-flex min-w-[44px] shrink-0 items-center justify-center rounded-full px-1.5 py-[3px] text-[12px] font-bold leading-none tabular-nums"
      style={style}
    >
      {complete ? '✓ Done' : label}
    </span>
  )
}

/** Wraps the first case-insensitive occurrence of `query` in an accent highlight. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark
        className="rounded-[3px] px-px"
        style={{ backgroundColor: 'var(--map-accent-bg-hover)', color: 'inherit' }}
      >
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  )
}

function SubCategoryRow({ row, query }: { row: SubRow; query: string }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-[11.5px]"
          style={{ color: 'var(--map-fg-muted)' }}
          title={row.name}
        >
          <Highlight text={row.name} query={query} />
        </span>
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          {row.total} {row.total === 1 ? 'ticket' : 'tickets'}
        </span>
        <DonePill tally={row} />
      </div>
      <StackedBar tally={row} height={6} />
      <p
        className="text-[11px] leading-tight tabular-nums"
        style={{ color: 'var(--map-fg-muted)' }}
      >
        {unresolvedSummary(row)}
      </p>
    </li>
  )
}

function CategoryCard({
  row,
  expanded,
  onToggle,
  index,
  sectorTotal,
  subs,
  query,
}: {
  row: CategoryRow
  /** Open state for this card: the user's own toggle, or forced open by a sub-category search hit. */
  expanded: boolean
  onToggle: () => void
  index: number
  sectorTotal: number
  /** Sub-categories to list -- all of them, or only the ones matching the search. */
  subs: SubRow[]
  query: string
}) {
  const color = CLASS_GROUP_COLORS[row.name] ?? CLASS_GROUP_COLORS.Other ?? '#94a3b8'
  // A lone sub-category that just repeats the category's own name (every "Parking" plot's
  // subclass is "Parking") carries nothing a drill-down would add.
  const expandable = !(row.subs.length === 1 && row.subs[0].name === row.name)
  const listId = `work-done-subs-${useId()}`
  const header = (
    <>
      <span className="flex w-full items-center gap-2">
        {expandable && (
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:duration-200 ${expanded ? '' : '-rotate-90'}`}
          />
        )}
        {/* Hollow, not filled: class colours share hues with the status colours in the bars below
            (e.g. Administrative Camping green = Resolved green), so a solid swatch read as a
            status. An outline is clearly "identity", a fill is clearly "status". */}
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[3px] border-2"
          style={{ borderColor: color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 text-left">
          <span
            className="block truncate text-[12.5px] font-bold leading-tight"
            style={{ color: 'var(--map-fg)' }}
            title={row.name}
          >
            <Highlight text={row.name} query={query} />
          </span>
          <span
            className="mt-0.5 block text-[11.5px] leading-tight tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {row.resolved} of {row.total} resolved
            {row.total > row.resolved && ` · ${row.total - row.resolved} to do`}
          </span>
          <span
            className="mt-0.5 block text-[11px] leading-tight tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {sectorTotal > 0 && `${formatShare(row.total / sectorTotal)} of sector tickets`}
            {expandable &&
              ` · ${row.subs.length} sub-${row.subs.length === 1 ? 'category' : 'categories'}`}
          </span>
          <span className="sr-only">{breakdownTitle(row)}</span>
        </span>
        <DonePill tally={row} />
      </span>
      <span className="mt-2 block w-full">
        <StackedBar tally={row} height={6} />
      </span>
    </>
  )
  return (
    <div
      data-category={row.name}
      className="overflow-hidden rounded-[10px] border motion-safe:animate-[fade-in_300ms_ease-out_backwards]"
      style={{
        backgroundColor: 'var(--map-surface-alt)',
        borderColor: expanded
          ? `color-mix(in srgb, ${color} 45%, var(--map-border))`
          : 'var(--map-border)',
        animationDelay: `${Math.min(index, 12) * 35}ms`,
      }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          className="flex w-full cursor-pointer flex-col px-2.5 py-2 text-left transition-colors hover:bg-[var(--map-surface-hover)]"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          {header}
        </button>
      ) : (
        <div className="flex flex-col px-2.5 py-2">{header}</div>
      )}
      {expandable && expanded && (
        <ul
          id={listId}
          className="flex flex-col gap-0.5 border-t px-1 py-1 motion-safe:animate-[fade-in_200ms_ease-out]"
          style={{ borderColor: 'var(--map-border)' }}
        >
          {subs.map((sub) => (
            <SubCategoryRow key={sub.name} row={sub} query={query} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function TicketProgress({
  summary,
  error,
  onRetry,
  initialOpen,
}: {
  summary: WorkDoneSummary | null
  error: string | null
  onRetry: () => void
  /** Category to open and scroll to on arrival (a drill-through from the Insights bars). */
  initialOpen?: string
}) {
  const theme = useInsightTheme()
  const [sortKey, setSortKey] = useState<SortKey>('most')
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialOpen ? [initialOpen] : []),
  )
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!initialOpen) return
    const card = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>('[data-category]') ?? []),
    ].find((el) => el.dataset.category === initialOpen)
    card?.scrollIntoView({ block: 'nearest' })
  }, [initialOpen])

  const [query, setQuery] = useState('')
  const q = query.trim()

  const sorted = useMemo(
    () => (summary ? sortCategories(summary.categories, sortKey) : []),
    [summary, sortKey],
  )
  // A search matches category names and sub-category names. A sub-category hit narrows that card
  // to its matching sub-rows and opens it (so the hit is visible without a click); a category-name
  // hit alone keeps the card as-is.
  const categories = useMemo(() => {
    if (!q) return sorted.map((row) => ({ row, subs: row.subs, forceOpen: false }))
    const needle = q.toLowerCase()
    const out: { row: CategoryRow; subs: SubRow[]; forceOpen: boolean }[] = []
    for (const row of sorted) {
      const subHits = row.subs.filter((sub) => sub.name.toLowerCase().includes(needle))
      const lone = row.subs.length === 1 && row.subs[0].name === row.name
      if (subHits.length > 0 && !lone) out.push({ row, subs: subHits, forceOpen: true })
      else if (row.name.toLowerCase().includes(needle))
        out.push({ row, subs: row.subs, forceOpen: false })
    }
    return out
  }, [sorted, q])
  const isOpen = (c: (typeof categories)[number]) => c.forceOpen || expanded.has(c.row.name)
  const expandableNames = categories
    .filter((c) => !(c.row.subs.length === 1 && c.row.subs[0].name === c.row.name))
    .map((c) => c.row.name)
  const allExpanded =
    expandableNames.length > 0 &&
    categories.every((c) => !expandableNames.includes(c.row.name) || isOpen(c))

  if (error && !summary) {
    return (
      <div className="px-5 py-4">
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-[12.5px]"
          style={{
            borderColor: 'var(--danger)',
            backgroundColor: 'var(--danger-soft)',
            color: 'var(--danger)',
          }}
        >
          <span>Failed to load ticket progress: {error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 cursor-pointer font-semibold underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!summary) {
    // Skeleton mirrors the real layout (summary card + category cards) so nothing jumps on load.
    return (
      <div role="status" aria-live="polite" className="min-h-0 flex-1 overflow-hidden px-4 pt-3">
        <span className="sr-only">Loading ticket progress…</span>
        <div
          className="h-[92px] rounded-xl border motion-safe:animate-pulse"
          style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
        />
        <div className="mt-4 grid grid-cols-1 gap-2 @min-[720px]:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[84px] rounded-[10px] border motion-safe:animate-pulse"
              style={{
                backgroundColor: 'var(--map-surface-alt)',
                borderColor: 'var(--map-border)',
              }}
            />
          ))}
        </div>
      </div>
    )
  }

  if (summary.total === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-5 py-10 text-center">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--map-fg)' }}>
          No tickets in this sector yet
        </p>
        <p className="text-[11.5px]" style={{ color: 'var(--map-fg-muted)' }}>
          Progress will appear here once tickets are filed against its parcels.
        </p>
      </div>
    )
  }

  const remaining = summary.total - summary.resolved

  return (
    <div ref={rootRef} className="kumbh-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      {error && (
        <div
          role="alert"
          className="mt-3 flex items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 text-[11.5px]"
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
      {/* Summary: overall completion + status split. */}
      <div
        className="mt-3 flex flex-col gap-3 rounded-xl border p-3 @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:gap-4"
        style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
      >
        <div className="flex items-center gap-3 @min-[560px]:w-[240px] @min-[560px]:shrink-0">
          <ProgressRing fraction={ratio(summary)} label={formatDonePct(summary)} />
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold leading-tight" style={{ color: 'var(--map-fg)' }}>
              Overall progress
            </p>
            <p
              className="mt-0.5 text-[11.5px] leading-snug tabular-nums"
              style={{ color: 'var(--map-fg-muted)' }}
            >
              <span className="font-semibold" style={{ color: 'var(--map-fg)' }}>
                {summary.resolved}
              </span>{' '}
              of {summary.total} tickets resolved
            </p>
            <p
              className="mt-0.5 text-[11px] leading-snug tabular-nums"
              style={{ color: 'var(--map-fg-muted)' }}
            >
              {remaining === 0 ? 'Nothing outstanding' : `${remaining} still to do`}
            </p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <StackedBar tally={summary} height={10} />
          <div className="mt-2 grid grid-cols-2 gap-1.5 @min-[400px]:grid-cols-4">
            {(['resolved', 'pending', 'open', 'new'] as StatusBucket[]).map((b) => (
              <div
                key={b}
                className="flex items-center gap-1.5 rounded-md border px-1.5 py-1"
                style={{ borderColor: 'var(--map-border)' }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: BUCKET_COLORS[b][theme],
                    opacity: b === 'resolved' ? 1 : 0.62,
                  }}
                  aria-hidden="true"
                />
                <span
                  className="min-w-0 flex-1 truncate text-[11px]"
                  style={{ color: 'var(--map-fg-muted)' }}
                >
                  {BUCKET_LABELS[b]}
                </span>
                <span
                  className="shrink-0 text-[11px] font-bold tabular-nums"
                  style={{ color: 'var(--map-fg)' }}
                >
                  {summary.counts[b]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toolbar -- sticky so sort/expand stay reachable while scrolling a long category list.
          Same double-painted translucent-token background as the General tab's ColHead. */}
      <div
        className="-mx-4 mt-1 flex @min-[560px]:sticky @min-[560px]:top-0 @min-[560px]:z-10 flex-wrap items-center gap-2 px-4 pb-2 pt-3 backdrop-blur-md"
        style={{
          backgroundColor: 'var(--map-panel-bg)',
          backgroundImage: 'linear-gradient(var(--map-panel-bg), var(--map-panel-bg))',
        }}
      >
        <span
          className="text-[11px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          By category · {q ? `${categories.length} of ${sorted.length}` : sorted.length}
        </span>
        <div className="relative order-last flex min-w-[180px] flex-1 basis-full items-center @min-[560px]:order-none @min-[560px]:basis-auto @min-[560px]:max-w-[240px]">
          <SearchIcon className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--map-fg-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                e.stopPropagation()
                setQuery('')
              }
            }}
            placeholder="Search categories…"
            aria-label="Search categories and sub-categories"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border py-1 pl-7 pr-7 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)] [&::-webkit-search-cancel-button]:hidden"
            style={{
              backgroundColor: 'var(--map-surface-alt)',
              borderColor: 'var(--map-border)',
              color: 'var(--map-fg)',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-[var(--map-fg-muted)] hover:bg-[var(--map-surface-hover)]"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            Sort
          </span>
          {/* Plain toggle-button group (aria-pressed), not role=radiogroup: that role promises a
              roving tabindex + arrow keys we don't implement. */}
          <div
            role="group"
            aria-label="Sort categories"
            className="flex max-w-full overflow-x-auto rounded-lg border p-0.5"
            style={{ borderColor: 'var(--map-border)', backgroundColor: 'var(--map-surface-alt)' }}
          >
            {SORT_OPTIONS.map((opt) => {
              const active = opt.key === sortKey
              return (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={active}
                  title={opt.title}
                  onClick={() => setSortKey(opt.key)}
                  className="cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold transition-colors"
                  style={
                    active
                      ? { backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }
                      : { color: 'var(--map-fg-muted)' }
                  }
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          {expandableNames.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  for (const n of expandableNames) {
                    if (allExpanded) next.delete(n)
                    else next.add(n)
                  }
                  return next
                })
              }
              className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-semibold hover:bg-[var(--map-surface-hover)]"
              style={{ color: 'var(--map-accent)' }}
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
      </div>

      {/* Grid, not CSS columns: expanding a card must not re-balance and shuffle cards sideways. */}
      <div className="grid grid-cols-1 items-start gap-2 @min-[720px]:grid-cols-2 @min-[1100px]:grid-cols-3">
        {categories.map((c, i) => (
          <CategoryCard
            key={c.row.name}
            row={c.row}
            subs={c.subs}
            query={q}
            index={i}
            sectorTotal={summary.total}
            expanded={isOpen(c)}
            onToggle={() =>
              setExpanded((prev) => {
                const next = new Set(prev)
                // A search-forced card toggles off its underlying (hidden) state first.
                if (isOpen(c) && !next.has(c.row.name)) next.add(c.row.name)
                else if (next.has(c.row.name)) next.delete(c.row.name)
                else next.add(c.row.name)
                return next
              })
            }
          />
        ))}
      </div>
      {categories.length === 0 && (
        <div role="status" className="flex flex-col items-center gap-1.5 px-5 py-8 text-center">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--map-fg)' }}>
            No matches for “{q}”
          </p>
          <p className="text-[11.5px]" style={{ color: 'var(--map-fg-muted)' }}>
            Try a category or sub-category name.
          </p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="mt-1 cursor-pointer text-[11.5px] font-semibold underline underline-offset-2"
            style={{ color: 'var(--map-accent)' }}
          >
            Clear search
          </button>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
        Counts every ticket filed in this sector, regardless of Ticket-mode filters. “Done” means
        resolved.
      </p>
    </div>
  )
}
