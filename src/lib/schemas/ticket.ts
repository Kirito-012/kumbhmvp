import { z } from 'zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(200),
  issue: z.string().trim().min(1, 'Description is required'),
  typeId: objectId,
  priorityId: objectId,
  tagIds: z.array(objectId).optional(),
})

export type CreateTicketInput = z.infer<typeof createTicketSchema>

export const updateTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200).optional(),
  statusId: objectId.optional(),
  assigneeId: z.union([objectId, z.null()]).optional(),
  priorityId: objectId.optional(),
  typeId: objectId.optional(),
  dueDate: z.union([z.string(), z.null()]).optional(),
})

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>

export const addCommentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty'),
  isInternal: z.boolean().default(false),
})

export type AddCommentInput = z.infer<typeof addCommentSchema>
