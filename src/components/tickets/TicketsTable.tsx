'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { MessageSquare } from 'lucide-react'
import { Tag } from '@/components/ui/Badge'
import { StatusSelect } from '@/components/tickets/StatusSelect'
import { AssigneeDropdown } from '@/components/tickets/AssigneeDropdown'
import { cn, timeAgo } from '@/lib/utils'
import type { TicketListItemView } from '@/lib/ticket-view'

type StatusOption = { id: string; name: string; color: string }
type UserOption = { id: string; name: string }

export function TicketsTable({
  tickets,
  statuses,
  users,
  canUpdate,
  canAssign,
}: {
  tickets: TicketListItemView[]
  statuses: StatusOption[]
  users: UserOption[]
  canUpdate: boolean
  canAssign: boolean
}) {
  const columns = useMemo<ColumnDef<TicketListItemView>[]>(
    () => [
      { id: 'number', header: 'ID', size: 64 },
      { id: 'subject', header: 'Subject' },
      { id: 'location', header: 'Class / Sector', size: 160 },
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

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="text-sm font-medium text-foreground">No tickets match these filters</p>
        <p className="text-xs text-muted">Try clearing filters or search a different term.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            {table.getHeaderGroups()[0].headers.map((header, i) => (
              <th
                key={header.id}
                className={cn(
                  'py-3 font-medium',
                  i === 0 ? 'pl-5 pr-2' : 'px-2',
                  header.id === 'updatedAt' && 'pr-5 text-right',
                )}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tickets.map((t) => (
            <tr key={t.id} className="group transition-colors hover:bg-white/[0.025]">
              <td className="py-3.5 pl-5 pr-2 font-mono text-xs text-muted">#{t.number}</td>
              <td className="px-2 py-3.5">
                <Link href={`/tickets/${t.number}`} className="block max-w-md">
                  <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-accent-strong">
                    {t.subject}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">{t.preview}</p>
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
                  <div className="flex flex-col gap-1">
                    <Tag>{t.location.classGroup}</Tag>
                    {t.location.sectorNo !== null && (
                      <span className="text-[11px] text-muted">Sector {t.location.sectorNo}</span>
                    )}
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
