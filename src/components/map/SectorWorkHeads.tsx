'use client'

import { Fragment, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  Car,
  CheckCircle2,
  Circle,
  Droplets,
  Flame,
  HeartPulse,
  Hourglass,
  LifeBuoy,
  type LucideIcon,
  Radio,
  Route,
  Shovel,
  ShieldCheck,
  Tent,
  Trash2,
  Users,
  Waves,
  Zap,
} from 'lucide-react'
import { SearchIcon, XIcon } from '@/components/map/icons'
import { Highlight } from '@/components/map/SectorWorkDone'
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
//
// Built to be read at a glance by people in their 45-55s: each head is a progress ring plus a
// stacked status bar rather than a sentence of counts, every status has an icon as well as a colour
// (so it never rests on hue alone), and type is 13-15px instead of 11-12px.

const STATUS_ORDER: WorkStatus[] = ['completed', 'in-progress', 'delayed', 'not-started']
const STATUS_LABEL: Record<WorkStatus, string> = {
  completed: 'Completed',
  'in-progress': 'In progress',
  delayed: 'Delayed',
  'not-started': 'Not started',
}
const STATUS_ICON: Record<WorkStatus, LucideIcon> = {
  completed: CheckCircle2,
  'in-progress': Hourglass,
  delayed: AlertTriangle,
  'not-started': Circle,
}

/** One icon per main head (keyed by head number in the planning document), so the list can be
 *  recognised by shape rather than read line by line. Unknown numbers fall back to a neutral dot. */
const HEAD_ICON: Record<string, LucideIcon> = {
  '01': Shovel,
  '02': Route,
  '03': Droplets,
  '04': Waves,
  '05': Zap,
  '06': Tent,
  '07': Trash2,
  '08': Flame,
  '09': HeartPulse,
  '10': ShieldCheck,
  '11': Car,
  '12': LifeBuoy,
  '13': Users,
  '14': Radio,
}

/** Green / blue / red / grey: every adjacent pair stays apart under colour-blind simulation (checked
 *  with the dataviz palette validator). The grey is deliberately neutral — "not started" is the
 *  absence of progress, not a state to draw the eye. */
function statusColor(status: WorkStatus, theme: 'light' | 'dark') {
  switch (status) {
    case 'completed':
      return BUCKET_COLORS.resolved[theme]
    case 'in-progress':
      return theme === 'dark' ? '#38bdf8' : '#0284c7'
    case 'delayed':
      return theme === 'dark' ? '#f87171' : '#dc2626'
    case 'not-started':
      return theme === 'dark' ? '#94a3b8' : '#64748b'
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

/** Progress ring with the percentage in the middle. The sweep is a CSS keyframe (`.dash-ring`), so
 *  it plays on mount and is skipped entirely under reduced-motion. */
function WorkRing({
  fraction,
  size,
  stroke,
  color,
  labelClass,
}: {
  fraction: number
  size: number
  stroke: number
  color: string
  labelClass: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="var(--map-switch-track)"
          opacity={0.6}
        />
        {fraction > 0 && (
          <circle
            className="dash-ring"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke={color}
            strokeDasharray={`${Math.max(fraction, 0.015) * c} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ ['--ring-c' as string]: c }}
          />
        )}
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-bold tabular-nums ${labelClass}`}
        style={{ color: 'var(--map-fg)' }}
      >
        {formatPct(fraction)}
      </span>
    </div>
  )
}

/** One bar split into the four statuses, so a head's whole state reads as a shape. */
function StatusBar({
  counts,
  total,
  height,
  theme,
}: {
  counts: Record<WorkStatus, number>
  total: number
  height: number
  theme: 'light' | 'dark'
}) {
  return (
    <div
      className="flex w-full gap-0.5 overflow-hidden rounded-full"
      style={{ height }}
      aria-hidden="true"
    >
      {STATUS_ORDER.map((st, i) =>
        counts[st] > 0 ? (
          <span
            key={st}
            className="dash-grow-x block h-full min-w-[4px]"
            style={{
              ['--i' as string]: i,
              flexGrow: counts[st] / Math.max(total, 1),
              flexBasis: 0,
              backgroundColor: statusColor(st, theme),
            }}
          />
        ) : null,
      )}
    </div>
  )
}

/** Icon + number per non-empty status. The icon is the second channel next to the colour. */
function CountChips({
  counts,
  theme,
  className = '',
}: {
  counts: Record<WorkStatus, number>
  theme: 'light' | 'dark'
  className?: string
}) {
  const label = STATUS_ORDER.filter((st) => counts[st] > 0)
    .map((st) => `${counts[st]} ${STATUS_LABEL[st].toLowerCase()}`)
    .join(', ')
  return (
    <span
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
      role="img"
      aria-label={label}
    >
      {STATUS_ORDER.map((st) => {
        if (counts[st] === 0) return null
        const Icon = STATUS_ICON[st]
        const color = statusColor(st, theme)
        return (
          <span
            key={st}
            title={`${counts[st]} ${STATUS_LABEL[st].toLowerCase()}`}
            className="inline-flex items-center gap-1 rounded-full py-[3px] pl-1.5 pr-2 text-[13px] font-bold leading-none tabular-nums"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
              color: 'var(--map-fg)',
            }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden="true" />
            {counts[st]}
          </span>
        )
      })}
    </span>
  )
}

function StatusChip({ status, now, target }: { status: WorkStatus; now: number; target: number }) {
  const theme = useInsightTheme()
  const color = statusColor(status, theme)
  const Icon = STATUS_ICON[status]
  const overdueDays = status === 'delayed' ? Math.max(1, Math.round((now - target) / DAY_MS)) : 0
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 text-[13px] font-semibold leading-none"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        color: 'var(--map-fg)',
      }}
    >
      <Icon className="h-4 w-4" style={{ color }} aria-hidden="true" />
      {STATUS_LABEL[status]}
      {overdueDays > 0 && ` · ${overdueDays}d late`}
    </span>
  )
}

