import { z } from 'zod'

// Deliberately NOT an arbitrary roleId — a public endpoint must never let the caller name a
// specific role document (e.g. Admin's _id). Restricted to the two self-serviceable roles by
// fixed key; the server resolves key -> roleId itself. See user.service.ts registerPendingUser.
export const registerSchema = z.object({
  fullname: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleKey: z.enum(['manager', 'agent'], { message: 'Choose a role' }),
})

export type RegisterInput = z.infer<typeof registerSchema>
