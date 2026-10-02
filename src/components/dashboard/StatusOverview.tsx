import Link from 'next/link'
import type { StatusBucket } from '@/lib/insights/statusBuckets'
import { CountUp } from './CountUp'

export type StatusOverviewEntry = { bucket: StatusBucket; name: string; count: number }

/** CSS colour per bucket — the same four hues as BUCKET_COLORS, as theme-aware tokens. */
const BUCKET_VAR: Record<StatusBucket, string> = {
  new: 'var(--dash-status-new)',
  open: 'var(--dash-status-open)',
  pending: 'var(--dash-status-pending)',
  resolved: 'var(--dash-status-resolved)',
}

/** One plain sentence per status, so nobody has to guess what "Pending" means in this system. */
const BUCKET_HINT: Record<StatusBucket, string> = {
  new: 'Just reported, not yet looked at',
  open: 'Being worked on',
  pending: 'Waiting on something or someone',
  resolved: 'Fixed and done',
}

const RING_SIZE = 150
const RING_STROKE = 15
const RING_R = (RING_SIZE - RING_STROKE) / 2
const RING_CIRC = 2 * Math.PI * RING_R

function pctLabel(count: number, total: number): string {
  if (total === 0 || count === 0) return '0%'
  const p = (count / total) * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}

/**
 * The dashboard's lead panel: how far along everything is (a progress ring) and where every
 * ticket currently stands (one labelled bar plus four tiles). Server-rendered — no client JS.
 *
 * Built for readers in their 45-55s: the headline number is large, every status is spelled out
 * with a one-line meaning and a count rather than left to a colour legend, and the tiles are big
 * click targets that open that status's ticket list.
 */
export function StatusOverview({
  data,
  mine,
}: {
  data: StatusOverviewEntry[]
  /** Surveyor scope: the numbers are that person's own tickets, and the wording says so. */
  mine?: boolean
}) {
  const total = data.reduce((sum, s) => sum + s.count, 0)
  const resolved = data.find((s) => s.bucket === 'resolved')?.count ?? 0
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0
  const noun = mine ? 'of your tickets' : 'tickets'

  return (
    <section
      aria-labelledby="status-overview-title"
      className="@container rounded-2xl border border-[var(--dash-card-border)] bg-[var(--dash-card)] p-6 sm:p-8"
    >
      <div className="flex flex-col gap-6 @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:gap-8">
        {/* Progress ring */}
        <div className="flex shrink-0 items-center gap-6">
          <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
            <svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              role="img"
              aria-label={`${pct}% of ${noun} are resolved: ${resolved.toLocaleString()} of ${total.toLocaleString()}`}
            >
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                fill="none"
                stroke="var(--dash-track)"
                strokeWidth={RING_STROKE}
              />
              {total > 0 && pct > 0 && (
                <circle
                  className="dash-ring"
                  style={{ ['--ring-c' as string]: RING_CIRC }}
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_R}
                  fill="none"
                  stroke="var(--dash-done)"
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${(pct / 100) * RING_CIRC} ${RING_CIRC}`}
                  transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                />
              )}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[44px] font-semibold leading-none tracking-tight text-foreground">
                <CountUp value={pct} suffix="%" />
              </span>
              <span className="mt-1 text-[15px] font-medium text-muted-strong">resolved</span>
            </div>
          </div>
        </div>

        {/* One bar showing how every ticket divides across the four statuses */}
        <div className="min-w-0 flex-1">
          <div>
            <h2
              id="status-overview-title"
              className="text-xl font-semibold leading-snug text-foreground"
            >
              {mine ? 'Your progress' : 'Overall progress'}
            </h2>
            <p className="mt-1.5 text-base leading-snug text-muted-strong">
              {total === 0
                ? 'No tickets yet.'
                : `${resolved.toLocaleString()} of ${total.toLocaleString()} ${noun} are resolved.`}
            </p>
          </div>
          <h3 className="mt-5 text-lg font-semibold text-foreground">Where every ticket stands</h3>
          {total > 0 ? (
            // 2px surface gaps between segments (flex gap) — the gap, not a border, separates them.
            <div className="mt-3 flex h-10 gap-0.5 overflow-hidden rounded-xl" aria-hidden>
              {data
                .filter((s) => s.count > 0)
                .map((s, i) => (
                  <div
                    key={s.bucket}
                    className="dash-grow-x"
                    style={{
                      ['--i' as string]: i,
                      flexGrow: s.count,
                      flexBasis: 0,
                      minWidth: 8,
                      backgroundColor: BUCKET_VAR[s.bucket],
                    }}
                    title={`${s.name}: ${s.count.toLocaleString()} (${pctLabel(s.count, total)})`}
                  />
                ))}
            </div>
          ) : (
            <p className="mt-3 text-base text-muted-strong">Nothing to show yet.</p>
          )}
        </div>
      </div>

      {/* The four statuses, spelled out — a legend you can read and click, not just colours. */}
      <div className="mt-6 grid grid-cols-1 gap-3 @min-[420px]:grid-cols-2 @min-[640px]:grid-cols-4">
        {data.map((s) => (
          <Link
            key={s.bucket}
            href={`/tickets?status=${s.bucket}`}
            className="dash-lift rounded-xl border border-[var(--dash-card-border)] p-4 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="flex items-center gap-2.5">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: BUCKET_VAR[s.bucket] }}
                aria-hidden
              />
              <span className="text-base font-semibold text-foreground">{s.name}</span>
            </div>
            <p className="mt-2.5 flex items-baseline justify-between gap-2">
              <span className="text-[34px] font-semibold leading-none tracking-tight text-foreground">
                <CountUp value={s.count} />
              </span>
              <span className="text-[15px] font-medium text-muted-strong">
                {pctLabel(s.count, total)}
                <span className="hidden @min-[860px]:inline"> of all</span>
              </span>
            </p>
            <p className="mt-2 text-[15px] leading-snug text-muted-strong">
              {BUCKET_HINT[s.bucket]}
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}
