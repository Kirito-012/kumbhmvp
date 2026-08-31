import { extractDroneSevaLink } from '@/lib/droneseva-link'

export type PersonView = { id: string; name: string; initials: string } | null

export type TicketListItemView = {
  id: string
  number: number
  subject: string
  preview: string
  priority: { name: string; slug: string; color: string } | null
  status: { name: string; slug: string; color: string; isResolved: boolean } | null
  statusId: string | null
  type: { name: string; slug: string } | null
  assignee: PersonView
  owner: PersonView
  tags: { id: string; name: string; color: string }[]
  updatedAt: string
  comments: number
  location: { classGroup: string; sectorNo: number | null } | null
}

function stripHtml(html: string) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toPerson(doc: unknown): PersonView {
  if (!doc || typeof doc !== 'object') return null
  const d = doc as { _id?: unknown; fullname?: string; email?: string }
  if (!d._id) return null
  const name = d.fullname || d.email || 'Unknown'
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p: string) => p[0]?.toUpperCase())
    .join('')
  return { id: String(d._id), name, initials }
}

export type TicketDetailView = {
  id: string
  number: number
  subject: string
  issueHtml: string
  droneSevaUrl: string | null
  priorityId: string | null
  statusId: string | null
  typeId: string | null
  assigneeId: string | null
  assignee: PersonView
  owner: PersonView
  tags: { id: string; name: string; color: string }[]
  dueDate: string | null
  createdAt: string
  resolvedAt: string | null
  location: {
    sectorPlanId: number
    sectorNo: number | null
    classGroup: string
    lng: number
    lat: number
  } | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toTicketDetailView(t: any): TicketDetailView {
  const { html: issueHtml, droneSevaUrl } = extractDroneSevaLink(t.issue ?? '')
  return {
    id: String(t._id),
    number: t.number,
    subject: t.subject,
    issueHtml,
    droneSevaUrl,
    priorityId: t.priorityId ? String(t.priorityId._id) : null,
    statusId: t.statusId ? String(t.statusId._id) : null,
    typeId: t.typeId ? String(t.typeId._id) : null,
    assigneeId: t.assigneeId ? String(t.assigneeId._id) : null,
    assignee: toPerson(t.assigneeId),
    owner: toPerson(t.ownerId),
    tags: (t.tagIds ?? []).map((tag: { _id: unknown; name: string; color: string }) => ({
      id: String(tag._id),
      name: tag.name,
      color: tag.color,
    })),
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
    createdAt: new Date(t.createdAt).toISOString(),
    resolvedAt: t.resolvedAt ? new Date(t.resolvedAt).toISOString() : null,
    location: t.location
      ? {
          sectorPlanId: t.location.sectorPlanId,
          sectorNo: t.location.sectorNo ?? null,
          classGroup: t.location.classGroup,
          lng: t.location.lng,
          lat: t.location.lat,
        }
      : null,
  }
}

export type CommentView = {
  id: string
  bodyHtml: string
  isInternal: boolean
  author: PersonView
  createdAt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toCommentView(c: any): CommentView {
  return {
    id: String(c._id),
    bodyHtml: c.body,
    isInternal: c.isInternal,
    author: toPerson(c.authorId),
    createdAt: new Date(c.createdAt).toISOString(),
  }
}

export type EventView = {
  id: string
  action: string
  field: string | null
  from: string | null
  to: string | null
  actor: PersonView
  createdAt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toEventView(e: any): EventView {
  return {
    id: String(e._id),
    action: e.action,
    field: e.field ?? null,
    from: e.from ?? null,
    to: e.to ?? null,
    actor: toPerson(e.actorId),
    createdAt: new Date(e.createdAt).toISOString(),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toTicketListItem(t: any): TicketListItemView {
  return {
    id: String(t._id),
    number: t.number,
    subject: t.subject,
    preview: stripHtml(t.issue ?? '').slice(0, 140),
    priority: t.priorityId
      ? { name: t.priorityId.name, slug: t.priorityId.slug, color: t.priorityId.color }
      : null,
    status: t.statusId
      ? {
          name: t.statusId.name,
          slug: t.statusId.slug,
          color: t.statusId.color,
          isResolved: !!t.statusId.isResolved,
        }
      : null,
    statusId: t.statusId ? String(t.statusId._id) : null,
    type: t.typeId ? { name: t.typeId.name, slug: t.typeId.slug } : null,
    assignee: toPerson(t.assigneeId),
    owner: toPerson(t.ownerId),
    tags: (t.tagIds ?? []).map((tag: { _id: unknown; name: string; color: string }) => ({
      id: String(tag._id),
      name: tag.name,
      color: tag.color,
    })),
    updatedAt: new Date(t.lastActivityAt).toISOString(),
    comments: t.counts?.comments ?? 0,
    location: t.location
      ? { classGroup: t.location.classGroup, sectorNo: t.location.sectorNo ?? null }
      : null,
  }
}