/** Quantity bar: the track is the amount required, the solid fill what is completed, and the paler
 *  fill the part that is planned but not yet done. */
function QuantityBar({ sub, color }: { sub: SubHeadProgress; color: string }) {
  const pct = (v: number) => `${Math.min(100, (v / Math.max(sub.required, 1)) * 100)}%`
  return (
    <div
      className="relative h-3 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: 'var(--map-switch-track)' }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: pct(Math.max(sub.planned, sub.completed)),
          backgroundColor: color,
          opacity: 0.3,
        }}
      />
      <div
        className="dash-grow-x absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${Math.max(sub.completed > 0 ? 1.5 : 0, (sub.completed / Math.max(sub.required, 1)) * 100)}%`,
          backgroundColor: color,
        }}
      />
    </div>
  )
}

function SubHeadRow({ sub, query, now }: { sub: SubHeadProgress; query: string; now: number }) {
  const theme = useInsightTheme()
  const color = statusColor(sub.status, theme)
  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className="min-w-0 flex-1 basis-48 text-[15px] font-semibold leading-snug"
          style={{ color: 'var(--map-fg)' }}
          title={sub.details ? `Includes: ${sub.details.join(' · ')}` : sub.name}
        >
          <Highlight text={sub.name} query={query} />
        </span>
        <StatusChip status={sub.status} now={now} target={sub.targetDate} />
      </div>

      <QuantityBar sub={sub} color={color} />

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <p className="text-[14px] tabular-nums" style={{ color: 'var(--map-fg)' }}>
          <strong className="text-[16px] font-bold">
            {formatQuantity(sub.completed, sub.unit)}
          </strong>
          <span style={{ color: 'var(--map-fg-muted)' }}>
            {' '}
            of {formatQuantity(sub.required, sub.unit)} · {formatPct(sub.fraction)}
          </span>
        </p>
        <p className="text-[13px] tabular-nums" style={{ color: 'var(--map-fg-muted)' }}>
          {formatQuantity(sub.balance, sub.unit)} left
        </p>
      </div>

      <p
        className="flex flex-wrap items-center gap-x-2 text-[13px] leading-snug"
        style={{ color: 'var(--map-fg-muted)' }}
      >
        <span>Target {DATE_FMT.format(sub.targetDate)}</span>
        <span aria-hidden="true">·</span>
        <span>{sub.department}</span>
        {sub.completed > 0 && (
          <span
            className="inline-flex items-center gap-1 font-semibold"
            style={{
              color: sub.verified ? statusColor('completed', theme) : 'var(--map-fg-muted)',
            }}
          >
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            {sub.verified ? 'Verified' : 'Awaiting verification'}
          </span>
        )}
      </p>
    </li>
  )
}

