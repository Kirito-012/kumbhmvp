'use server'

import { requireTicketScope } from '@/server/auth/session'
import * as notificationService from '@/server/services/notification.service'

export async function getNotificationsAction() {
  const { user, ability, forcedAssigneeId } = await requireTicketScope()
  return notificationService.getNotifications(user.id, ability, forcedAssigneeId)
}

export async function markAllNotificationsReadAction() {
  const { user } = await requireTicketScope()
  await notificationService.markAllNotificationsRead(user.id)
}

export async function markNotificationReadAction(notificationId: string) {
  const { user } = await requireTicketScope()
  await notificationService.markNotificationRead(user.id, notificationId)
}
