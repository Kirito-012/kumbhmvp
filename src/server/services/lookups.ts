import 'server-only'

import { cache } from 'react'
import { dbConnect } from '@/server/db/connect'
import { TicketStatusModel } from '@/server/db/models/ticket-status.model'
import { TicketPriorityModel } from '@/server/db/models/ticket-priority.model'
import { TicketTypeModel } from '@/server/db/models/ticket-type.model'

/**
 * Per-render readers for the three lookup tables.
 *
 * These collections hold a handful of documents each, seeded once by `scripts/seed.ts`, and almost
 * every ticket page needs at least two of them — but each call site used to issue its own query.
 * On `/tickets` that meant `TicketStatusModel.find()` running three times for one request (the
 * route-group layout's sidebar counts, the page's own filter dropdowns, and `countTicketsByStatus`
 * inside the service) and `TicketPriorityModel.find()` twice, so 3 avoidable Atlas round-trips —
 * tens of milliseconds each from Azure — sat on the critical path of the page's first byte.
 *
 * React `cache()` dedupes them for the duration of a single render pass and nothing longer, so
 * there is no cross-request staleness to reason about. Same primitive, and the same reasoning, as
 * `getSession()` in `src/server/auth/session.ts`.
 *
 * `dbConnect()` is called inside each one rather than left to the caller, so these are safe to use
 * from a page that has not connected yet; it is itself idempotent and cached on `globalThis`.
 */
export const getStatuses = cache(async () => {
  await dbConnect()
  return TicketStatusModel.find().sort({ order: 1 }).lean()
})

export const getPriorities = cache(async () => {
  await dbConnect()
  return TicketPriorityModel.find().sort({ order: 1 }).lean()
})

/** Only active types, name-sorted -- the shape both the new-ticket form and the ticket detail
 *  page's type dropdown need. An inactive type stays readable on tickets that already carry it;
 *  it just isn't offered as a choice. */
export const getTypes = cache(async () => {
  await dbConnect()
  return TicketTypeModel.find({ isActive: true }).sort({ name: 1 }).lean()
})
