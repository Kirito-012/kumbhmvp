import { z } from 'zod'

/** Payload for POST /api/v1/tickets — external integrations (e.g. DroneSeva). */
export const createIntegrationTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(200),
  issue: z.string().trim().min(1, 'Description is required'),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  // Ends up as a raw href in sanitized HTML — restrict to http(s) so a javascript: scheme
  // (which z.string().url() alone would still accept) can never get through.
  sourceUrl: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), 'sourceUrl must be http(s)')
    .optional(),
})

export type CreateIntegrationTicketInput = z.infer<typeof createIntegrationTicketSchema>
