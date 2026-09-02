'use client'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/Button'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { GlobalSearch } from '@/components/layout/GlobalSearch'
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

      <GlobalSearch />

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
