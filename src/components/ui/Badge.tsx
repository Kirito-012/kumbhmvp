import { cn } from '@/lib/utils'
import type { Priority, Status } from '@/lib/mock-data'

const priorityStyles: Record<Priority, string> = {
  critical: 'bg-danger-soft text-danger ring-1 ring-inset ring-danger/20',
  high: 'bg-warning-soft text-warning ring-1 ring-inset ring-warning/20',
  medium: 'bg-info-soft text-info ring-1 ring-inset ring-info/20',
  low: 'bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent/20',
}

const priorityLabel: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        priorityStyles[priority],
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: 'currentColor' }}
        aria-hidden
      />
      {priorityLabel[priority]}
    </span>
  )
}

const statusStyles: Record<Status, string> = {
  new: 'bg-violet-soft text-violet ring-1 ring-inset ring-violet/20',
  open: 'bg-info-soft text-info ring-1 ring-inset ring-info/20',
  pending: 'bg-warning-soft text-warning ring-1 ring-inset ring-warning/20',
  resolved: 'bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent/20',
  closed: 'bg-white/5 text-muted ring-1 ring-inset ring-white/10',
}

const statusLabel: Record<Status, string> = {
  new: 'New',
  open: 'Open',
  pending: 'Pending',
  resolved: 'Resolved',
  closed: 'Closed',
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        statusStyles[status],
        className,
      )}
    >
      {statusLabel[status]}
    </span>
  )
}

/** Color-driven badge for DB-backed statuses/priorities (colors come from the seeded documents). */
export function DynamicBadge({
  label,
  color,
  dot = true,
  className,
}: {
  label: string
  color: string
  dot?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={{ backgroundColor: `${color}22`, color }}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      )}
      {label}
    </span>
  )
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-muted-strong">
      {children}
    </span>
  )
}
