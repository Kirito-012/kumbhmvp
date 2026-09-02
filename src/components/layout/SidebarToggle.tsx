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
      style={
        variant === 'overlay'
          ? {
              borderColor: 'var(--map-panel-border)',
              background: 'var(--map-panel-bg)',
              color: 'var(--map-fg-muted)',
            }
          : undefined
      }
      className={cn(
        'fixed left-4 top-4 z-30 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg shadow-lg transition-colors',
        // 'overlay' variant is the full-bleed map page, which follows the --map-* glass palette
        // (see the note in components/map/Panel.tsx) via the inline style above rather than
        // Tailwind classes, matching every other piece of map chrome.
        variant === 'overlay'
          ? 'border backdrop-blur-md hover:brightness-95'
          : 'border border-border bg-background-elevated text-muted-strong hover:bg-surface-hover hover:text-foreground',
        variant === 'pinned' && 'lg:hidden',
      )}
    >
      <Menu className="h-4.5 w-4.5" strokeWidth={2} />
    </button>
  )
}
