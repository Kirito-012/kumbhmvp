import { AlertTriangle, Circle, LayoutGrid } from 'lucide-react'
import type { WorkStatus } from '@/lib/workHeads/demo'
import type { HeadOverview, WorkHeadsOverview as Overview } from '@/lib/workHeads/overview'
import { HEAD_ICON, STATUS_ICON, STATUS_LABEL, STATUS_ORDER } from '@/lib/workHeads/ui'
import { CountUp } from './CountUp'
import { ExpandableGrid } from './ExpandableGrid'

// DEMO DATA -- see src/lib/workHeads/demo.ts. Everything on these panels is labelled "Demo".

/** CSS colour per work status (theme-aware tokens in globals.css). */
export const WH_COLOR: Record<WorkStatus, string> = {
  completed: 'var(--dash-wh-completed)',
  'in-progress': 'var(--dash-wh-progress)',
  delayed: 'var(--dash-wh-delayed)',
  'not-started': 'var(--dash-wh-idle)',
}

export function DemoPill() {
  return (
    <span
      className="rounded-full border border-[var(--dash-card-border)] px-2.5 py-0.5 text-[13px] font-semibold uppercase tracking-wide text-muted-strong"
      title="Sample figures — no live work-progress data yet"
    >
      Demo
    </span>
  )
}

/** One thin stacked bar: how a head's tasks divide across the four statuses. The 2px flex gap, not
 *  a border, separates the segments. */
export function StatusSplitBar({
  counts,
  className = 'h-3',
}: {
  counts: Record<WorkStatus, number>
  className?: string
}) {
  return (
    <div className={`flex gap-0.5 overflow-hidden rounded-full ${className}`} aria-hidden>
      {STATUS_ORDER.filter((st) => counts[st] > 0).map((st, i) => (
        <div
          key={st}
          className="dash-grow-x"
          style={{
            ['--i' as string]: i,
            flexGrow: counts[st],
            flexBasis: 0,
            minWidth: 4,
            backgroundColor: WH_COLOR[st],
          }}
        />
      ))}
    </div>
  )
}

function HeadTile({ head, index }: { head: HeadOverview; index: number }) {
  const Icon = HEAD_ICON[head.no] ?? Circle
  const pct = Math.round(head.fraction * 100)
  const done = head.counts.completed
  return (
    <li
      className="dash-lift row-rise flex flex-col rounded-xl border border-[var(--dash-card-border)] p-4"
      style={{ ['--i' as string]: index }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{
            color: 'var(--dash-wh-progress)',
            backgroundColor: 'color-mix(in srgb, var(--dash-wh-progress) 16%, transparent)',
          }}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-strong">
            Head {head.no}
          </p>
          <h3
            title={head.name}
            className="mt-0.5 line-clamp-2 text-base font-semibold leading-snug text-foreground"
          >
            {head.name}
          </h3>
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-2">
        <span className="text-[34px] font-semibold leading-none tracking-tight text-foreground">
          <CountUp value={pct} suffix="%" />
        </span>
        <span className="text-[15px] font-medium text-muted-strong">
          {done.toLocaleString()} of {head.total.toLocaleString()} done
        </span>
      </div>

      <div className="mt-3">
        <StatusSplitBar counts={head.counts} />
      </div>

      <p
        className="mt-3 flex min-h-6 items-center gap-1.5 text-[15px] font-medium"
        style={{ color: head.delayedSectors > 0 ? 'var(--dash-wh-delayed)' : undefined }}
      >
        {head.delayedSectors > 0 ? (
          <>
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Delayed in {head.delayedSectors} {head.delayedSectors === 1 ? 'sector' : 'sectors'}
          </>
        ) : (
          <span className="text-muted-strong">No delays</span>
        )}
      </p>
    </li>
  )
}

/**
 * The dashboard's lead panel: every main head of work as a tile — icon, completion, and a stacked
 * bar of its tasks by status. Server-rendered. Type and targets are sized for readers in their
 * 45-55s, and status is never colour alone (the legend on the right spells each one out with an
 * icon).
 */
export function WorkHeadsOverview({ data }: { data: Overview }) {
  const pct = Math.round(data.fraction * 100)
  return (
    <section
      aria-labelledby="work-heads-title"
      className="@container rounded-2xl border border-[var(--dash-card-border)] bg-[var(--dash-card)] p-6 sm:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex items-start gap-3.5">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{
              color: 'var(--dash-wh-progress)',
              backgroundColor: 'color-mix(in srgb, var(--dash-wh-progress) 16%, transparent)',
            }}
            aria-hidden
          >
            <LayoutGrid className="h-5 w-5" />
          </div>
          <div>
            <h2
              id="work-heads-title"
              className="text-xl font-semibold leading-snug text-foreground"
            >
              Work heads
            </h2>
            <p className="mt-1 text-base leading-snug text-muted-strong">
              {data.heads.length} main heads across {data.sectorCount} sectors, about {pct}%
              complete overall
            </p>
          </div>
        </div>
        <DemoPill />
      </div>

      <ExpandableGrid
        initial={6}
        noun="heads"
        className="mt-6 grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2 @min-[720px]:grid-cols-3"
      >
        {data.heads.map((h, i) => (
          <HeadTile key={h.no} head={h} index={i} />
        ))}
      </ExpandableGrid>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[15px] text-foreground">
        {STATUS_ORDER.map((st) => {
          const Icon = STATUS_ICON[st]
          return (
            <span key={st} className="inline-flex items-center gap-2">
              <span
                className="h-3 w-6 rounded-full"
                style={{ backgroundColor: WH_COLOR[st] }}
                aria-hidden
              />
              <Icon className="h-4 w-4 text-muted-strong" aria-hidden />
              {STATUS_LABEL[st]}
            </span>
          )
        })}
      </div>
    </section>
  )
}
