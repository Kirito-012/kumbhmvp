'use client'

import { useId, useMemo, useState } from 'react'
import { ChevronDownIcon, SearchIcon, XIcon } from '@/components/map/icons'
import { Highlight, PctPill, ProgressRing } from '@/components/map/SectorWorkDone'
import { useInsightTheme } from '@/components/map/insights/useInsightTheme'
import { BUCKET_COLORS } from '@/lib/insights/statusBuckets'
import {
  buildSectorWorkHeads,
  formatQuantity,
  type HeadProgress,
  type SubHeadProgress,
  type WorkStatus,
} from '@/lib/workHeads/demo'

// Main Heads / Sub-Heads view of the Work Done tab. Structure comes from the planning document
// (src/lib/workHeads/heads.ts); every figure is DEMO data (src/lib/workHeads/demo.ts) and is
// labelled as such wherever it appears.

const STATUS_ORDER: WorkStatus[] = ['completed', 'in-progress', 'delayed', 'not-started']
const STATUS_LABEL: Record<WorkStatus, string> = {
  completed: 'Completed',
  'in-progress': 'In progress',
  delayed: 'Delayed',
  'not-started': 'Not started',
}

function statusColor(status: WorkStatus, theme: 'light' | 'dark') {
  switch (status) {
    case 'completed':
      return BUCKET_COLORS.resolved[theme]
    case 'in-progress':
      return BUCKET_COLORS.open[theme]
    case 'delayed':
      return theme === 'dark' ? '#f87171' : '#dc2626'
    case 'not-started':
      return theme === 'dark' ? '#64748b' : '#94a3b8'
  }
}

type SortKey = 'no' | 'lowest' | 'delayed' | 'az'
const SORT_OPTIONS: { key: SortKey; label: string; title: string }[] = [
  { key: 'no', label: 'Head no.', title: 'Order used in the planning document' },
  { key: 'lowest', label: 'Lowest progress', title: 'Least complete heads first' },
  { key: 'delayed', label: 'Most delayed', title: 'Heads with the most delayed sub-heads first' },
  { key: 'az', label: 'A–Z', title: 'Alphabetical' },
]

function formatPct(fraction: number) {
  const pct = fraction * 100
  if (pct > 0 && pct < 1) return '<1%'
  if (pct < 100 && pct > 99) return '99%'
  return `${Math.round(pct)}%`
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const DAY_MS = 86_400_000

export function DemoBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-[2px] text-[11px] font-bold uppercase leading-none tracking-wide ${className}`}
      style={{
        backgroundColor: 'var(--map-section-amber-bg)',
        color: 'var(--map-section-amber-fg)',
        borderColor: 'color-mix(in srgb, var(--map-section-amber-fg) 35%, transparent)',
      }}
      title="Demo data — not live figures"
    >
      Demo
    </span>
  )
}

/** Single-colour progress bar. Decorative: the figures beside it carry the same information. */
function FillBar({ fraction, color, height }: { fraction: number; color: string; height: number }) {
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{ height, backgroundColor: 'var(--map-switch-track)' }}
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.max(fraction > 0 ? 1.5 : 0, fraction * 100)}%`,
          backgroundColor: color,
        }}
      />
    </div>
  )
}

function StatusChip({ status, now, target }: { status: WorkStatus; now: number; target: number }) {
  const theme = useInsightTheme()
  const color = statusColor(status, theme)
  const overdueDays = status === 'delayed' ? Math.max(1, Math.round((now - target) / DAY_MS)) : 0
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-[3px] text-[11px] font-semibold leading-none"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        color: 'var(--map-fg)',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
      {overdueDays > 0 && ` · ${overdueDays}d`}
    </span>
  )
}

