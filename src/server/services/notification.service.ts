import 'server-only'

import { dbConnect } from '@/server/db/connect'
import { TicketEventModel } from '@/server/db/models/ticket-event.model'
import { TicketModel } from '@/server/db/models/ticket.model'
import { UserModel } from '@/server/db/models/user.model'
import type { AppAbility } from '@/server/auth/ability'

const TICKET_EVENT_LIMIT = 25
const PENDING_ACCOUNT_LIMIT = 25
const FEED_LIMIT = 20

const FIELD_LABEL: Record<string, string> = {
  statusId: 'status',
  assigneeId: 'assignee',
  priorityId: 'priority',
  typeId: 'type',
  dueDate: 'due date',
  subject: 'subject',
}

const ACTION_LABEL: Record<string, string> = {
  created: 'created ticket',
  deleted: 'deleted ticket',
  restored: 'restored ticket',
  commented: 'commented on',
  note_added: 'added a note to',
  questionnaire_submitted: 'submitted the questionnaire on',
  attachment_added: 'added a photo to',
  attachment_removed: 'removed a photo from',
}

function labelForEvent(action: string, field?: string | null) {
  if (action === 'field_changed') {
    return `changed the ${FIELD_LABEL[field ?? ''] ?? 'details'} on`
  }
  return ACTION_LABEL[action] ?? action.replace(/_/g, ' ')
}

export type NotificationItem = {
  id: string
  type: 'ticket' | 'account'
  title: string
  subtitle: string
  href: string
  createdAt: string
  read: boolean
}

/**
 * Notification feed for the topbar bell: recent activity on tickets the caller can see (same
 * scoping as the dashboard's "recent activity"), plus new self-service account requests for
 * anyone who can approve them. "Read" is derived from a per-user cursor
 * (`notificationsReadAt`) plus a small set of individually-opened item ids
 * (`readNotificationIds`) for items newer than that cursor.
 */
export async function getNotifications(
  userId: string,
  ability: AppAbility,
  forcedAssigneeId?: string,
) {
  await dbConnect()

  const currentUser = await UserModel.findById(userId)
    .select('notificationsReadAt readNotificationIds createdAt')
    .lean()
  const readAt = currentUser?.notificationsReadAt ?? currentUser?.createdAt ?? new Date(0)
  const readIds = new Set(currentUser?.readNotificationIds ?? [])

  const eventTicketFilter = forcedAssigneeId
    ? { deletedAt: null, assigneeId: forcedAssigneeId }
    : { deletedAt: null }
  const scopedTicketIds = forcedAssigneeId
    ? (await TicketModel.find(eventTicketFilter).select('_id').lean()).map((t) => t._id)
    : null
  const eventMatch = scopedTicketIds ? { ticketId: { $in: scopedTicketIds } } : {}

  const [events, pendingAccounts] = await Promise.all([
    TicketEventModel.find(eventMatch)
      .sort({ createdAt: -1 })
      .limit(TICKET_EVENT_LIMIT)
      .populate([
        { path: 'actorId', select: 'fullname email' },
        { path: 'ticketId', select: 'number subject' },
      ])
      .lean(),
    ability.can('update', 'account')
      ? UserModel.find({ deletedAt: null, status: 'pending' })
          .sort({ createdAt: -1 })
          .limit(PENDING_ACCOUNT_LIMIT)
          .lean()
      : Promise.resolve([]),
  ])

  const items: NotificationItem[] = []

  for (const e of events) {
    const ev = e as unknown as {
      _id: unknown
      action: string
      field?: string | null
      actorId: { _id: unknown; fullname?: string; email?: string } | null
      ticketId: { number: number; subject: string } | null
      createdAt: Date
    }
    // Skip events the caller triggered themselves — "you commented on #12" isn't a notification.
    if (!ev.ticketId || String(ev.actorId?._id) === userId) continue

    const actorName = ev.actorId?.fullname ?? ev.actorId?.email ?? 'Someone'
    const id = String(ev._id)
    items.push({
      id,
      type: 'ticket',
      title: `${actorName} ${labelForEvent(ev.action, ev.field)} #${ev.ticketId.number}`,
      subtitle: ev.ticketId.subject,
      href: `/tickets/${ev.ticketId.number}`,
      createdAt: ev.createdAt.toISOString(),
      read: ev.createdAt <= readAt || readIds.has(id),
    })
  }

  for (const u of pendingAccounts) {
    const id = String(u._id)
    items.push({
      id,
      type: 'account',
      title: `${u.fullname} requested an account`,
      subtitle: u.email,
      href: '/accounts',
      createdAt: (u.createdAt as Date).toISOString(),
      read: (u.createdAt as Date) <= readAt || readIds.has(id),
    })
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const feed = items.slice(0, FEED_LIMIT)
  const unreadCount = items.filter((i) => !i.read).length

  return { items: feed, unreadCount }
}

export async function markAllNotificationsRead(userId: string) {
  await dbConnect()
  await UserModel.updateOne(
    { _id: userId },
    { $set: { notificationsReadAt: new Date(), readNotificationIds: [] } },
  )
}

export async function markNotificationRead(userId: string, notificationId: string) {
  await dbConnect()
  await UserModel.updateOne({ _id: userId }, { $addToSet: { readNotificationIds: notificationId } })
}
