'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { MessageSquare, ArrowUp, ArrowDown, SearchX } from 'lucide-react'
import { Tag } from '@/components/ui/Badge'
import { StatusSelect } from '@/components/tickets/StatusSelect'
import { AssigneeDropdown } from '@/components/tickets/AssigneeDropdown'
import { CLASS_GROUP_COLORS } from '@/lib/classColors'
import { cn, timeAgo } from '@/lib/utils'
import type { TicketListItemView } from '@/lib/ticket-view'

// Only these map to a real server-side sort (see listTickets's sortField union) -- other
// columns (Subject, Class/Sector, Status, Assignee) have no supported sort, so their headers
// stay static rather than implying a click that would silently do nothing.
const SORTABLE: Partial<Record<string, string>> = { number: 'number', updatedAt: 'lastActivityAt' }

type StatusOption = { id: string; name: string; color: string }
type UserOption = { id: string; name: string }

export function TicketsTable({
  tickets,
  statuses,
  users,
  canUpdate,
  canAssign,
  hasActiveFilters,
}: {
  tickets: TicketListItemView[]
  statuses: StatusOption[]
  users: UserOption[]
  canUpdate: boolean
  canAssign: boolean
  /** Whether any filter/search param is applied, so the empty state can distinguish "no
   *  tickets ever created" from "no tickets match" and offer a way out of the latter. */
  hasActiveFilters: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeSortField = searchParams.get('sort') ?? 'lastActivityAt'
  const activeSortDir = searchParams.get('dir') ?? 'desc'

  const columns = useMemo<ColumnDef<TicketListItemView>[]>(
    () => [
      { id: 'number', header: 'ID', size: 64 },
      { id: 'subject', header: 'Subject' },
      { id: 'location', header: 'Class / Sector', size: 190 },
      { id: 'status', header: 'Status', size: 160 },
      { id: 'assignee', header: 'Assignee', size: 140 },
      { id: 'updatedAt', header: 'Updated', size: 80 },
    ],
    [],
  )

  const table = useReactTable({
    data: tickets,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  })

  function toggleSort(columnId: string) {
    const field = SORTABLE[columnId]
    if (!field) return
    const params = new URLSearchParams(searchParams.toString())
    const nextDir = field === activeSortField && activeSortDir === 'desc' ? 'asc' : 'desc'
    params.set('sort', field)
    params.set('dir', nextDir)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-overlay text-muted">
          <SearchX className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No tickets match these filters</p>
          <p className="mt-0.5 text-xs text-muted">Try a different search term or fewer filters.</p>
        </div>
        {hasActiveFilters && (
          <Link
            href={pathname}
            className="mt-1 inline-flex items-center rounded-lg border border-border-strong bg-overlay px-3 py-1.5 text-xs font-medium text-muted-strong transition-colors hover:bg-overlay-strong hover:text-foreground"
          >
            Clear all filters
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            {table.getHeaderGroups()[0].headers.map((header, i) => {
              const field = SORTABLE[header.id]
              const isActive = field === activeSortField
              return (
                <th
                  key={header.id}
                  className={cn(
                    'py-3 font-medium',
                    i === 0 ? 'pl-5 pr-2' : 'px-2',
                    header.id === 'updatedAt' && 'pr-5 text-right',
                  )}
                >
                  {field ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(header.id)}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground',
                        header.id === 'updatedAt' && 'flex-row-reverse',
                        isActive && 'text-muted-strong',
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {isActive &&
                        (activeSortDir === 'desc' ? (
                          <ArrowDown className="h-3 w-3" strokeWidth={2.5} />
                        ) : (
                          <ArrowUp className="h-3 w-3" strokeWidth={2.5} />
                        ))}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tickets.map((t) => (
            <tr key={t.id} className="group transition-colors hover:bg-overlay">
              {/* The coloured accent lives on the first <td> (not the <tr>) -- a table row is
                  an unreliable containing block for absolutely-positioned children across
                  browsers, so a span positioned against `relative` on the <tr> itself doesn't
                  consistently scope per-row. */}
              <td className="relative py-3.5 pl-4 pr-2 font-mono text-xs text-muted">
                {t.priority?.color && (
                  <span
                    className="pointer-events-none absolute inset-y-4 left-0 w-[3px] rounded-full"
                    style={{ backgroundColor: t.priority.color }}
                    aria-hidden
                  />
                )}
                #{t.number}
              </td>
              <td className="px-2 py-3.5">
                <Link href={`/tickets/${t.number}`} className="block max-w-md">
                  <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-accent-strong">
                    {t.subject}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted/80">{t.preview}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {t.tags.map((tag) => (
                      <Tag key={tag.id}>{tag.name}</Tag>
                    ))}
                    {t.comments > 0 && (
                      <span className="ml-1 flex items-center gap-1 text-[11px] text-muted">
                        <MessageSquare className="h-3 w-3" /> {t.comments}
                      </span>
                    )}
                  </div>
                </Link>
              </td>
              <td className="px-2 py-3.5">
                {t.location ? (
                  <div className="flex min-w-0 items-center gap-1.5 text-xs">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          CLASS_GROUP_COLORS[t.location.classGroup] ?? 'var(--color-muted)',
                      }}
                      aria-hidden
                    />
                    <span className="truncate">
                      <span className="font-medium text-muted-strong">{t.location.classGroup}</span>
                      {t.location.sectorNo !== null && (
                        <span className="text-muted"> · Sector {t.location.sectorNo}</span>
                      )}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-muted/60">—</span>
                )}
              </td>
              <td className="px-2 py-3.5">
                <StatusSelect
                  ticketNumber={t.number}
                  statusId={t.statusId}
                  statuses={statuses}
                  disabled={!canUpdate}
                />
              </td>
              <td className="px-2 py-3.5">
                <AssigneeDropdown
                  ticketNumber={t.number}
                  assignee={t.assignee}
                  users={users}
                  disabled={!canAssign}
                />
              </td>
              <td className="py-3.5 pl-2 pr-5 text-right text-xs text-muted">
                {timeAgo(t.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
