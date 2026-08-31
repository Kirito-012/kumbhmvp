import { NextResponse, type NextRequest } from 'next/server'
import { dbConnect } from '@/server/db/connect'
import { TicketTypeModel } from '@/server/db/models/ticket-type.model'
import { TicketPriorityModel } from '@/server/db/models/ticket-priority.model'
import { UserModel } from '@/server/db/models/user.model'
import { createIntegrationTicketSchema } from '@/lib/schemas/integration'
import { sanitizeHtml } from '@/lib/sanitize-html'
import { logger } from '@/lib/logger'
import * as ticketService from '@/server/services/ticket.service'

const INTEGRATION_TYPE_SLUG = 'garbage-detection'
const SERVICE_ACCOUNT_EMAIL = 'droneseva-bot@thecraftsync.local'

/**
 * POST /api/v1/tickets — service-to-service ticket creation for external integrations
 * (currently: DroneSeva's garbage-detection pipeline). Not a browser-session endpoint —
 * authenticated by a shared-secret header, not a cookie.
 *
 * Auth: `x-api-key: <INTEGRATION_API_KEY>`
 * Body: { subject, issue, priority?: 'low'|'normal'|'high'|'critical', sourceUrl?: string }
 * Creates an unassigned, default-status ticket of type "Garbage Detection", reported by a
 * seeded service-account user (see scripts/seed.ts) — never a real login.
 */
export async function POST(req: NextRequest) {
  const expectedKey = process.env.INTEGRATION_API_KEY
  if (!expectedKey) {
    logger.error('INTEGRATION_API_KEY is not configured — refusing all /api/v1/tickets requests')
    return NextResponse.json({ error: 'Integration API is not configured' }, { status: 503 })
  }

  const providedKey = req.headers.get('x-api-key')
  if (!providedKey || providedKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createIntegrationTicketSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  await dbConnect()

  const [type, priority, reporter] = await Promise.all([
    TicketTypeModel.findOne({ slug: INTEGRATION_TYPE_SLUG }).lean(),
    TicketPriorityModel.findOne({ slug: parsed.data.priority }).lean(),
    UserModel.findOne({ email: SERVICE_ACCOUNT_EMAIL, isActive: true }).lean(),
  ])

  if (!type || !priority || !reporter) {
    logger.error(
      { type: !!type, priority: !!priority, reporter: !!reporter },
      'Integration ticket creation misconfigured — run pnpm seed',
    )
    return NextResponse.json(
      { error: 'Server is missing required seed data (type/priority/service account)' },
      { status: 500 },
    )
  }

  // Sanitize the FULL combined string (not just the caller-supplied issue text) — the sourceUrl
  // link is string-concatenated HTML too, and this is the only sanitization pass before storage.
  const rawIssueHtml =
    parsed.data.issue +
    (parsed.data.sourceUrl
      ? `<p><a href="${parsed.data.sourceUrl}" target="_blank" rel="noopener noreferrer">View in DroneSeva</a></p>`
      : '')
  const issueHtml = sanitizeHtml(rawIssueHtml)

  const ticket = await ticketService.createTicket({
    subject: parsed.data.subject,
    issue: issueHtml,
    typeId: String(type._id),
    priorityId: String(priority._id),
    ownerId: String(reporter._id),
    source: 'api',
  })

  return NextResponse.json(
    { ticket: { number: ticket.number, id: String(ticket._id) } },
    { status: 201 },
  )
}
