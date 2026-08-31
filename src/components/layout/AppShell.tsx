import { Sidebar } from '@/components/layout/Sidebar'
import { SidebarProvider } from '@/components/layout/SidebarContext'
import { SidebarToggle } from '@/components/layout/SidebarToggle'
import { cn } from '@/lib/utils'

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
  /** 'pinned': classic app pages, sidebar stays visible on desktop. 'overlay': full-bleed
   *  pages (the map), sidebar always starts closed and slides in over content. */
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
        <div className={cn(variant === 'pinned' && 'lg:pl-64')}>{children}</div>
      </div>
    </SidebarProvider>
  )
}