function SubHeadRow({ sub, query, now }: { sub: SubHeadProgress; query: string; now: number }) {
  const theme = useInsightTheme()
  const color = statusColor(sub.status, theme)
  const stats: [string, string][] = [
    ['Required', formatQuantity(sub.required, sub.unit)],
    ['Planned', formatQuantity(sub.planned, sub.unit)],
    ['Completed', formatQuantity(sub.completed, sub.unit)],
    ['Balance', formatQuantity(sub.balance, sub.unit)],
  ]
  return (
    <li className="flex flex-col gap-1.5 rounded-lg px-2 py-2">
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-[12px] font-semibold"
          style={{ color: 'var(--map-fg)' }}
          title={sub.name}
        >
          <Highlight text={sub.name} query={query} />
        </span>
        <StatusChip status={sub.status} now={now} target={sub.targetDate} />
        <PctPill fraction={sub.fraction} label={formatPct(sub.fraction)} />
      </div>
      <FillBar fraction={sub.fraction} color={color} height={6} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 @min-[420px]:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] leading-tight" style={{ color: 'var(--map-fg-muted)' }}>
              {label}
            </dt>
            <dd
              className="truncate text-[11.5px] font-semibold leading-tight tabular-nums"
              style={{ color: 'var(--map-fg)' }}
              title={value}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p
        className="text-[11px] leading-snug"
        style={{ color: 'var(--map-fg-muted)' }}
        title={sub.details?.join(' · ')}
      >
        Target {DATE_FMT.format(sub.targetDate)} · {sub.department}
        {sub.completed > 0 && (sub.verified ? ' · Verified' : ' · Awaiting verification')}
      </p>
      {sub.details && (
        <p className="truncate text-[11px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
          Includes: {sub.details.join(' · ')}
        </p>
      )}
    </li>
  )
}

