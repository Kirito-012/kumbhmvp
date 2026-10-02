import { cn } from '@/lib/utils'

/** The dashboard's card shell: a solid face with a clearly visible edge, no glass/blur. Lower
 *  contrast "frosted" surfaces are the first thing to wash out for readers with less sensitive
 *  vision, so the cards here stay opaque and outlined (see --dash-card* in globals.css). */
export function DashCard({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--dash-card-border)] bg-[var(--dash-card)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Larger sibling of `CardHeader`: 20px title, 15px plain-language subtitle in the strong
 *  secondary ink, 44px icon chip. */
export function DashCardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-6 pt-6">
      <div className="flex min-w-0 items-start gap-3.5">
        {icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-overlay text-muted-strong">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-snug text-foreground">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-[15px] leading-snug text-muted-strong">{subtitle}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  )
}
