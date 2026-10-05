'use client'

import { MapPin, Ticket } from 'lucide-react'
import type {
  ChatVisual,
  ProgressVisual,
  SectorRef,
  StatusCounts,
  TicketsVisual,
} from '@/lib/chat/visuals'
import type { WorkStatus } from '@/lib/workHeads/demo'
import { STATUS_ICON, STATUS_LABEL, STATUS_ORDER } from '@/lib/workHeads/ui'

// Donut / ring charts the assistant shows under its text. Colours come from the dashboard's
// work-head tokens (see globals.css); status is always icon + label as well, never colour alone.

const COLOR: Record<WorkStatus, string> = {
  completed: 'var(--dash-wh-completed)',
  'in-progress': 'var(--dash-wh-progress)',
  delayed: 'var(--dash-wh-delayed)',
  'not-started': 'var(--dash-wh-idle)',
}

const HI_LABEL: Record<WorkStatus, string> = {
  completed: 'पूर्ण',
  'in-progress': 'प्रगति पर',
  delayed: 'विलंबित',
  'not-started': 'शुरू नहीं',
}

const CARD =
  'rounded-2xl border border-[var(--border-strong)] bg-[var(--background-elevated)] p-3.5'
const TRACK = 'var(--dash-track)'

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
}

function sectorLabel(s: SectorRef) {
  return titleCase(s.name.replace(/-\d+$/, '').replace(/-/g, ' '))
}

function DemoPill() {
  return (
    <span
      className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-strong"
      title="Sample figures — no live work-progress data yet"
    >
      Demo
    </span>
  )
}

function StatusChip({ status }: { status: WorkStatus }) {
  const Icon = STATUS_ICON[status]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold"
      style={{
        color: COLOR[status],
        backgroundColor: `color-mix(in srgb, ${COLOR[status]} 16%, transparent)`,
      }}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {STATUS_LABEL[status]} / {HI_LABEL[status]}
    </span>
  )
}

type Segment = { value: number; color: string }

/** SVG donut: segments laid end to end around a ring, a small gap between them, `center` in the
 *  hole. A single segment is a progress ring (value vs. the grey track). */
function Donut({
  segments,
  size,
  thickness,
  center,
  label,
}: {
  segments: Segment[]
  size: number
  thickness: number
  center?: React.ReactNode
  label: string
}) {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const total = segments.reduce((n, s) => n + s.value, 0)
  const live = segments.filter((s) => s.value > 0)
  const gap = live.length > 1 ? Math.min(3, c / 60) : 0
  let offset = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TRACK}
          strokeWidth={thickness}
        />
        {total > 0 &&
          live.map((s, i) => {
            const len = Math.max(0, (s.value / total) * c - gap)
            const node = (
              <circle
                key={i}
                className="chat-arc"
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeLinecap="butt"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            )
            offset += (s.value / total) * c
            return node
          })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {center}
        </div>
      )}
    </div>
  )
}

function ProgressRing({
  percent,
  size,
  thickness,
  color = 'var(--dash-wh-progress)',
  big,
}: {
  percent: number
  size: number
  thickness: number
  color?: string
  big?: boolean
}) {
  return (
    <Donut
      size={size}
      thickness={thickness}
      label={`${percent}% complete`}
      segments={[
        { value: percent, color },
        { value: 100 - percent, color: 'transparent' },
      ]}
      center={
        <span
          className={`font-semibold leading-none text-foreground ${big ? 'text-3xl' : 'text-[13px]'}`}
        >
          {percent}
          <span className={big ? 'text-base text-muted-strong' : 'text-[10px] text-muted-strong'}>
            %
          </span>
        </span>
      }
    />
  )
}

