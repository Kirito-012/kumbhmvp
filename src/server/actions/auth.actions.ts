'use server'

import { AuthError } from 'next-auth'
import bcrypt from 'bcryptjs'
import { signIn, signOut } from '@/server/auth/auth'
import { dbConnect } from '@/server/db/connect'
import { UserModel } from '@/server/db/models/user.model'
import { registerSchema } from '@/lib/schemas/register'
import * as userService from '@/server/services/user.service'

export type LoginState = { error?: string } | undefined

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const password = String(formData.get('password') ?? '')

  // Friendlier messaging pass — auth.ts's authorize() is the actual security boundary and
  // blocks pending/rejected accounts regardless of this; this just tells a real, correctly-
  // authenticating user WHY they're being denied instead of a generic "invalid credentials".
  if (email && password) {
    await dbConnect()
    const user = await UserModel.findOne({ email, deletedAt: null })
    if (user && (await bcrypt.compare(password, user.passwordHash))) {
      if (user.status === 'pending') {
        return {
          error:
            "Your account is awaiting admin approval — you'll be able to sign in once it's approved.",
        }
      }
      if (user.status === 'rejected') {
        return { error: 'Your account request was not approved. Contact an admin for help.' }
      }
    }
  }

  try {
    await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirectTo: '/dashboard',
    })
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return { error: 'Invalid email or password.' }
        default:
          return { error: 'Something went wrong. Please try again.' }
      }
    }
    // NEXT_REDIRECT is thrown on success — let it propagate.
    throw error
  }
}

export async function logout() {
  await signOut({ redirectTo: '/login' })
}

export type RegisterState = { error?: string; success?: boolean } | undefined

/** Public — anyone can call this. Creates a status:'pending' account; see registerPendingUser(). */
export async function registerAction(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = registerSchema.safeParse({
    fullname: formData.get('fullname'),
    email: formData.get('email'),
    password: formData.get('password'),
    roleKey: formData.get('roleKey'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  try {
    await userService.registerPendingUser(parsed.data)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to create account' }
  }

  return { success: true }
}
