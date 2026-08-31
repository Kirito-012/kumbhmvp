import { z } from 'zod'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id')

export const createAccountSchema = z.object({
  fullname: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleId: objectId,
})

export type CreateAccountInput = z.infer<typeof createAccountSchema>
