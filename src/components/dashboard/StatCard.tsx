import Link from 'next/link'
import { cn } from '@/lib/utils'
import { CountUp } from './CountUp'

/** Each tone is one CSS colour that drives the icon chip, the meter fill and the mini bars. The
 *  hue says what kind of number this is (cyan = work waiting, red = needs an owner, green =
 *  done, blue = incoming) — but every card also carries a text label and an icon, so colour is
 *  never the only thing telling them apart. */
const TONE_COLOR = {
  open: 'var(--dash-open)',
  attention: 'var(--danger)',
  done: 'var(--dash-done)',
  info: 'var(--info)',
} as const

export type StatTone = keyof typeof TONE_COLOR

/** One value per day, oldest first — the last entry is today and is drawn in full colour while the
 *  earlier days sit back, so the eye lands on "now". */
export type StatBars = { values: number[]; labels: string[] }

export function StatCard({
  label,
  value,
  caption,
  icon,
  tone = 'open',
  href,
  meter,
  bars,
}: {
  label: string
  /** null renders "—" — used when a metric is intentionally unavailable in this scope
   *  (e.g. "Unassigned" on a Surveyor's dashboard, whose view is already assignee-locked). */
  value: number | string | null
  /** A full plain-language sentence — it is the line that explains the number, so it is sized to
   *  be read, not squinted at. */
  caption?: string
  icon: React.ReactNode
  tone?: StatTone
  /** When set (and value isn't null), the whole card links to a filtered tickets view — matching
   *  every other dashboard widget's click-to-drill-down behavior. */
  href?: string
  /** 0–1 share drawn as a thick progress bar under the caption. */
  meter?: number
  /** Seven-day mini column chart under the caption (used instead of `meter`). */
  bars?: StatBars
}) {
  const color = TONE_COLOR[tone]
  const max = bars ? Math.max(...bars.values, 1) : 1

  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-base font-medium text-muted-strong">{label}</p>
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
          aria-hidden
        >
          {icon}
        </div>
      </div>
      <p className="mt-3 text-[44px] font-semibold leading-none tracking-tight text-foreground">
        {typeof value === 'number' ? <CountUp value={value} /> : (value ?? '—')}
      </p>
      {caption && <p className="mt-3 text-[15px] leading-snug text-muted-strong">{caption}</p>}

      {meter !== undefined && value !== null && (
        <div
          className="mt-4 h-2.5 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: 'var(--dash-track)' }}
          role="presentation"
        >
          <div
            className="dash-grow-x h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(1, meter)) * 100}%`,
              backgroundColor: color,
              minWidth: meter > 0 ? 6 : 0,
            }}
          />
        </div>
      )}

      {bars && (
        <div className="mt-4">
          <div
            className="flex h-12 items-end gap-1.5"
            role="img"
            aria-label={`${label} per day over the last ${bars.values.length} days: ${bars.values.join(', ')}`}
          >
            {bars.values.map((v, i) => {
              const isToday = i === bars.values.length - 1
              return (
                <div
                  key={i}
                  className="dash-grow-y flex-1 rounded-t-md"
                  title={`${bars.labels[i]}: ${v.toLocaleString()}`}
                  style={{
                    ['--i' as string]: i,
                    height: `${Math.max(8, (v / max) * 100)}%`,
                    backgroundColor: color,
                    opacity: isToday ? 1 : 0.38,
                  }}
                />
              )
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[13px] text-muted-strong">
            <span>{bars.labels[0]}</span>
            <span>{bars.labels[bars.labels.length - 1]}</span>
          </div>
        </div>
      )}
    </>
  )

  const shell =
    'block rounded-2xl border border-[var(--dash-card-border)] bg-[var(--dash-card)] p-6 transition-colors'

  if (href && value !== null) {
    return (
      <Link
        href={href}
        className={cn(
          shell,
          'dash-lift hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        {content}
      </Link>
    )
  }

  return <div className={shell}>{content}</div>
}
