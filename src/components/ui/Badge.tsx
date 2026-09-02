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
  closed: 'bg-overlay text-muted ring-1 ring-inset ring-overlay-strong',
}

/** Solid-fill counterpart of `statusStyles`, e.g. for an active filter tab where the status's
 *  colour should read as a filled selection rather than a soft badge tint. The `--violet`/
 *  `--info`/`--warning`/`--accent-strong` tokens are tuned as *text* accents on a dark surface,
 *  not as fill backgrounds -- several fail WCAG AA against white text once used as a solid fill
 *  (worst case: violet in dark mode is ~3:1). So these use fixed, deliberately deeper shades in
 *  the same hue family, calibrated for >=4.5:1 with white text in both themes, rather than the
 *  raw tokens. `closed` has no distinct brand colour (it's the neutral/muted status) so it
 *  solidifies the overlay tokens instead of introducing a one-off grey. */
export const statusSolidStyles: Record<Status, string> = {
  new: 'bg-[#5b52d6] text-white',
  open: 'bg-[#1d64d8] text-white',
  pending: 'bg-[#a85d00] text-white',
  resolved: 'bg-[#047a54] text-white',
  closed: 'bg-overlay-strong text-foreground',
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
    <span className="inline-flex items-center rounded-md border border-border bg-overlay px-2 py-0.5 text-[11px] font-medium text-muted-strong">
      {children}
    </span>
  )
}