function StatusDonut({ counts }: { counts: StatusCounts }) {
  const total = STATUS_ORDER.reduce((n, s) => n + counts[s], 0)
  return (
    <div className="flex items-center gap-4">
      <Donut
        size={132}
        thickness={20}
        label="Sub-heads by status"
        segments={STATUS_ORDER.map((s) => ({ value: counts[s], color: COLOR[s] }))}
        center={
          <>
            <span className="text-3xl font-semibold leading-none text-foreground">{total}</span>
            <span className="mt-1 text-[11px] leading-tight text-muted-strong">
              sub-heads
              <br />
              उप-कार्य
            </span>
          </>
        }
      />
      <ul className="min-w-0 flex-1 space-y-1.5">
        {STATUS_ORDER.map((s) => {
          const Icon = STATUS_ICON[s]
          return (
            <li key={s} className="flex items-center gap-2 text-[13px]">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: COLOR[s] }}
                aria-hidden
              />
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-strong" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {STATUS_LABEL[s]} / {HI_LABEL[s]}
              </span>
              <span className="font-semibold tabular-nums text-foreground">{counts[s]}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CardHeader({ sector, right }: { sector?: SectorRef; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <MapPin className="h-4 w-4 shrink-0 text-[var(--accent-strong)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-foreground">
          {sector ? `${sectorLabel(sector)} · Sector ${sector.no}` : 'All sectors / सभी सेक्टर'}
        </p>
        {sector?.zone && (
          <p className="truncate text-[12px] text-muted-strong">{titleCase(sector.zone)}</p>
        )}
      </div>
      {right}
    </div>
  )
}

function ProgressCard({ v }: { v: ProgressVisual }) {
  const focus = v.focus
  const headline = focus ? focus.percent : v.overallPercent
  const counts = focus ? focus.counts : v.counts

  return (
    <section className={CARD} aria-label={`Work progress, ${sectorLabel(v.sector)}`}>
      <CardHeader sector={v.sector} right={<DemoPill />} />

      {focus && (
        <p className="mb-3 line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
          <span className="mr-2 text-[12px] font-semibold uppercase tracking-wide text-muted-strong">
            Head {focus.no}
          </span>
          {focus.name}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 @min-[560px]:grid-cols-[auto_1fr] @min-[560px]:items-center">
        <div className="flex items-center gap-4 @min-[560px]:pr-4">
          <ProgressRing percent={headline} size={132} thickness={20} big />
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-strong">
              {focus ? 'Head progress' : 'Overall progress'}
            </p>
            <p className="text-[12px] text-muted-strong">{focus ? 'कार्य प्रगति' : 'कुल प्रगति'}</p>
          </div>
        </div>
        <StatusDonut counts={counts} />
      </div>

      {focus && (
        <ul className="mt-4 space-y-2.5">
          {[...focus.subs]
            .sort((a, b) => STATUS_ORDER.indexOf(b.status) - STATUS_ORDER.indexOf(a.status))
            .map((s) => (
              <li
                key={s.name}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <ProgressRing percent={s.percent} size={52} thickness={7} color={COLOR[s.status]} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                    <p className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-foreground">
                      {s.name}
                    </p>
                    <StatusChip status={s.status} />
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted-strong">
                    {s.completed} of {s.required} · balance {s.balance}
                  </p>
                  <p className="text-[12.5px] leading-snug text-muted-strong">
                    Target {s.targetDate} · {s.department}
                  </p>
                </div>
              </li>
            ))}
        </ul>
      )}

      <details className="group mt-4" open={!focus}>
        <summary className="cursor-pointer select-none text-[13px] font-semibold text-[var(--accent-strong)]">
          {focus ? 'All work heads / सभी कार्य शीर्ष' : 'Work heads / कार्य शीर्ष'}
        </summary>
        <ul className="mt-3 grid grid-cols-2 gap-2 @min-[560px]:grid-cols-3 @min-[820px]:grid-cols-4">
          {v.heads.map((h) => (
            <li
              key={h.no}
              className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5"
              title={h.name}
            >
              <ProgressRing
                percent={h.percent}
                size={46}
                thickness={6}
                color={h.counts.delayed > 0 ? COLOR.delayed : COLOR.completed}
              />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-strong">
                  Head {h.no}
                </p>
                <p className="line-clamp-2 text-[12.5px] leading-tight text-foreground">{h.name}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-muted-strong">
          <span
            className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
            style={{ backgroundColor: COLOR.delayed }}
            aria-hidden
          />
          Red ring: has delayed work / लाल: विलंबित कार्य
        </p>
      </details>
    </section>
  )
}

function TicketsCard({ v }: { v: TicketsVisual }) {
  return (
    <section className={CARD} aria-label="Tickets">
      <CardHeader
        sector={v.sector}
        right={
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--accent-strong)]">
            <Ticket className="h-3.5 w-3.5" aria-hidden />
            {v.total} {v.statusFilter === 'unresolved' ? 'open / खुले' : v.statusFilter}
          </span>
        }
      />
      {v.tickets.length === 0 ? (
        <p className="text-[14px] text-muted-strong">No matching tickets. / कोई टिकट नहीं मिला।</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {v.tickets.map((t) => (
            <li key={t.number} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="mt-0.5 shrink-0 rounded-md bg-[var(--overlay)] px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-muted-strong">
                #{t.number}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-snug text-foreground">{t.subject}</p>
                <p className="mt-0.5 text-[12.5px] text-muted-strong">
                  {t.status}
                  {t.priority ? ` · ${t.priority}` : ''}
                  {t.date ? ` · ${t.date}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ChatVisuals({ visuals }: { visuals: ChatVisual[] }) {
  if (visuals.length === 0) return null
  // Charts first, then the ticket list, whatever order the model happened to call the tools in.
  const ordered = [...visuals].sort(
    (a, b) => Number(a.type === 'tickets') - Number(b.type === 'tickets'),
  )
  return (
    <div className="mt-2.5 space-y-2.5">
      {ordered.map((v, i) =>
        v.type === 'progress' ? <ProgressCard key={i} v={v} /> : <TicketsCard key={i} v={v} />,
      )}
    </div>
  )
}
