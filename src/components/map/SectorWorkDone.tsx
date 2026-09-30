'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDownIcon } from '@/components/map/icons'
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

type SortKey = 'most' | 'least-done' | 'most-done' | 'az'
const SORT_OPTIONS: { key: SortKey; label: string; title: string }[] = [
  { key: 'most', label: 'Most tickets', title: 'Largest categories first' },
  { key: 'least-done', label: 'Least done', title: 'Lowest completion first' },
  { key: 'most-done', label: 'Most done', title: 'Highest completion first' },
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
    case 'least-done':
      return sorted.sort((a, b) => ratio(a) - ratio(b) || b.total - a.total || byName(a, b))
    case 'most-done':
      return sorted.sort((a, b) => ratio(b) - ratio(a) || b.total - a.total || byName(a, b))
    case 'az':
      return sorted.sort(byName)
  }
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
      className="flex w-full overflow-hidden rounded-full"
      style={{ height, backgroundColor: 'var(--map-switch-track)' }}
      role="img"
      aria-label={breakdownTitle(tally)}
      title={breakdownTitle(tally)}
    >
      {tally.total > 0 &&
        order.map((b) =>
          tally.counts[b] > 0 ? (
            <span
              key={b}
              className="block h-full transition-[width] duration-500 ease-out [&:not(:last-child)]:border-r"
              style={{
                width: grown ? `${(tally.counts[b] / tally.total) * 100}%` : '0%',
                backgroundColor: BUCKET_COLORS[b][theme],
                borderColor: 'var(--map-panel-bg)',
              }}
            />
          ) : null,
        )}
    </div>
  )
}

function ProgressRing({ tally }: { tally: Tally }) {
  const theme = useInsightTheme()
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const r = 26
  const c = 2 * Math.PI * r
  const done = ratio(tally)
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
          style={{ transition: 'stroke-dashoffset 700ms ease-out', opacity: done > 0 ? 1 : 0 }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[15px] font-bold tabular-nums"
        style={{ color: 'var(--map-fg)' }}
      >
        {formatDonePct(tally)}
      </span>
    </div>
  )
}

function DonePill({ tally }: { tally: Tally }) {
  const theme = useInsightTheme()
  const complete = tally.total > 0 && tally.resolved === tally.total
  const color = BUCKET_COLORS.resolved[theme]
  return (
    <span
      className="inline-flex min-w-[42px] shrink-0 items-center justify-center rounded-full px-1.5 py-[3px] text-[10.5px] font-bold leading-none tabular-nums"
      style={
        complete
          ? { backgroundColor: color, color: theme === 'dark' ? '#052e16' : '#ffffff' }
          : {
              backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
              color: 'var(--map-fg)',
            }
      }
    >
      {complete ? '✓ Done' : formatDonePct(tally)}
    </span>
  )
}

function SubCategoryRow({ row }: { row: SubRow }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-[11.5px]"
          style={{ color: 'var(--map-fg-muted)' }}
          title={row.name}
        >
          {row.name}
        </span>
        <span
          className="shrink-0 text-[10.5px] tabular-nums"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          <span className="font-semibold" style={{ color: 'var(--map-fg)' }}>
            {row.resolved}
          </span>
          /{row.total}
        </span>
        <DonePill tally={row} />
      </div>
      <StackedBar tally={row} height={4} />
    </li>
  )
}

