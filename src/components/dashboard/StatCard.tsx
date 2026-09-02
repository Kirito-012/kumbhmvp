import Link from 'next/link'
import { cn } from '@/lib/utils'

export function StatCard({
  label,
  value,
  caption,
  icon,
  accent = 'accent',
  href,
}: {
  label: string
  /** null renders "—" — used when a metric is intentionally unavailable in this scope
   *  (e.g. "Unassigned" on a Surveyor's dashboard, whose view is already assignee-locked). */
  value: number | string | null
  caption?: string
  icon: React.ReactNode
  accent?: 'accent' | 'violet' | 'warning' | 'danger'
  /** When set (and value isn't null), the whole card links to a filtered tickets view — matching
   *  every other dashboard widget's click-to-drill-down behavior. */
  href?: string
}) {
  const accentMap = {
    accent: 'text-accent-strong bg-accent-soft',
    violet: 'text-violet bg-violet-soft',
    warning: 'text-warning bg-warning-soft',
    danger: 'text-danger bg-danger-soft',
  }

  const content = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        <div
          className={cn('flex h-8 w-8 items-center justify-center rounded-lg', accentMap[accent])}
        >
          {icon}
        </div>
      </div>
      <p className="mt-3 text-[28px] font-semibold leading-none tracking-tight text-foreground">
        {value ?? '—'}
      </p>
      {caption && <p className="mt-2.5 text-xs text-muted">{caption}</p>}
    </>
  )

  if (href && value !== null) {
    return (
      <Link
        href={href}
        className="block rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {content}
      </Link>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-sm transition-colors hover:bg-surface">
      {content}
    </div>
  )
}
