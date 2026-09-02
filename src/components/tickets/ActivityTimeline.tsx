import { Activity } from 'lucide-react'
import { timeAgo } from '@/lib/utils'
import type { EventView } from '@/lib/ticket-view'

const FIELD_LABELS: Record<string, string> = {
  subject: 'subject',
  statusId: 'status',
  assigneeId: 'assignee',
  priorityId: 'priority',
  typeId: 'type',
  dueDate: 'due date',
}

const ACTION_LABELS: Record<string, string> = {
  created: 'created this ticket',
  commented: 'replied',
  note_added: 'added an internal note',
  deleted: 'deleted this ticket',
  restored: 'restored this ticket',
}

function describe(event: EventView) {
  if (event.action === 'field_changed' && event.field) {
    const label = FIELD_LABELS[event.field] ?? event.field
    if (event.field === 'assigneeId') {
      return event.to ? `assigned this ticket` : 'unassigned this ticket'
    }
    return `changed ${label}`
  }
  return ACTION_LABELS[event.action] ?? event.action
}

export function ActivityTimeline({ events }: { events: EventView[] }) {
  if (events.length === 0) return <p className="text-sm text-muted">No activity yet.</p>

  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-2.5 text-xs">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-overlay text-muted">
            <Activity className="h-2.5 w-2.5" />
          </div>
          <p className="text-muted-strong">
            <span className="font-medium text-foreground">{e.actor?.name ?? 'Someone'}</span>{' '}
            {describe(e)}
            <span className="ml-1.5 text-muted">· {timeAgo(e.createdAt)}</span>
          </p>
        </li>
      ))}
    </ol>
  )
}