function CategoryCard({
  row,
  expanded,
  onToggle,
  index,
}: {
  row: CategoryRow
  expanded: boolean
  onToggle: () => void
  index: number
}) {
  const color = CLASS_GROUP_COLORS[row.name] ?? CLASS_GROUP_COLORS.Other ?? '#94a3b8'
  // A lone sub-category that just repeats the category's own name (every "Parking" plot's
  // subclass is "Parking") carries nothing a drill-down would add.
  const expandable = !(row.subs.length === 1 && row.subs[0].name === row.name)
  const listId = `work-done-subs-${index}`
  const header = (
    <>
      <span className="flex w-full items-center gap-2">
        {expandable ? (
          <ChevronDownIcon
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
          />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 text-left">
          <span
            className="block truncate text-[12.5px] font-bold leading-tight"
            style={{ color: 'var(--map-fg)' }}
          >
            {row.name}
          </span>
          <span
            className="mt-0.5 block text-[10.5px] leading-tight tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {row.resolved} of {row.total} resolved
            {expandable &&
              ` · ${row.subs.length} sub-${row.subs.length === 1 ? 'category' : 'categories'}`}
          </span>
        </span>
        <DonePill tally={row} />
      </span>
      <span className="mt-2 block w-full pl-[22px]">
        <StackedBar tally={row} height={6} />
      </span>
    </>
  )
  return (
    <div
      className="animate-[fade-in_300ms_ease-out_backwards] overflow-hidden rounded-[10px] border"
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
          aria-controls={listId}
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
          className="flex flex-col gap-0.5 border-t px-1 py-1 animate-[fade-in_200ms_ease-out]"
          style={{ borderColor: 'var(--map-border)' }}
        >
          {row.subs.map((sub) => (
            <SubCategoryRow key={sub.name} row={sub} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default function SectorWorkDone({
  summary,
  loading,
  error,
  onRetry,
}: {
  summary: WorkDoneSummary | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const theme = useInsightTheme()
  const [sortKey, setSortKey] = useState<SortKey>('most')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const categories = useMemo(
    () => (summary ? sortCategories(summary.categories, sortKey) : []),
    [summary, sortKey],
  )
  const expandableNames = categories
    .filter((c) => !(c.subs.length === 1 && c.subs[0].name === c.name))
    .map((c) => c.name)
  const allExpanded = expandableNames.length > 0 && expandableNames.every((n) => expanded.has(n))

  if (error && !summary) {
    return (
      <div className="px-5 py-4">
        <div
          className="flex items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-[12.5px]"
          style={{
            borderColor: 'var(--danger-soft)',
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
    return (
      <div
        className="flex items-center gap-2 px-5 py-8 text-[12.5px]"
        style={{ color: 'var(--map-fg-muted)' }}
      >
        {loading && (
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2"
            style={{ borderColor: 'var(--map-switch-track)', borderTopColor: 'var(--map-accent)' }}
          />
        )}
        Loading ticket progress…
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
    <div className="kumbh-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      {/* Summary: overall completion + status split. */}
      <div
        className="mt-3 flex flex-col gap-3 rounded-xl border p-3 @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:gap-4"
        style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
      >
        <div className="flex items-center gap-3 @min-[560px]:w-[240px] @min-[560px]:shrink-0">
          <ProgressRing tally={summary} />
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold leading-tight" style={{ color: 'var(--map-fg)' }}>
              Work complete
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
                  style={{ backgroundColor: BUCKET_COLORS[b][theme] }}
                  aria-hidden="true"
                />
                <span
                  className="min-w-0 flex-1 truncate text-[10.5px]"
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
        className="sticky top-0 z-10 -mx-4 mt-1 flex flex-wrap items-center gap-2 px-4 pb-2 pt-3 backdrop-blur-md"
        style={{
          backgroundColor: 'var(--map-panel-bg)',
          backgroundImage: 'linear-gradient(var(--map-panel-bg), var(--map-panel-bg))',
        }}
      >
        <span
          className="text-[11px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          By category · {categories.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Sort categories"
            className="flex rounded-lg border p-0.5"
            style={{ borderColor: 'var(--map-border)', backgroundColor: 'var(--map-surface-alt)' }}
          >
            {SORT_OPTIONS.map((opt) => {
              const active = opt.key === sortKey
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={opt.title}
                  onClick={() => setSortKey(opt.key)}
                  className="cursor-pointer rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors"
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
              onClick={() => setExpanded(allExpanded ? new Set() : new Set(expandableNames))}
              className="cursor-pointer rounded-md px-1.5 py-1 text-[10.5px] font-semibold hover:bg-[var(--map-surface-hover)]"
              style={{ color: 'var(--map-accent)' }}
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-2 @min-[720px]:grid-cols-2 @min-[1100px]:grid-cols-3">
        {categories.map((row, i) => (
          <CategoryCard
            key={row.name}
            row={row}
            index={i}
            expanded={expanded.has(row.name)}
            onToggle={() =>
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(row.name)) next.delete(row.name)
                else next.add(row.name)
                return next
              })
            }
          />
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
        Counts every ticket filed in this sector, regardless of Ticket-mode filters. “Done” means
        resolved.
      </p>
    </div>
  )
}
