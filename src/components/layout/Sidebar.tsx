'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Map, Ticket, Users, Sparkles, LogOut, X } from 'lucide-react'
import { cn, initialsFor } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { useSidebar } from '@/components/layout/SidebarContext'
import { logout } from '@/server/actions/auth.actions'

type SidebarUser = {
  name?: string | null
  email?: string | null
  roleName: string
}

function buildNav(ticketCount: number, pendingAccountsCount: number) {
  return [
    {
      section: 'Workspace',
      items: [
        { label: 'Map', href: '/', icon: Map },
        { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { label: 'Tickets', href: '/tickets', icon: Ticket, badge: String(ticketCount) },
      ],
    },
    {
      section: 'Organization',
      items: [
        {
          label: 'Accounts',
          href: '/accounts',
          icon: Users,
          badge: pendingAccountsCount > 0 ? String(pendingAccountsCount) : undefined,
          badgeWarning: pendingAccountsCount > 0,
        },
      ],
    },
  ]
}

export function Sidebar({
  user,
  ticketCount,
  pendingAccountsCount = 0,
  variant = 'overlay',
}: {
  user: SidebarUser
  ticketCount: number
  pendingAccountsCount?: number
  /** 'pinned' stays permanently visible on desktop (only slides on mobile), like the classic
   *  app pages. 'overlay' always starts closed and slides in on top of content, on every
   *  screen size — used by the full-bleed map page. */
  variant?: 'pinned' | 'overlay'
}) {
  const pathname = usePathname()
  const { open, setOpen } = useSidebar()
  const displayName = user.name || user.email || 'Account'
  const person = { name: displayName, initials: initialsFor(displayName), color: '#10b981' }
  const nav = buildNav(ticketCount, pendingAccountsCount)
  const pinned = variant === 'pinned'

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200',
          pinned && 'lg:hidden',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-background-elevated transition-transform duration-200',
          pinned && 'lg:z-40 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent shadow-[0_0_20px_-4px_rgba(16,185,129,0.7)]">
            <Sparkles className="h-4.5 w-4.5 text-black" strokeWidth={2.25} />
          </div>
          <span className="flex-1 text-[15px] font-semibold tracking-tight text-foreground">
            TheCraftSync
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className={cn(
              'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-strong hover:bg-white/[0.06]',
              pinned && 'lg:hidden',
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {nav.map((group) => (
            <div key={group.section}>
              <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted/70">
                {group.section}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive =
                    item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-150',
                        isActive
                          ? 'bg-accent-soft text-accent-strong'
                          : 'text-muted-strong hover:bg-white/[0.05] hover:text-foreground',
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                      )}
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
                            'badgeWarning' in item && item.badgeWarning
                              ? 'bg-warning/20 text-warning'
                              : isActive
                                ? 'bg-accent/20 text-accent-strong'
                                : 'bg-white/[0.06] text-muted',
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-3 border-t border-border p-3">
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-white/[0.02] px-2.5 py-2">
            <Avatar person={person} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">{displayName}</p>
              <p className="truncate text-[11px] text-muted">{user.roleName}</p>
            </div>
            <form action={logout}>
              <button
                type="submit"
                aria-label="Log out"
                title="Log out"
                className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-white/[0.06] hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  )
}
