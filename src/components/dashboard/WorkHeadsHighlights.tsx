import { Circle, ListChecks, Siren } from 'lucide-react'
import type { WorkHeadsOverview as Overview } from '@/lib/workHeads/overview'
import { HEAD_ICON, STATUS_ICON, STATUS_LABEL, STATUS_ORDER } from '@/lib/workHeads/ui'
import { CountUp } from './CountUp'
import { DemoPill, StatusSplitBar, WH_COLOR } from './WorkHeadsOverview'

const CARD = 'rounded-2xl border border-[var(--dash-card-border)] bg-[var(--dash-card)] p-6'

function pctOf(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

/**
 * The right-hand column: the whole programme's task status (one bar, four counted rows) and the
 * heads with the most delayed tasks — the two things a reader wants answered first. Server-rendered.
 */
export function WorkHeadsHighlights({ data }: { data: Overview }) {
  const worst = [...data.heads]
    .filter((h) => h.counts.delayed > 0)
    .sort((a, b) => b.counts.delayed - a.counts.delayed)
    .slice(0, 5)
  const maxDelayed = worst[0]?.counts.delayed ?? 1

  return (
    <aside
      aria-label="Work heads highlights"
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-1"
    >
      <section aria-labelledby="wh-delayed-title" className={CARD}>
        <div className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{
              color: 'var(--dash-wh-delayed)',
              backgroundColor: 'color-mix(in srgb, var(--dash-wh-delayed) 16%, transparent)',
            }}
            aria-hidden
          >
            <Siren className="h-5 w-5" />
          </span>
          <div>
            <h2 id="wh-delayed-title" className="text-lg font-semibold text-foreground">
              Needs attention
            </h2>
            <p className="text-[15px] text-muted-strong">Heads with the most delayed tasks</p>
          </div>
        </div>

        {worst.length === 0 ? (
          <p className="mt-5 text-base text-muted-strong">Nothing is delayed.</p>
        ) : (
          <ol className="mt-5 space-y-4">
            {worst.map((h, i) => {
              const Icon = HEAD_ICON[h.no] ?? Circle
              return (
                <li key={h.no}>
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-5 w-5 shrink-0 text-muted-strong" aria-hidden />
                    <span
                      className="min-w-0 flex-1 truncate text-base font-medium text-foreground"
                      title={h.name}
                    >
                      {h.name}
                    </span>
                    <span
                      className="text-lg font-semibold tabular-nums"
                      style={{ color: 'var(--dash-wh-delayed)' }}
                    >
                      {h.counts.delayed.toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-2.5 overflow-hidden rounded-full"
                    style={{ backgroundColor: 'var(--dash-track)' }}
                    aria-hidden
                  >
                    <div
                      className="dash-grow-x h-full rounded-full"
                      style={{
                        ['--i' as string]: i,
                        width: `${(h.counts.delayed / maxDelayed) * 100}%`,
                        backgroundColor: 'var(--dash-wh-delayed)',
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="wh-status-title" className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{
                color: 'var(--dash-wh-progress)',
                backgroundColor: 'color-mix(in srgb, var(--dash-wh-progress) 16%, transparent)',
              }}
              aria-hidden
            >
              <ListChecks className="h-5 w-5" />
            </span>
            <h2 id="wh-status-title" className="text-lg font-semibold text-foreground">
              All tasks
            </h2>
          </div>
          <DemoPill />
        </div>

        <p className="mt-4 text-[44px] font-semibold leading-none tracking-tight text-foreground">
          <CountUp value={data.total} />
        </p>
        <p className="mt-2 text-[15px] leading-snug text-muted-strong">
          sub-head tasks across every sector
        </p>

        <div className="mt-4">
          <StatusSplitBar counts={data.counts} className="h-4" />
        </div>

        <ul className="mt-4 space-y-2.5">
          {STATUS_ORDER.map((st) => {
            const Icon = STATUS_ICON[st]
            return (
              <li key={st} className="flex items-center gap-3 text-base">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    color: WH_COLOR[st],
                    backgroundColor: `color-mix(in srgb, ${WH_COLOR[st]} 16%, transparent)`,
                  }}
                  aria-hidden
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1 font-medium text-foreground">{STATUS_LABEL[st]}</span>
                <span className="text-[15px] text-muted-strong">
                  {pctOf(data.counts[st], data.total)}%
                </span>
                <span className="w-14 text-right text-lg font-semibold tabular-nums text-foreground">
                  {data.counts[st].toLocaleString()}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </aside>
  )
}
