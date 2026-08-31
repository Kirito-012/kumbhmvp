'use client'

import Link from 'next/link'
import { Search, Plus } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/Button'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { cn } from '@/lib/utils'

export function Topbar({
  title,
  description,
  primaryAction,
}: {
  title: string
  description?: string
  primaryAction?: { label: string; icon?: React.ReactNode; href?: string }
}) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 pl-16 backdrop-blur-md sm:gap-4 sm:px-8 sm:pl-16 lg:px-8">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold text-foreground">{title}</h1>
        {description && <p className="truncate text-xs text-muted">{description}</p>}
      </div>

      <label className="relative hidden w-72 shrink-0 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          placeholder="Search tickets, people…"
          className="h-9 w-full rounded-lg border border-border bg-white/[0.03] pl-9 pr-3 text-sm text-foreground placeholder:text-muted/70 outline-none transition-colors focus:border-accent/40 focus:bg-white/[0.05]"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-muted">
          ⌘K
        </kbd>
      </label>

      <NotificationBell />

      {primaryAction &&
        (primaryAction.href ? (
          <Link
            href={primaryAction.href}
            className={cn(buttonVariants({ size: 'md' }), 'shrink-0')}
          >
            {primaryAction.icon ?? <Plus className="h-4 w-4" />}
            {primaryAction.label}
          </Link>
        ) : (
          <Button size="md" className="shrink-0">
            {primaryAction.icon ?? <Plus className="h-4 w-4" />}
            {primaryAction.label}
          </Button>
        ))}
    </header>
  )
}
