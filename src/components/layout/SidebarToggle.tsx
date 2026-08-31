'use client'

import { Menu } from 'lucide-react'
import { useSidebar } from '@/components/layout/SidebarContext'
import { cn } from '@/lib/utils'

export function SidebarToggle({ variant = 'overlay' }: { variant?: 'pinned' | 'overlay' }) {
  const { setOpen } = useSidebar()

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open menu"
      className={cn(
        'fixed left-4 top-4 z-30 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-border bg-background-elevated text-muted-strong shadow-lg transition-colors hover:bg-surface-hover hover:text-foreground',
        variant === 'pinned' && 'lg:hidden',
      )}
    >
      <Menu className="h-4.5 w-4.5" strokeWidth={2} />
    </button>
  )
}
