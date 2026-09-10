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
        // z-40, one above the pinned-shell Topbar's z-30 sticky header (see Topbar.tsx): the
        // header's own `pl-16` padding is only a visual clearance, not a hit-testing one -- with
        // equal z-index the later-rendered Topbar (it's part of `children`, mounted after this
        // button in AppShell's DOM order) was capturing clicks over the padded-left region and
        // making the hamburger unreachable on mobile, where it's the *only* way to open the
        // sidebar.
        'fixed left-4 top-4 z-40 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg shadow-lg transition-colors',
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
