import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, Check, ExternalLink, MapPin, UserRound } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Card } from '@/components/ui/Card'
import { buttonVariants } from '@/components/ui/Button'
import { DynamicBadge, Tag } from '@/components/ui/Badge'
import { CommentThread } from '@/components/tickets/CommentThread'
import { ActivityTimeline } from '@/components/tickets/ActivityTimeline'
import { TicketDetailSidebar } from '@/components/tickets/TicketDetailSidebar'
import { TicketLocationMap } from '@/components/map/TicketLocationMap'
import { SitePhotos } from '@/components/tickets/SitePhotos'
import { QuestionnaireEntry } from '@/components/tickets/questionnaire/QuestionnaireEntry'
import { requireTicketScope } from '@/server/auth/session'
import { dbConnect } from '@/server/db/connect'
import * as ticketService from '@/server/services/ticket.service'
import * as attachmentService from '@/server/services/attachment.service'
import * as questionnaireService from '@/server/services/questionnaire.service'
import { TicketStatusModel } from '@/server/db/models/ticket-status.model'
import { TicketPriorityModel } from '@/server/db/models/ticket-priority.model'
import { TicketTypeModel } from '@/server/db/models/ticket-type.model'
import { UserModel } from '@/server/db/models/user.model'
import {
  toTicketDetailView,
  toCommentView,
  toEventView,
  toAttachmentView,
  toQuestionnaireView,
} from '@/lib/ticket-view'
import { cn } from '@/lib/utils'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ number: string }>
}) {
  const { number: numberParam } = await params
  const number = Number(numberParam)
  if (!Number.isInteger(number)) notFound()

  const { user, ability, forcedAssigneeId } = await requireTicketScope()

  await dbConnect()
  const ticketDoc = await ticketService.getTicketByNumber(number)
  if (!ticketDoc) notFound()

  // Surveyor-scoped: a ticket not assigned to them doesn't exist as far as they're concerned —
  // same as it not existing, not a "you're not allowed" page (avoids confirming it exists).
  if (forcedAssigneeId) {
    const assignee = (ticketDoc as { assigneeId?: { _id?: unknown } | null }).assigneeId
    const assigneeId = assignee?._id ? String(assignee._id) : null
    if (assigneeId !== user.id) notFound()
  }

  const [
    commentsRaw,
    eventsRaw,
    statuses,
    priorities,
    types,
    users,
    attachmentsRaw,
    questionnairesRaw,
  ] = await Promise.all([
    ticketService.listComments(String(ticketDoc._id)),
    ticketService.listEvents(String(ticketDoc._id)),
    TicketStatusModel.find().sort({ order: 1 }).lean(),
    TicketPriorityModel.find().sort({ order: 1 }).lean(),
    TicketTypeModel.find({ isActive: true }).sort({ name: 1 }).lean(),
    UserModel.find({ isActive: true, deletedAt: null }).select('fullname email').lean(),
    attachmentService.listAttachments(String(ticketDoc._id)),
    questionnaireService.listQuestionnaires(String(ticketDoc._id)),
  ])

  const ticket = toTicketDetailView(ticketDoc)
  const comments = commentsRaw.map(toCommentView)
  const events = eventsRaw.map(toEventView)
  const photos = attachmentsRaw.map(toAttachmentView)
  const questionnaires = questionnairesRaw.map(toQuestionnaireView)
  const questionnairesById = Object.fromEntries(questionnaires.map((q) => [q.id, q]))

  const canUpdate = ability.can('update', 'ticket')
  const canAssign = ability.can('assign', 'ticket')
  const canComment = ability.can('create', 'comment')
  const canNote = ability.can('create', 'note')
  const canUploadPhoto = ability.can('create', 'attachment')
  const canDeleteAnyPhoto = ability.can('delete', 'attachment')

  const resolvedStatus = statuses.find((s) => s.isResolved)

  const status = statuses.find((s) => String(s._id) === ticket.statusId)
  const priority = priorities.find((p) => String(p._id) === ticket.priorityId)
  const beforePhotoCount = photos.filter((photo) => photo.phase === 'before').length
  const afterPhotoCount = photos.filter((photo) => photo.phase === 'after').length
  const questionnaireCount = questionnaires.length
  // listQuestionnaires sorts createdAt ascending, so the last entry is the most recent submission.
  const latestQuestionnaire =
    questionnaires.length > 0 ? questionnaires[questionnaires.length - 1] : null
  const isResolved = Boolean(status?.isResolved)
  const isOverdue = Boolean(ticket.dueDate && !isResolved && new Date(ticket.dueDate) < new Date())
  const dueDateLabel = ticket.dueDate
    ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(ticket.dueDate),
      )
    : 'No due date'

  return (
    <>
      <Topbar title={`Ticket #${ticket.number}`} description={ticket.owner?.name ?? undefined} />

      <main className="flex-1 animate-fade-in px-4 pb-24 pt-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto max-w-[1280px] space-y-5">
          <Card className="overflow-hidden">
            <div className="border-b border-border bg-overlay/40 p-4 sm:p-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tracking-wide text-accent-strong">
                      #{ticket.number}
                    </span>
                    {status && (
                      <DynamicBadge label={status.name} color={status.color} dot={false} />
                    )}
                    {priority && <DynamicBadge label={priority.name} color={priority.color} />}
                  </div>
                  <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                    {ticket.subject}
                  </h1>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 text-sm text-muted-strong">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <UserRound className="h-4 w-4 shrink-0 text-muted" />
                      <span className="text-muted">Assignee</span>
                      <strong className="truncate font-medium text-foreground">
                        {ticket.assignee?.name ?? 'Unassigned'}
                      </strong>
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-2',
                        isOverdue && 'font-medium text-danger',
                      )}
                    >
                      <CalendarClock className="h-4 w-4 shrink-0" />
                      <span>{isOverdue ? 'Overdue' : 'Due'}</span>
                      <strong className="font-medium">{dueDateLabel}</strong>
                    </span>
                    {ticket.location && (
                      <span className="inline-flex items-center gap-2">
                        <MapPin className="h-4 w-4 shrink-0 text-muted" />
                        <strong className="font-medium text-foreground">
                          {ticket.location.classGroup}
                          {ticket.location.sectorNo !== null
                            ? ` · Sector ${ticket.location.sectorNo}`
                            : ''}
                        </strong>
                      </span>
                    )}
                  </div>
                  {ticket.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {ticket.tags.map((tag) => (
                        <Tag key={tag.id}>{tag.name}</Tag>
                      ))}
                    </div>
                  )}
                </div>

                {canComment && (
                  <div className="w-full shrink-0 xl:w-72">
                    <QuestionnaireEntry
                      ticketNumber={ticket.number}
                      hasExistingResponse={questionnaireCount > 0}
                      resolvedStatusId={resolvedStatus ? String(resolvedStatus._id) : null}
                      canUpdateStatus={canUpdate}
                      previousQuestionnaire={latestQuestionnaire}
                    />
                  </div>
                )}
              </div>
            </div>

            <section aria-labelledby="issue-heading" className="p-4 sm:p-6">
              <h2 id="issue-heading" className="text-base font-semibold text-foreground">
                Issue description
              </h2>
              <div
                className="mt-2 break-words text-sm leading-6 text-muted-strong [&_a]:break-all [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: ticket.issueHtml }}
              />
              {ticket.droneSevaUrl && (
                <a
                  href={ticket.droneSevaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ variant: 'secondary', size: 'sm' }),
                    'mt-4 min-h-11 max-w-full border-accent/30 bg-accent-soft text-accent-strong hover:bg-accent-soft/80',
                  )}
                >
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  <span className="truncate">View in DroneSeva</span>
                </a>
              )}
            </section>
          </Card>

          <Card className="p-4 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-accent-strong">Evidence workflow</p>
                <h2 className="mt-0.5 text-lg font-semibold text-foreground">
                  Complete the site record
                </h2>
              </div>
              <p className="text-sm text-muted">3 required stages</p>
            </div>
            <ol className="mt-5 grid gap-3 md:grid-cols-3">
              <WorkflowStage
                step={1}
                label="Before photo"
                count={beforePhotoCount}
                complete={beforePhotoCount > 0}
              />
              <WorkflowStage
                step={2}
                label="Questionnaire"
                count={questionnaireCount}
                complete={questionnaireCount > 0}
              />
              <WorkflowStage
                step={3}
                label="After photo"
                count={afterPhotoCount}
                complete={afterPhotoCount > 0}
              />
            </ol>
            {!isResolved &&
              (beforePhotoCount === 0 || questionnaireCount === 0 || afterPhotoCount === 0) && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft/40 px-3.5 py-3 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>Complete all evidence stages before resolving this ticket.</p>
                </div>
              )}
          </Card>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="order-1 min-w-0 space-y-5">
              {(canComment || photos.length > 0) && (
                <Card className="p-4 sm:p-6">
                  <div className="mb-5">
                    <h2 className="text-base font-semibold text-foreground">Site photos</h2>
                    <p className="mt-1 text-sm text-muted">
                      Add clear before and after evidence from the work site.
                    </p>
                  </div>
                  <SitePhotos
                    ticketNumber={ticket.number}
                    initialPhotos={photos}
                    currentUserId={user.id}
                    canUpload={canUploadPhoto}
                    canDeleteAny={canDeleteAnyPhoto}
                  />
                </Card>
              )}

              <Card className="p-4 sm:p-6">
                <h2 className="mb-4 text-base font-semibold text-foreground">Conversation</h2>
                <CommentThread
                  ticketNumber={ticket.number}
                  comments={comments}
                  questionnairesById={questionnairesById}
                  canComment={canComment}
                  canNote={canNote}
                />
              </Card>
            </div>

            <aside className="order-2 min-w-0 space-y-5 xl:sticky xl:top-24 xl:self-start">
              <Card className="p-5">
                <h2 className="mb-1 text-base font-semibold text-foreground">Ticket controls</h2>
                <p className="mb-5 text-sm text-muted">
                  Update ownership, timing, and classification.
                </p>
                <TicketDetailSidebar
                  ticketNumber={ticket.number}
                  statusId={ticket.statusId}
                  assignee={ticket.assignee}
                  priorityId={ticket.priorityId}
                  typeId={ticket.typeId}
                  dueDate={ticket.dueDate}
                  statuses={statuses.map((item) => ({
                    id: String(item._id),
                    name: item.name,
                    color: item.color,
                  }))}
                  priorities={priorities.map((item) => ({
                    id: String(item._id),
                    name: item.name,
                    color: item.color,
                  }))}
                  types={types.map((item) => ({ id: String(item._id), name: item.name }))}
                  users={users.map((item) => ({
                    id: String(item._id),
                    name: item.fullname || item.email || 'Unknown',
                  }))}
                  canUpdate={canUpdate}
                  canAssign={canAssign}
                />
              </Card>

              {ticket.location && (
                <Card className="p-5">
                  <h2 className="text-base font-semibold text-foreground">Location</h2>
                  <div className="mb-4 mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-strong">
                    <Tag>{ticket.location.classGroup}</Tag>
                    {ticket.location.sectorNo !== null && (
                      <span>Sector {ticket.location.sectorNo}</span>
                    )}
                  </div>
                  <TicketLocationMap lng={ticket.location.lng} lat={ticket.location.lat} />
                  <Link
                    href={`/?parcel=${ticket.location.sectorPlanId}&lng=${ticket.location.lng}&lat=${ticket.location.lat}&sector=${ticket.location.sectorNo ?? ''}`}
                    className={cn(
                      buttonVariants({ variant: 'secondary', size: 'sm' }),
                      'mt-3 min-h-11 w-full',
                    )}
                  >
                    <MapPin className="h-4 w-4" />
                    View on map
                  </Link>
                </Card>
              )}

              <Card className="p-5">
                <h2 className="mb-4 text-base font-semibold text-foreground">Activity</h2>
                <ActivityTimeline events={events} />
              </Card>
            </aside>
          </div>
        </div>
      </main>
    </>
  )
}

function WorkflowStage({
  step,
  label,
  count,
  complete,
}: {
  step: number
  label: string
  count: number
  complete: boolean
}) {
  return (
    <li
      className={cn(
        'flex min-h-20 items-center gap-3 rounded-xl border px-3.5 py-3',
        complete ? 'border-accent/30 bg-accent-soft/50' : 'border-border bg-overlay/40',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
          complete
            ? 'border-accent/40 bg-accent text-background'
            : 'border-border-strong bg-overlay-strong text-muted-strong',
        )}
        aria-hidden="true"
      >
        {complete ? <Check className="h-4 w-4" /> : step}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{label}</span>
        <span className={cn('block text-sm', complete ? 'text-accent-strong' : 'text-muted')}>
          {complete ? `Completed · ${count}` : 'Required · not started'}
        </span>
      </span>
    </li>
  )
}
