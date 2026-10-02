import Link from 'next/link'
import { Ticket as TicketIcon } from 'lucide-react'
import { timeAgo } from '@/lib/utils'

export type ActivityItem = {
  id: string
  action: string
  createdAt: string
  actorName: string
  ticketNumber: number | null
  ticketSubject: string | null
}

const ACTION_LABEL: Record<string, string> = {
  created: 'created',
  status_changed: 'changed the status of',
  assigned: 'assigned',
  priority_changed: 'changed the priority of',
  type_changed: 'changed the type of',
  commented: 'commented on',
  due_date_changed: 'set a due date on',
}

const STAGGER_MS = 45

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <p className="text-base text-muted-strong">No activity yet.</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      {items.map((item, i) => (
        <Link
          key={item.id}
          href={item.ticketNumber ? `/tickets/${item.ticketNumber}` : '#'}
          className="group flex min-h-[3.5rem] items-center gap-3.5 px-6 py-3 opacity-0 transition-colors animate-fade-in hover:bg-overlay"
          style={{ animationDelay: `${i * STAGGER_MS}ms`, animationFillMode: 'both' }}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-overlay text-muted-strong transition-colors group-hover:bg-overlay-strong">
            <TicketIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base text-muted-strong">
              <span className="font-medium text-foreground">{item.actorName}</span>{' '}
              {ACTION_LABEL[item.action] ?? item.action}{' '}
              {item.ticketNumber && (
                <span className="font-medium text-foreground">
                  #{item.ticketNumber} {item.ticketSubject}
                </span>
              )}
            </p>
          </div>
          <span className="shrink-0 text-sm text-muted-strong">{timeAgo(item.createdAt)}</span>
        </Link>
      ))}
    </div>
  )
}
