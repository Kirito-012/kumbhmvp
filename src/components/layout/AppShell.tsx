import { Sidebar } from '@/components/layout/Sidebar'
import { SidebarProvider } from '@/components/layout/SidebarContext'
import { SidebarToggle } from '@/components/layout/SidebarToggle'

type ShellUser = {
  name?: string | null
  email?: string | null
  roleName: string
}

export function AppShell({
  user,
  ticketCount,
  pendingAccountsCount = 0,
  variant = 'overlay',
  children,
}: {
  user: ShellUser
  ticketCount: number
  pendingAccountsCount?: number
  /** Both variants start with the sidebar closed and float it over the content; 'overlay' is the
   *  full-bleed map page and 'pinned' the classic app pages (they differ only in hamburger
   *  styling). */
  variant?: 'pinned' | 'overlay'
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <div className="min-h-screen">
        <SidebarToggle variant={variant} />
        <Sidebar
          user={user}
          ticketCount={ticketCount}
          pendingAccountsCount={pendingAccountsCount}
          variant={variant}
        />
        {/* Pinned app pages get an outer gutter so content doesn't run edge to edge, matching the
            floating sidebar's inset; the full-bleed map page keeps none. */}
        <div
          className={
            variant === 'pinned'
              ? 'mx-auto w-full max-w-[1680px] px-3 sm:px-8 lg:px-16 2xl:px-24'
              : undefined
          }
        >
          {children}
        </div>
      </div>
    </SidebarProvider>
  )
}
