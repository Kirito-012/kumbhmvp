'use client'

import Image from 'next/image'
import { Fragment, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarClock,
  ChevronRight,
  Circle,
  ClipboardList,
  Flag,
  Target,
  CheckCircle2,
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
import { HEAD_ICON, STATUS_ICON, STATUS_LABEL, STATUS_ORDER } from '@/lib/workHeads/ui'
import { buildSubHeadTickets, buildSubHeadTrend } from '@/lib/workHeads/subDetail'

// Main Heads / Sub-Heads view of the Work Done tab. Structure comes from the planning document
// (src/lib/workHeads/heads.ts); every figure is DEMO data (src/lib/workHeads/demo.ts) and is
// labelled as such wherever it appears.
//
// Built to be read at a glance by people in their 45-55s: each head is a progress ring plus a
// stacked status bar rather than a sentence of counts, every status has an icon as well as a colour
// (so it never rests on hue alone), and type is 13-15px instead of 11-12px.

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
            className="inline-flex items-center gap-1 rounded-full py-[3px] pl-1.5 pr-2 text-[12px] font-bold leading-none tabular-nums"
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
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 text-[12px] font-semibold leading-none"
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

function SubHeadRow({
  sub,
  query,
  now,
  onOpen,
}: {
  sub: SubHeadProgress
  query: string
  now: number
  onOpen: () => void
}) {
  const theme = useInsightTheme()
  const color = statusColor(sub.status, theme)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details: ${sub.name}`}
        className="dash-lift flex h-full w-full cursor-pointer flex-col gap-2 rounded-xl border px-3.5 py-3 text-left transition-colors hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
        style={{ borderColor: 'var(--map-border)' }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span
            className="min-w-0 flex-1 basis-48 text-[14px] font-semibold leading-snug"
            style={{ color: 'var(--map-fg)' }}
            title={sub.details ? `Includes: ${sub.details.join(' · ')}` : sub.name}
          >
            <Highlight text={sub.name} query={query} />
          </span>
          <StatusChip status={sub.status} now={now} target={sub.targetDate} />
        </div>

        <QuantityBar sub={sub} color={color} />

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <p className="text-[13px] tabular-nums" style={{ color: 'var(--map-fg)' }}>
            <strong className="text-[15px] font-bold">
              {formatQuantity(sub.completed, sub.unit)}
            </strong>
            <span style={{ color: 'var(--map-fg-muted)' }}>
              {' '}
              of {formatQuantity(sub.required, sub.unit)} · {formatPct(sub.fraction)}
            </span>
          </p>
          <p className="text-[12px] tabular-nums" style={{ color: 'var(--map-fg-muted)' }}>
            {formatQuantity(sub.balance, sub.unit)} left
          </p>
        </div>

        <p
          className="flex flex-wrap items-center gap-x-2 text-[12px] leading-snug"
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
        <span
          className="mt-0.5 inline-flex items-center gap-0.5 self-end text-[12px] font-semibold"
          style={{ color: 'var(--map-accent-fg)' }}
        >
          View details
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>
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
            className="line-clamp-2 text-[14px] font-bold leading-snug"
            style={{ color: 'var(--map-fg)' }}
            title={head.name}
          >
            <Highlight text={head.name} query={query} />
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--map-fg)' }}>
            {formatPct(head.fraction)}
          </span>
          {delayed > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full py-1 pl-1.5 pr-2 text-[12px] font-bold leading-none tabular-nums"
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
  onOpenSub,
}: {
  head: HeadProgress
  subs: SubHeadProgress[]
  query: string
  now: number
  onOpenSub: (sub: SubHeadProgress) => void
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
          labelClass="text-[22px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 flex h-7 min-w-[34px] shrink-0 items-center justify-center rounded-md px-1.5 text-[13px] font-bold tabular-nums"
              style={{ backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
            >
              {head.no}
            </span>
            <h4 className="text-[16px] font-bold leading-snug" style={{ color: 'var(--map-fg)' }}>
              <Highlight text={head.name} query={query} />
            </h4>
          </div>
          <p className="mt-1.5 text-[13px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
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
          className="px-4 pb-1 pt-3 text-[14px] font-bold @min-[560px]:px-5"
          style={{ color: 'var(--map-fg)' }}
        >
          Sub-heads{' '}
          <span style={{ color: 'var(--map-fg-muted)' }}>
            · {narrowed ? `${subs.length} of ${head.subs.length}` : head.subs.length}
          </span>
        </h5>
        <ul className="grid grid-cols-1 gap-3 p-3 @min-[700px]:grid-cols-2 @min-[560px]:p-4">
          {subs.map((sub) => (
            <SubHeadRow
              key={sub.name}
              sub={sub}
              query={query}
              now={now}
              onOpen={() => onOpenSub(sub)}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}

// Demo site photos (drone shots, resized to public/demo/site). Each sub-head starts on a different
// one so the gallery doesn't look identical everywhere; swap for real uploads when they exist.
const DEMO_PHOTOS = [
  '/demo/site/site-0954.jpg',
  '/demo/site/site-0952.jpg',
  '/demo/site/site-0948.jpg',
  '/demo/site/site-0946.jpg',
  '/demo/site/site-0944.jpg',
  '/demo/site/site-0943.jpg',
]
const MONTH_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short' })

function plainNumber(value: number, unit: SubHeadProgress['unit']) {
  const text = formatQuantity(value, unit)
  return text.slice(0, text.length - unit.length).trim()
}

function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`flex flex-col rounded-2xl border p-4 @min-[560px]:p-5 ${className}`}
      style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-[15px] font-bold" style={{ color: 'var(--map-fg)' }}>
          {title}
        </h4>
        {right}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center">{children}</div>
    </section>
  )
}

/** Cumulative planned (dashed) vs actual (solid) quantity, with a marker for today. */
function TrendChart({
  points,
  required,
  unit,
  now,
  color,
}: {
  points: ReturnType<typeof buildSubHeadTrend>
  required: number
  unit: SubHeadProgress['unit']
  now: number
  color: string
}) {
  const W = 560
  const H = 340
  const pad = { l: 52, r: 14, t: 18, b: 28 }
  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r)
  const yMax = Math.max(required, 1) * 1.05
  const y = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b)
  const line = (get: (p: (typeof points)[number]) => number | null) =>
    points
      .filter((p) => get(p) !== null)
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(get(p) as number).toFixed(1)}`)
      .join(' ')
  const ticks = [0, 0.5, 1].map((f) => f * required)
  const nowX = x(Math.min(Math.max(now, t0), t1))
  const labelEvery = Math.ceil(points.length / 6)
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Planned versus actual ${unit} over time; planned reaches ${formatQuantity(required, unit)}`}
    >
      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--map-border)"
            strokeDasharray={v === 0 ? undefined : '3 4'}
          />
          <text
            x={pad.l - 8}
            y={y(v) + 4}
            textAnchor="end"
            fontSize="12"
            fill="var(--map-fg-muted)"
          >
            {Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toFixed(1)}
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        i % labelEvery === 0 ? (
          <text
            key={p.t}
            x={x(p.t)}
            y={H - 8}
            textAnchor="middle"
            fontSize="12"
            fill="var(--map-fg-muted)"
          >
            {MONTH_FMT.format(p.t)}
          </text>
        ) : null,
      )}
      <path
        d={line((p) => p.planned)}
        fill="none"
        stroke="var(--map-fg-muted)"
        strokeWidth="2"
        strokeDasharray="6 5"
      />
      <path
        d={line((p) => p.actual)}
        fill="none"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1={nowX} x2={nowX} y1={pad.t} y2={H - pad.b} stroke="var(--map-fg)" opacity="0.5" />
      <text
        x={nowX}
        y={pad.t - 5}
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fill="var(--map-fg)"
      >
        Today
      </text>
    </svg>
  )
}

/** Full-width detail for one sub-head: the numbers, a completion donut, a progress trend, site
 *  photos and related tickets. Photos and tickets are placeholders / DEMO until there is a store. */
function SubHeadDetail({
  head,
  sub,
  sectorNo,
  now,
  onBack,
}: {
  head: HeadProgress
  sub: SubHeadProgress
  sectorNo: number
  now: number
  onBack: () => void
}) {
  const theme = useInsightTheme()
  const HeadIcon = HEAD_ICON[head.no] ?? Circle
  const seed = `${sectorNo}:${head.no}:${sub.name}`
  const [photo, setPhoto] = useState(0)
  const photos = useMemo(() => {
    const shift = [...sub.name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % DEMO_PHOTOS.length
    return [...DEMO_PHOTOS.slice(shift), ...DEMO_PHOTOS.slice(0, shift)]
  }, [sub.name])
  const trend = useMemo(() => buildSubHeadTrend(seed, sub, now), [seed, sub, now])
  const tickets = useMemo(() => buildSubHeadTickets(seed, 3), [seed])

  const planOnly = Math.max(0, sub.planned - sub.completed)
  const unplanned = Math.max(0, sub.required - Math.max(sub.planned, sub.completed))
  const daysToTarget = Math.round((sub.targetDate - now) / DAY_MS)
  const progressColor = statusColor('in-progress', theme)
  const doneColor = statusColor('completed', theme)

  // Pie: completed, then planned-but-not-done, with the remainder not planned yet.
  const size = 168
  const pieR = size / 2 - 2
  const required = Math.max(sub.required, 1)
  const segs = [
    { label: 'Completed', value: sub.completed, color: doneColor, opacity: 1 },
    { label: 'Planned, not done yet', value: planOnly, color: progressColor, opacity: 0.55 },
    { label: 'Not planned yet', value: unplanned, color: 'var(--map-switch-track)', opacity: 1 },
  ]
  const slices = segs.map((sg, i) => {
    const a0 = (segs.slice(0, i).reduce((acc, x) => acc + x.value, 0) / required) * 2 * Math.PI
    const a1 = a0 + (sg.value / required) * 2 * Math.PI
    const pt = (ang: number) =>
      `${(size / 2 + pieR * Math.sin(ang)).toFixed(2)} ${(size / 2 - pieR * Math.cos(ang)).toFixed(2)}`
    const whole = sg.value / required >= 0.9999
    const d = `M${size / 2} ${size / 2} L${pt(a0)} A${pieR} ${pieR} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)} Z`
    return { ...sg, d, whole }
  })

  // Where the plan says we should be today versus where we are.
  const plannedNow = [...trend].reverse().find((pt) => pt.actual !== null)?.planned ?? 0
  const gap = sub.completed - plannedNow
  const ahead = gap >= 0
  const gapColor = ahead ? doneColor : statusColor('delayed', theme)
  const GapIcon = ahead ? CheckCircle2 : AlertTriangle
  const pace = [
    { label: 'Planned by today', value: formatQuantity(plannedNow, sub.unit), color: undefined },
    { label: 'Actually done', value: formatQuantity(sub.completed, sub.unit), color: undefined },
    {
      label: ahead ? 'Ahead of plan' : 'Behind plan',
      value: formatQuantity(Math.abs(gap), sub.unit),
      color: gapColor,
    },
  ]

  const kpis = [
    { label: 'Required', value: sub.required, Icon: Target, tint: 'var(--map-accent)' },
    { label: 'Planned', value: sub.planned, Icon: ClipboardList, tint: progressColor },
    { label: 'Completed', value: sub.completed, Icon: CheckCircle2, tint: doneColor },
    { label: 'Balance', value: sub.balance, Icon: Flag, tint: statusColor('delayed', theme) },
  ]

  return (
    <div className="kumbh-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          autoFocus
          onClick={onBack}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3.5 text-[13px] font-semibold hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
          style={{ borderColor: 'var(--map-border)', color: 'var(--map-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to work heads
        </button>
        <p className="text-[13px]" style={{ color: 'var(--map-fg-muted)' }}>
          Head {head.no} · {head.name}
        </p>
      </div>

      <div className="@container mt-3 space-y-3">
        {/* Header */}
        <section
          className="flex flex-col gap-4 rounded-2xl border p-4 @min-[640px]:flex-row @min-[640px]:items-start @min-[640px]:p-5"
          style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
        >
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
            style={{ backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
            aria-hidden="true"
          >
            <HeadIcon className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 className="text-[18px] font-bold leading-snug" style={{ color: 'var(--map-fg)' }}>
                {sub.name}
              </h3>
              <StatusChip status={sub.status} now={now} target={sub.targetDate} />
              <DemoBadge />
            </div>
            <p className="mt-1.5 text-[13px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
              {head.purpose}
            </p>
            {sub.details && (
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {sub.details.map((d) => (
                  <li
                    key={d}
                    className="rounded-full border px-3 py-1 text-[12px]"
                    style={{ borderColor: 'var(--map-border)', color: 'var(--map-fg)' }}
                  >
                    {d}
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
              <div className="flex items-center gap-2" style={{ color: 'var(--map-fg)' }}>
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                <dt className="sr-only">Target date</dt>
                <dd>
                  Target {DATE_FMT.format(sub.targetDate)}
                  <span style={{ color: 'var(--map-fg-muted)' }}>
                    {' · '}
                    {sub.status === 'completed'
                      ? 'finished'
                      : daysToTarget >= 0
                        ? `${daysToTarget} days left`
                        : `${-daysToTarget} days late`}
                  </span>
                </dd>
              </div>
              <div className="flex items-center gap-2" style={{ color: 'var(--map-fg)' }}>
                <Building2 className="h-4 w-4" aria-hidden="true" />
                <dt className="sr-only">Department</dt>
                <dd>{sub.department}</dd>
              </div>
              {sub.completed > 0 && (
                <div
                  className="flex items-center gap-2 font-semibold"
                  style={{ color: sub.verified ? doneColor : 'var(--map-fg-muted)' }}
                >
                  <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                  <dt className="sr-only">Verification</dt>
                  <dd>{sub.verified ? 'Verified' : 'Awaiting verification'}</dd>
                </div>
              )}
            </dl>
          </div>
        </section>

        {/* The four numbers */}
        <div className="grid grid-cols-2 gap-3 @min-[640px]:grid-cols-4">
          {kpis.map(({ label, value, Icon, tint }, i) => (
            <div
              key={label}
              className="dash-lift row-rise rounded-xl border p-3.5"
              style={{
                ['--i' as string]: i,
                borderColor: 'var(--map-border)',
                backgroundColor: 'var(--map-surface-alt)',
              }}
            >
              <span
                className="flex items-center gap-2 text-[13px] font-semibold"
                style={{ color: 'var(--map-fg-muted)' }}
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${tint} 18%, transparent)`,
                    color: tint,
                  }}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {label}
              </span>
              <p
                className="mt-2 text-[22px] font-bold leading-none tabular-nums"
                style={{ color: 'var(--map-fg)' }}
              >
                {plainNumber(value, sub.unit)}
                <span
                  className="ml-1.5 whitespace-nowrap text-[13px] font-semibold"
                  style={{ color: 'var(--map-fg-muted)' }}
                >
                  {sub.unit}
                </span>
              </p>
            </div>
          ))}
        </div>

        {/* Equal columns, aligned rows: the trend beside the photos, the pie beside the tickets. */}
        <div className="grid grid-cols-1 gap-3 @min-[900px]:grid-cols-2">
          <Panel
            title="Progress over time"
            right={
              <span
                className="flex items-center gap-4 text-[12px]"
                style={{ color: 'var(--map-fg)' }}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-0 w-5 border-t-2 border-dashed"
                    style={{ borderColor: 'var(--map-fg-muted)' }}
                    aria-hidden="true"
                  />
                  Planned
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-1 w-5 rounded-full"
                    style={{ backgroundColor: progressColor }}
                    aria-hidden="true"
                  />
                  Actual
                </span>
              </span>
            }
          >
            <TrendChart
              points={trend}
              required={sub.required}
              unit={sub.unit}
              now={now}
              color={progressColor}
            />
            <dl className="mt-3 grid grid-cols-3 gap-2.5">
              {pace.map((x, i) => (
                <div
                  key={x.label}
                  className="rounded-lg border px-3 py-2.5"
                  style={{ borderColor: 'var(--map-border)' }}
                >
                  <dt
                    className="flex items-center gap-1.5 text-[12px]"
                    style={{ color: 'var(--map-fg-muted)' }}
                  >
                    {i === 2 && (
                      <GapIcon className="h-4 w-4" style={{ color: gapColor }} aria-hidden="true" />
                    )}
                    {x.label}
                  </dt>
                  <dd
                    className="mt-0.5 text-[15px] font-bold tabular-nums"
                    style={{ color: x.color ?? 'var(--map-fg)' }}
                  >
                    {x.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title={`Site photos · ${photos.length}`} right={<DemoBadge />}>
            <div
              className="relative aspect-[16/9] w-full overflow-hidden rounded-xl"
              style={{ backgroundColor: 'var(--map-surface-hover)' }}
            >
              <Image
                key={photos[photo]}
                src={photos[photo]}
                alt={`Site photo ${photo + 1} of ${photos.length} for ${sub.name} (demo)`}
                fill
                sizes="(min-width: 900px) 40vw, 90vw"
                className="object-cover"
              />
              <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-[12px] text-white">
                Photo {photo + 1} of {photos.length}
              </p>
            </div>
            <ul className="mt-2.5 grid grid-cols-6 gap-2">
              {photos.map((src, i) => (
                <li key={src}>
                  <button
                    type="button"
                    onClick={() => setPhoto(i)}
                    aria-label={`Show photo ${i + 1}`}
                    aria-pressed={photo === i}
                    className="relative block aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-lg border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]"
                    style={{
                      borderColor: photo === i ? 'var(--map-accent)' : 'transparent',
                      opacity: photo === i ? 1 : 0.7,
                    }}
                  >
                    <Image src={src} alt="" fill sizes="96px" className="object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel
            title="Completion"
            right={
              <span
                className="text-[14px] font-bold tabular-nums"
                style={{ color: 'var(--map-fg)' }}
              >
                {formatPct(sub.fraction)} complete
              </span>
            }
          >
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
              <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                className="shrink-0"
                role="img"
                aria-label={`${formatPct(sub.fraction)} complete`}
              >
                {slices.map((sl) =>
                  sl.value <= 0 ? null : sl.whole ? (
                    <circle
                      key={sl.label}
                      cx={size / 2}
                      cy={size / 2}
                      r={pieR}
                      fill={sl.color}
                      opacity={sl.opacity}
                    />
                  ) : (
                    <path
                      key={sl.label}
                      d={sl.d}
                      fill={sl.color}
                      opacity={sl.opacity}
                      stroke="var(--map-surface-alt)"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  ),
                )}
              </svg>
              <ul className="space-y-2.5 text-[13px]" style={{ color: 'var(--map-fg)' }}>
                {segs.map((sg) => (
                  <li key={sg.label} className="flex items-center gap-2.5">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full"
                      style={{ backgroundColor: sg.color, opacity: sg.opacity }}
                      aria-hidden="true"
                    />
                    <span>
                      {sg.label}
                      <span
                        className="block text-[12px] tabular-nums"
                        style={{ color: 'var(--map-fg-muted)' }}
                      >
                        {formatQuantity(sg.value, sub.unit)} · {formatPct(sg.value / required)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
          <Panel title="Recent tickets" right={<DemoBadge />}>
            <ul className="divide-y divide-[var(--map-border)]">
              {tickets.map((tk) => {
                const st: WorkStatus =
                  tk.status === 'Resolved'
                    ? 'completed'
                    : tk.status === 'Open'
                      ? 'delayed'
                      : 'in-progress'
                const Icon = STATUS_ICON[st]
                const c = statusColor(st, theme)
                return (
                  <li
                    key={tk.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-[13px]"
                  >
                    <span
                      className="w-16 shrink-0 font-semibold tabular-nums"
                      style={{ color: 'var(--map-fg-muted)' }}
                    >
                      {tk.id}
                    </span>
                    <span
                      className="min-w-0 flex-1 basis-40 font-medium"
                      style={{ color: 'var(--map-fg)' }}
                    >
                      {tk.title}
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 text-[12px] font-semibold"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${c} 16%, transparent)`,
                        color: 'var(--map-fg)',
                      }}
                    >
                      <Icon className="h-4 w-4" style={{ color: c }} aria-hidden="true" />
                      {tk.status}
                    </span>
                    <span
                      className="w-24 shrink-0 text-right text-[12px]"
                      style={{ color: 'var(--map-fg-muted)' }}
                    >
                      {tk.updated}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}

export default function SectorWorkHeads({ sectorNo }: { sectorNo: number }) {
  // Captured once so "overdue" doesn't tick mid-session and demo targets stay put.
  const [now] = useState(() => Date.now())
  const data = useMemo(() => buildSectorWorkHeads(sectorNo, now), [sectorNo, now])

  const [query, setQuery] = useState('')
  const q = query.trim()
  const [sortKey, setSortKey] = useState<SortKey>('no')
  const [pick, setPick] = useState<string | null>(null)
  const [openSub, setOpenSub] = useState<{ headNo: string; subName: string } | null>(null)

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
      const byStatus = head.subs
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
  }, [sorted, q])

  // The head shown on the right: the one picked, else the first that survives search/filters.
  const selected = visible.find((v) => v.head.no === pick) ?? visible[0] ?? null
  const filtering = q !== ''

  const openHead = openSub ? data.heads.find((h) => h.no === openSub.headNo) : undefined
  const openSubHead = openHead?.subs.find((x) => x.name === openSub?.subName)
  if (openHead && openSubHead) {
    return (
      <SubHeadDetail
        head={openHead}
        sub={openSubHead}
        sectorNo={sectorNo}
        now={now}
        onBack={() => setOpenSub(null)}
      />
    )
  }

  return (
    <div className="kumbh-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 pt-3">
        <h3 className="text-[15px] font-bold" style={{ color: 'var(--map-fg)' }}>
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
            className="h-10 w-full rounded-lg border py-1 pl-9 pr-9 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)] [&::-webkit-search-cancel-button]:hidden"
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
          <span className="text-[12px] font-semibold" style={{ color: 'var(--map-fg-muted)' }}>
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
                  className="h-9 cursor-pointer whitespace-nowrap rounded-md px-3 text-[13px] font-semibold transition-colors"
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
                      <HeadDetail
                        head={v.head}
                        subs={v.subs}
                        query={q}
                        now={now}
                        onOpenSub={(sub) => setOpenSub({ headNo: v.head.no, subName: sub.name })}
                      />
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
                onOpenSub={(sub) => setOpenSub({ headNo: selected.head.no, subName: sub.name })}
              />
            </div>
          )}
        </div>
      )}
      {visible.length === 0 && (
        <div role="status" className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <p className="text-[15px] font-semibold" style={{ color: 'var(--map-fg)' }}>
            No matching heads or sub-heads
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('')
            }}
            className="cursor-pointer text-[13px] font-semibold underline underline-offset-2"
            style={{ color: 'var(--map-accent)' }}
          >
            Clear search
          </button>
        </div>
      )}
      <p className="mt-4 text-[12px] leading-snug" style={{ color: 'var(--map-fg-muted)' }}>
        <DemoBadge className="mr-1.5 align-middle" />
        Figures are generated for illustration. Heads and sub-heads follow the Kumbh Mela 2027
        planning document; each sub-head is measured Required → Planned → Completed → Balance.
      </p>
    </div>
  )
}
