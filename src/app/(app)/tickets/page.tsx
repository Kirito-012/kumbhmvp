import Link from 'next/link'
import { Topbar } from '@/components/layout/Topbar'
import { Card } from '@/components/ui/Card'
import { TicketsToolbar } from '@/components/tickets/TicketsToolbar'
import { TicketsTable } from '@/components/tickets/TicketsTable'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  listTickets,
  countTicketsByStatus,
  getLocationFilterOptions,
} from '@/server/services/ticket.service'
import { TicketPriorityModel } from '@/server/db/models/ticket-priority.model'
import { TicketStatusModel } from '@/server/db/models/ticket-status.model'
import { UserModel } from '@/server/db/models/user.model'
import { dbConnect } from '@/server/db/connect'
import { toTicketListItem } from '@/lib/ticket-view'
import { cn } from '@/lib/utils'
import { requireTicketScope } from '@/server/auth/session'

const PAGE_SIZE = 50

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const get = (key: string) => (Array.isArray(sp[key]) ? sp[key][0] : sp[key])

  const { ability, forcedAssigneeId } = await requireTicketScope()
  const canUpdate = ability.can('update', 'ticket')
  const canAssign = ability.can('assign', 'ticket')

  const page = Number(get('page') ?? '1') || 1
  const sector = get('sector')
  const params = {
    status: get('status'),
    priority: get('priority'),
    type: get('type'),
    q: get('q'),
    classGroup: get('class'),
    sectorNo: sector ? Number(sector) : undefined,
    // Agent role: server-forced to their own tickets regardless of any assignee param a client
    // might send — see requireTicketScope() in src/server/auth/session.ts.
    assigneeId: forcedAssigneeId,
    sortField:
      (get('sort') as 'lastActivityAt' | 'createdAt' | 'number' | undefined) ?? 'lastActivityAt',
    sortDir: (get('dir') as 'asc' | 'desc' | undefined) ?? 'desc',
    page,
    pageSize: PAGE_SIZE,
  }

  await dbConnect()
  const [{ items, total }, statusCounts, priorities, statuses, users, locationOptions] =
    await Promise.all([
      listTickets(params),
      countTicketsByStatus(forcedAssigneeId),
      TicketPriorityModel.find().sort({ order: 1 }).lean(),
      TicketStatusModel.find().sort({ order: 1 }).lean(),
      canAssign
        ? UserModel.find({ isActive: true, deletedAt: null }).select('fullname email').lean()
        : Promise.resolve([]),
      getLocationFilterOptions(),
    ])

  const tickets = items.map(toTicketListItem)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)

  const pageHref = (p: number) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value === 'string' && key !== 'page') params.set(key, value)
    }
    params.set('page', String(p))
    return `/tickets?${params.toString()}`
  }

  return (
    <>
      <Topbar
        title="Tickets"
        description={`${statusCounts.total} tickets`}
        primaryAction={{ label: 'New ticket', href: '/tickets/new' }}
      />

      <main className="flex-1 space-y-4 px-8 py-6 animate-fade-in">
        <TicketsToolbar
          statusCounts={statusCounts.byStatus}
          total={statusCounts.total}
          priorities={priorities.map((p) => ({ slug: p.slug, name: p.name }))}
          classGroups={locationOptions.classGroups}
          sectors={locationOptions.sectors}
        />

        <Card>
          <TicketsTable
            tickets={tickets}
            statuses={statuses.map((s) => ({ id: String(s._id), name: s.name, color: s.color }))}
            users={users.map((u) => ({
              id: String(u._id),
              name: u.fullname || u.email || 'Unknown',
            }))}
            canUpdate={canUpdate}
            canAssign={canAssign}
          />

          <div className="flex items-center justify-between border-t border-border px-5 py-3.5">
            <p className="text-xs text-muted">
              Showing{' '}
              <span className="font-medium text-muted-strong">
                {from}–{to}
              </span>{' '}
              of <span className="font-medium text-muted-strong">{total}</span> tickets
            </p>
            <div className="flex items-center gap-1.5">
              <Link
                href={pageHref(Math.max(1, page - 1))}
                aria-disabled={page <= 1}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-strong transition-colors',
                  page <= 1
                    ? 'pointer-events-none cursor-not-allowed text-muted/40'
                    : 'cursor-pointer hover:bg-white/[0.06]',
                )}
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="px-2 text-sm text-muted-strong">
                {page} / {totalPages}
              </span>
              <Link
                href={pageHref(Math.min(totalPages, page + 1))}
                aria-disabled={page >= totalPages}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-strong transition-colors',
                  page >= totalPages
                    ? 'pointer-events-none cursor-not-allowed text-muted/40'
                    : 'cursor-pointer hover:bg-white/[0.06]',
                )}
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Card>
      </main>
    </>
  )
}
