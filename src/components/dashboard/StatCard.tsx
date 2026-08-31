import { cn } from '@/lib/utils'

export function StatCard({
  label,
  value,
  caption,
  icon,
  accent = 'accent',
}: {
  label: string
  /** null renders "—" — used when a metric is intentionally unavailable in this scope
   *  (e.g. "Unassigned" on an Agent's dashboard, whose view is already assignee-locked). */
  value: number | string | null
  caption?: string
  icon: React.ReactNode
  accent?: 'accent' | 'violet' | 'warning' | 'danger'
}) {
  const accentMap = {
    accent: 'text-accent-strong bg-accent-soft',
    violet: 'text-violet bg-violet-soft',
    warning: 'text-warning bg-warning-soft',
    danger: 'text-danger bg-danger-soft',
  }

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-sm transition-colors hover:bg-surface">
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
    </div>
  )
}
