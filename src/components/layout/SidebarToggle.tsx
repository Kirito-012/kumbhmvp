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
        'fixed left-4 top-4 z-30 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg shadow-lg transition-colors',
        // 'overlay' variant is the full-bleed map page, which keeps a fixed
        // light "chrome" palette regardless of app theme (see the note in
        // components/map/Panel.tsx) -- the toggle needs to match that light
        // surface here instead of the app's normal dark theme.
        variant === 'overlay'
          ? 'border border-slate-900/8 bg-white/92 text-slate-700 backdrop-blur-md hover:bg-white hover:text-slate-900'
          : 'border border-border bg-background-elevated text-muted-strong hover:bg-surface-hover hover:text-foreground',
        variant === 'pinned' && 'lg:hidden',
      )}
    >
      <Menu className="h-4.5 w-4.5" strokeWidth={2} />
    </button>
  )
}
