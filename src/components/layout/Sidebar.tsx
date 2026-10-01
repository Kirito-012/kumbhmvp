'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Map, Ticket, Users, LogOut, X } from 'lucide-react'
import { cn, initialsFor } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { BrandMark } from '@/components/ui/BrandMark'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the shared shell API
  variant = 'overlay',
}: {
  user: SidebarUser
  ticketCount: number
  pendingAccountsCount?: number
  /** Kept for the shell's two page families; the sidebar itself behaves identically in both:
   *  closed by default, hover-peeks from the hamburger, click pins it open. */
  variant?: 'pinned' | 'overlay'
}) {
  const pathname = usePathname()
  const { open, setOpen, peeking, peekStart, peekEnd } = useSidebar()
  const visible = open || peeking
  const displayName = user.name || user.email || 'Account'
  const person = { name: displayName, initials: initialsFor(displayName), color: '#10b981' }
  const nav = buildNav(ticketCount, pendingAccountsCount)

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200',
          // The dim backdrop belongs to the pinned (clicked) state only: a hover peek is a
          // glance, not a modal, so the page behind stays fully visible and usable.
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        onMouseEnter={peekStart}
        onMouseLeave={peekEnd}
        aria-hidden={!visible}
        inert={!visible}
        className={cn(
          // Floating card: inset from every edge with rounded corners and a deep shadow rather
          // than an edge-to-edge rail. The closed offset clears the card's own margin so its
          // shadow never peeks in from the left.
          'fixed bottom-3 left-3 z-50 flex w-64 flex-col overflow-hidden rounded-2xl border border-border bg-background-elevated shadow-2xl shadow-black/30 transition-[transform,opacity,top] duration-200',
          // A hover peek starts just below the hamburger (top-4 + h-10) so the button stays
          // uncovered and clickable -- sliding over it meant the click landed on the sidebar and
          // could never pin it. Once pinned, the card rises to the full inset.
          open ? 'top-3' : 'top-[4.5rem]',
          visible ? 'translate-x-0 opacity-100' : '-translate-x-[calc(100%+1.5rem)] opacity-0',
        )}
      >
        <div className="flex h-16 items-center gap-2.5 px-5">
          <BrandMark wordmark className="flex-1" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-strong hover:bg-overlay-strong"
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
                          : 'text-muted-strong hover:bg-overlay-strong hover:text-foreground',
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
                                : 'bg-overlay-strong text-muted',
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
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-overlay px-2.5 py-2">
            <Avatar person={person} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">{displayName}</p>
              <p className="truncate text-[11px] text-muted">{user.roleName}</p>
            </div>
            <ThemeToggle />
            <form action={logout}>
              <button
                type="submit"
                aria-label="Log out"
                title="Log out"
                className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-overlay hover:text-foreground"
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