function HeadCard({
  head,
  subs,
  expanded,
  onToggle,
  query,
  now,
  index,
}: {
  head: HeadProgress
  subs: SubHeadProgress[]
  expanded: boolean
  onToggle: () => void
  query: string
  now: number
  index: number
}) {
  const theme = useInsightTheme()
  const listId = `work-head-subs-${useId()}`
  const barColor =
    head.fraction >= 1 ? statusColor('completed', theme) : statusColor('in-progress', theme)
  return (
    <div
      className="overflow-hidden rounded-[10px] border motion-safe:animate-[fade-in_300ms_ease-out_backwards]"
      style={{
        backgroundColor: 'var(--map-surface-alt)',
        borderColor: expanded
          ? 'color-mix(in srgb, var(--map-accent) 45%, var(--map-border))'
          : 'var(--map-border)',
        animationDelay: `${Math.min(index, 12) * 35}ms`,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        className="flex w-full cursor-pointer flex-col px-2.5 py-2 text-left transition-colors hover:bg-[var(--map-surface-hover)]"
      >
        <span className="flex w-full items-center gap-2">
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:duration-200 ${expanded ? '' : '-rotate-90'}`}
          />
          <span
            className="flex h-6 min-w-[26px] shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-bold tabular-nums"
            style={{ backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
          >
            {head.no}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-[12.5px] font-bold leading-tight"
              style={{ color: 'var(--map-fg)' }}
              title={head.name}
            >
              <Highlight text={head.name} query={query} />
            </span>
            <span
              className="mt-0.5 block text-[11px] leading-tight tabular-nums"
              style={{ color: 'var(--map-fg-muted)' }}
            >
              {head.subs.length} sub-heads · {head.counts.completed} completed
              {head.counts.delayed > 0 && ` · ${head.counts.delayed} delayed`}
            </span>
          </span>
          <DemoBadge />
          <PctPill fraction={head.fraction} label={formatPct(head.fraction)} />
        </span>
        <span className="mt-2 block w-full">
          <FillBar fraction={head.fraction} color={barColor} height={6} />
        </span>
      </button>
      {expanded && (
        <div id={listId} className="border-t" style={{ borderColor: 'var(--map-border)' }}>
          <p
            className="px-3 pt-2 text-[11px] leading-snug"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {head.purpose}
          </p>
          <ul className="flex flex-col divide-y divide-[var(--map-border)] px-1 py-1 motion-safe:animate-[fade-in_200ms_ease-out]">
            {subs.map((sub) => (
              <SubHeadRow key={sub.name} sub={sub} query={query} now={now} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function SectorWorkHeads({ sectorNo }: { sectorNo: number }) {
  const theme = useInsightTheme()
  // Captured once so "overdue" doesn't tick mid-session and demo targets stay put.
  const [now] = useState(() => Date.now())
  const data = useMemo(() => buildSectorWorkHeads(sectorNo, now), [sectorNo, now])

  const [query, setQuery] = useState('')
  const q = query.trim()
  const [sortKey, setSortKey] = useState<SortKey>('no')
  const [statusFilter, setStatusFilter] = useState<WorkStatus | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const sorted = useMemo(() => {
    const rows = [...data.heads]
    switch (sortKey) {
      case 'lowest':
        return rows.sort((a, b) => a.fraction - b.fraction || a.no.localeCompare(b.no))
      case 'delayed':
        return rows.sort((a, b) => b.counts.delayed - a.counts.delayed || a.fraction - b.fraction)
      case 'az':
        return rows.sort((a, b) => a.name.localeCompare(b.name))
      default:
        return rows
    }
  }, [data.heads, sortKey])

  // Search matches head number/name and sub-head names; the status chips narrow sub-heads to one
  // status. Either one narrowing a card's sub-heads also opens it, so the hits are visible without
  // a click. A head-name hit alone keeps the card as it was.
  const visible = useMemo(() => {
    const needle = q.toLowerCase()
    const out: { head: HeadProgress; subs: SubHeadProgress[]; forceOpen: boolean }[] = []
    for (const head of sorted) {
      const byStatus = statusFilter ? head.subs.filter((s) => s.status === statusFilter) : head.subs
      if (byStatus.length === 0) continue
      if (!needle) {
        out.push({ head, subs: byStatus, forceOpen: statusFilter !== null })
        continue
      }
      const subHits = byStatus.filter((s) => s.name.toLowerCase().includes(needle))
      if (subHits.length > 0) out.push({ head, subs: subHits, forceOpen: true })
      else if (`${head.no} ${head.name}`.toLowerCase().includes(needle))
        out.push({ head, subs: byStatus, forceOpen: statusFilter !== null })
    }
    return out
  }, [sorted, q, statusFilter])

  const isOpen = (v: (typeof visible)[number]) => v.forceOpen || expanded.has(v.head.no)
  const allExpanded = visible.length > 0 && visible.every(isOpen)
  const filtering = q !== '' || statusFilter !== null

  return (
    <div className="kumbh-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      {/* Summary */}
      <div
        className="mt-3 flex flex-col gap-3 rounded-xl border p-3 @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:gap-4"
        style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
      >
        <div className="flex items-center gap-3 @min-[560px]:w-[240px] @min-[560px]:shrink-0">
          <ProgressRing fraction={data.fraction} label={formatPct(data.fraction)} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p
                className="text-[13.5px] font-bold leading-tight"
                style={{ color: 'var(--map-fg)' }}
              >
                Sector readiness
              </p>
              <DemoBadge />
            </div>
            <p
              className="mt-0.5 text-[11.5px] leading-snug tabular-nums"
              style={{ color: 'var(--map-fg-muted)' }}
            >
              {data.heads.length} main heads · {data.subHeadCount} sub-heads
            </p>
            <p className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
              Average of each head’s sub-heads
            </p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="flex h-[10px] w-full gap-px overflow-hidden rounded-full"
            style={{ backgroundColor: 'var(--map-switch-track)' }}
            aria-hidden="true"
          >
            {STATUS_ORDER.map((st) =>
              data.counts[st] > 0 ? (
                <span
                  key={st}
                  className="block h-full min-w-[3px]"
                  style={{
                    width: `${(data.counts[st] / data.subHeadCount) * 100}%`,
                    backgroundColor: statusColor(st, theme),
                    opacity: st === 'completed' ? 1 : 0.7,
                  }}
                />
              ) : null,
            )}
          </div>
          {/* The legend doubles as a filter: click a status to list only its sub-heads. */}
          <div className="mt-2 grid grid-cols-2 gap-1.5 @min-[400px]:grid-cols-4">
            {STATUS_ORDER.map((st) => {
              const active = statusFilter === st
              return (
                <button
                  key={st}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(active ? null : st)}
                  title={
                    active ? 'Show all sub-heads' : `Show only ${STATUS_LABEL[st].toLowerCase()}`
                  }
                  disabled={data.counts[st] === 0}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-1 text-left transition-colors hover:bg-[var(--map-surface-hover)] disabled:cursor-default disabled:opacity-50"
                  style={{
                    borderColor: active ? statusColor(st, theme) : 'var(--map-border)',
                    backgroundColor: active
                      ? `color-mix(in srgb, ${statusColor(st, theme)} 14%, transparent)`
                      : undefined,
                  }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: statusColor(st, theme) }}
                    aria-hidden="true"
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[11px]"
                    style={{ color: 'var(--map-fg-muted)' }}
                  >
                    {STATUS_LABEL[st]}
                  </span>
                  <span
                    className="shrink-0 text-[11px] font-bold tabular-nums"
                    style={{ color: 'var(--map-fg)' }}
                  >
                    {data.counts[st]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="-mx-4 mt-1 flex flex-wrap items-center gap-2 px-4 pb-2 pt-3 backdrop-blur-md @min-[560px]:sticky @min-[560px]:top-0 @min-[560px]:z-10"
        style={{
          backgroundColor: 'var(--map-panel-bg)',
          backgroundImage: 'linear-gradient(var(--map-panel-bg), var(--map-panel-bg))',
        }}
      >
        <span
          className="text-[11px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          Main heads · {filtering ? `${visible.length} of ${data.heads.length}` : data.heads.length}
        </span>
        <div className="relative order-last flex min-w-[180px] flex-1 basis-full items-center @min-[560px]:order-none @min-[560px]:max-w-[240px] @min-[560px]:basis-auto">
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
            placeholder="Search heads & sub-heads…"
            aria-label="Search main heads and sub-heads"
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
          <div
            role="group"
            aria-label="Sort main heads"
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
                  className="cursor-pointer whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold transition-colors"
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
          {visible.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  for (const v of visible) {
                    if (allExpanded) next.delete(v.head.no)
                    else next.add(v.head.no)
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

      <div className="grid grid-cols-1 items-start gap-2 @min-[720px]:grid-cols-2 @min-[1100px]:grid-cols-3">
        {visible.map((v, i) => (
          <HeadCard
            key={v.head.no}
            head={v.head}
            subs={v.subs}
            query={q}
            now={now}
            index={i}
            expanded={isOpen(v)}
            onToggle={() =>
              setExpanded((prev) => {
                const next = new Set(prev)
                // A forced-open card toggles off its underlying (hidden) state first.
                if (isOpen(v) && !next.has(v.head.no)) next.add(v.head.no)
                else if (next.has(v.head.no)) next.delete(v.head.no)
                else next.add(v.head.no)
                return next
              })
            }
          />
        ))}
      </div>
      {visible.length === 0 && (
        <div role="status" className="flex flex-col items-center gap-1.5 px-5 py-8 text-center">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--map-fg)' }}>
            No matching heads or sub-heads
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setStatusFilter(null)
            }}
            className="cursor-pointer text-[11.5px] font-semibold underline underline-offset-2"
            style={{ color: 'var(--map-accent)' }}
          >
            Clear search and filters
          </button>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
        Demo figures generated for illustration. Heads and sub-heads follow the Kumbh Mela 2027
        planning document; measurement per sub-head: Required → Planned → Completed → Balance.
      </p>
    </div>
  )
}