/** One line of the left-hand list: the head's icon, its name, the percentage as plain text, and a
 *  red badge if anything is late. The graphics (ring, status bar) live in the detail pane. */
function HeadRow({
  head,
  selected,
  onSelect,
  query,
  index,
}: {
  head: HeadProgress
  selected: boolean
  onSelect: () => void
  query: string
  index: number
}) {
  const theme = useInsightTheme()
  const delayed = head.counts.delayed
  const HeadIcon = HEAD_ICON[head.no] ?? Circle
  return (
    <li
      className="motion-safe:animate-[fade-in_300ms_ease-out_backwards]"
      style={{ animationDelay: `${Math.min(index, 14) * 30}ms` }}
    >
      <button
        type="button"
        data-head-row
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
        style={{
          borderColor: selected ? 'var(--map-accent)' : 'transparent',
          backgroundColor: selected ? 'var(--map-accent-bg)' : undefined,
        }}
      >
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={{
            backgroundColor: selected ? 'var(--map-accent)' : 'var(--map-accent-bg)',
            color: selected ? 'var(--map-accent-on-fg)' : 'var(--map-accent-fg)',
          }}
          aria-hidden="true"
        >
          <HeadIcon className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block text-[12px] font-bold tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            Head {head.no}
          </span>
          <span
            className="line-clamp-2 text-[15px] font-bold leading-snug"
            style={{ color: 'var(--map-fg)' }}
            title={head.name}
          >
            <Highlight text={head.name} query={query} />
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--map-fg)' }}>
            {formatPct(head.fraction)}
          </span>
          {delayed > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full py-1 pl-1.5 pr-2 text-[13px] font-bold leading-none tabular-nums"
              style={{
                backgroundColor: `color-mix(in srgb, ${statusColor('delayed', theme)} 18%, transparent)`,
                color: 'var(--map-fg)',
              }}
              title={`${delayed} delayed`}
            >
              <AlertTriangle
                className="h-3.5 w-3.5"
                style={{ color: statusColor('delayed', theme) }}
                aria-hidden="true"
              />
              {delayed}
              <span className="sr-only"> delayed</span>
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/** The right-hand pane: the selected head in full, then every one of its sub-heads. */
function HeadDetail({
  head,
  subs,
  query,
  now,
}: {
  head: HeadProgress
  subs: SubHeadProgress[]
  query: string
  now: number
}) {
  const theme = useInsightTheme()
  const ringColor =
    head.fraction >= 1 ? statusColor('completed', theme) : statusColor('in-progress', theme)
  const narrowed = subs.length !== head.subs.length
  return (
    <section
      aria-label={`Head ${head.no}: ${head.name}`}
      className="overflow-hidden rounded-2xl border"
      style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
    >
      <div className="flex flex-col gap-4 p-4 @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:gap-5 @min-[560px]:p-5">
        <WorkRing
          fraction={head.fraction}
          size={104}
          stroke={11}
          color={ringColor}
          labelClass="text-[26px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 flex h-7 min-w-[34px] shrink-0 items-center justify-center rounded-md px-1.5 text-[14px] font-bold tabular-nums"
              style={{ backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
            >
              {head.no}
            </span>
            <h4 className="text-[19px] font-bold leading-snug" style={{ color: 'var(--map-fg)' }}>
              <Highlight text={head.name} query={query} />
            </h4>
          </div>
          <p className="mt-1.5 text-[14px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
            {head.purpose}
          </p>
          <div className="mt-3">
            <StatusBar counts={head.counts} total={head.subs.length} height={14} theme={theme} />
          </div>
          <CountChips counts={head.counts} theme={theme} className="mt-2.5" />
        </div>
      </div>

      <div className="border-t" style={{ borderColor: 'var(--map-border)' }}>
        <h5
          className="px-4 pb-1 pt-3 text-[15px] font-bold @min-[560px]:px-5"
          style={{ color: 'var(--map-fg)' }}
        >
          Sub-heads{' '}
          <span style={{ color: 'var(--map-fg-muted)' }}>
            · {narrowed ? `${subs.length} of ${head.subs.length}` : head.subs.length}
          </span>
        </h5>
        <ul className="flex flex-col divide-y divide-[var(--map-border)]">
          {subs.map((sub) => (
            <SubHeadRow key={sub.name} sub={sub} query={query} now={now} />
          ))}
        </ul>
      </div>
    </section>
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
  const [pick, setPick] = useState<string | null>(null)

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

  // Search matches head number/name and sub-head names; the status tiles narrow sub-heads to one
  // status. Either one narrowing a card's sub-heads also opens it, so the hits are visible without
  // a click. A head-name hit alone keeps the card as it was.
  const visible = useMemo(() => {
    const needle = q.toLowerCase()
    const out: { head: HeadProgress; subs: SubHeadProgress[] }[] = []
    for (const head of sorted) {
      const byStatus = statusFilter ? head.subs.filter((s) => s.status === statusFilter) : head.subs
      if (byStatus.length === 0) continue
      if (!needle) {
        out.push({ head, subs: byStatus })
        continue
      }
      const subHits = byStatus.filter((s) => s.name.toLowerCase().includes(needle))
      if (subHits.length > 0) out.push({ head, subs: subHits })
      else if (`${head.no} ${head.name}`.toLowerCase().includes(needle))
        out.push({ head, subs: byStatus })
    }
    return out
  }, [sorted, q, statusFilter])

  // The head shown on the right: the one picked, else the first that survives search/filters.
  const selected = visible.find((v) => v.head.no === pick) ?? visible[0] ?? null
  const filtering = q !== '' || statusFilter !== null

  return (
    <div className="kumbh-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-5">
      {/* Summary: the readiness ring, one bar for every sub-head, and four big status tiles that
          double as filters. */}
      <div
        className="mt-3 rounded-2xl border p-4 @min-[640px]:p-5"
        style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
      >
        <div className="flex flex-col gap-5 @min-[640px]:flex-row @min-[640px]:items-center @min-[640px]:gap-7">
          <div className="flex items-center gap-4 @min-[640px]:shrink-0">
            <WorkRing
              fraction={data.fraction}
              size={132}
              stroke={13}
              color={statusColor('completed', theme)}
              labelClass="text-[34px]"
            />
            <div className="max-w-[14rem]">
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className="text-[18px] font-bold leading-tight"
                  style={{ color: 'var(--map-fg)' }}
                >
                  Sector readiness
                </p>
                <DemoBadge />
              </div>
              <p
                className="mt-1.5 text-[14px] leading-snug"
                style={{ color: 'var(--map-fg-muted)' }}
              >
                {data.heads.length} main heads
                <br />
                {data.subHeadCount} sub-heads
              </p>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[15px] font-semibold" style={{ color: 'var(--map-fg)' }}>
              All {data.subHeadCount} sub-heads at a glance
            </p>
            <StatusBar counts={data.counts} total={data.subHeadCount} height={18} theme={theme} />
          </div>
        </div>

        {/* The legend doubles as a filter: press a status to list only its sub-heads. */}
        <div className="mt-5 grid grid-cols-2 gap-3 @min-[640px]:grid-cols-4">
          {STATUS_ORDER.map((st, i) => {
            const active = statusFilter === st
            const color = statusColor(st, theme)
            const Icon = STATUS_ICON[st]
            const share = data.subHeadCount > 0 ? data.counts[st] / data.subHeadCount : 0
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
                className="dash-lift flex cursor-pointer flex-col gap-2 rounded-xl border-2 px-3.5 py-3 text-left hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)] disabled:cursor-default disabled:opacity-50"
                style={{
                  borderColor: active ? color : 'var(--map-border)',
                  backgroundColor: active
                    ? `color-mix(in srgb, ${color} 14%, transparent)`
                    : undefined,
                }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)` }}
                  >
                    <Icon className="h-5 w-5" style={{ color }} aria-hidden="true" />
                  </span>
                  <span
                    className="text-[34px] font-bold leading-none tabular-nums"
                    style={{ color: 'var(--map-fg)' }}
                  >
                    {data.counts[st]}
                  </span>
                </span>
                <span
                  className="text-[15px] font-semibold leading-tight"
                  style={{ color: 'var(--map-fg)' }}
                >
                  {STATUS_LABEL[st]}
                </span>
                <span
                  className="h-1.5 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: 'var(--map-switch-track)' }}
                  aria-hidden="true"
                >
                  <span
                    className="dash-grow-x block h-full rounded-full"
                    style={{
                      ['--i' as string]: i,
                      width: `${Math.max(share > 0 ? 3 : 0, share * 100)}%`,
                      backgroundColor: color,
                    }}
                  />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 pt-2">
        <h3 className="text-[16px] font-bold" style={{ color: 'var(--map-fg)' }}>
          Main heads{' '}
          <span style={{ color: 'var(--map-fg-muted)' }}>
            · {filtering ? `${visible.length} of ${data.heads.length}` : data.heads.length}
          </span>
        </h3>
        <div className="relative order-last flex min-w-[200px] flex-1 basis-full items-center @min-[640px]:order-none @min-[640px]:max-w-[280px] @min-[640px]:basis-auto">
          <SearchIcon className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--map-fg-muted)]" />
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
            className="h-10 w-full rounded-lg border py-1 pl-9 pr-9 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)] [&::-webkit-search-cancel-button]:hidden"
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
              className="absolute right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[var(--map-fg-muted)] hover:bg-[var(--map-surface-hover)]"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--map-fg-muted)' }}>
            Sort by
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
                  className="h-9 cursor-pointer whitespace-nowrap rounded-md px-3 text-[14px] font-semibold transition-colors"
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
        </div>
      </div>

      {visible.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-4 @min-[760px]:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          {/* Left: every head. On a narrow window the selected head's detail opens right under it. */}
          <ul
            aria-label="Main heads"
            className="kumbh-scroll flex flex-col gap-1 @min-[760px]:max-h-[min(74vh,780px)] @min-[760px]:overflow-y-auto @min-[760px]:pr-1"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
              const i = visible.findIndex((v) => v.head.no === selected?.head.no)
              const next = visible[i + (e.key === 'ArrowDown' ? 1 : -1)]
              if (!next) return
              e.preventDefault()
              setPick(next.head.no)
              const rows = e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-head-row]')
              rows[visible.indexOf(next)]?.focus()
            }}
          >
            {visible.map((v, i) => {
              const isSel = v.head.no === selected?.head.no
              return (
                <Fragment key={v.head.no}>
                  <HeadRow
                    head={v.head}
                    selected={isSel}
                    onSelect={() => setPick(v.head.no)}
                    query={q}
                    index={i}
                  />
                  {isSel && (
                    <li className="@min-[760px]:hidden">
                      <HeadDetail head={v.head} subs={v.subs} query={q} now={now} />
                    </li>
                  )}
                </Fragment>
              )
            })}
          </ul>

          {/* Right: the selected head's full detail and sub-heads. */}
          {selected && (
            <div className="kumbh-scroll hidden @min-[760px]:block @min-[760px]:max-h-[min(74vh,780px)] @min-[760px]:overflow-y-auto">
              <HeadDetail
                key={selected.head.no}
                head={selected.head}
                subs={selected.subs}
                query={q}
                now={now}
              />
            </div>
          )}
        </div>
      )}
      {visible.length === 0 && (
        <div role="status" className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <p className="text-[16px] font-semibold" style={{ color: 'var(--map-fg)' }}>
            No matching heads or sub-heads
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setStatusFilter(null)
            }}
            className="cursor-pointer text-[14px] font-semibold underline underline-offset-2"
            style={{ color: 'var(--map-accent)' }}
          >
            Clear search and filters
          </button>
        </div>
      )}
      <p className="mt-4 text-[13px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
        <DemoBadge className="mr-1.5 align-middle" />
        Figures are generated for illustration. Heads and sub-heads follow the Kumbh Mela 2027
        planning document; each sub-head is measured Required → Planned → Completed → Balance.
      </p>
    </div>
  )
}
