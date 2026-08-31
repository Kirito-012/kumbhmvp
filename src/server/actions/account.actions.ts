'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAbility } from '@/server/auth/session'
import { createAccountSchema } from '@/lib/schemas/account'
import * as userService from '@/server/services/user.service'

export type ActionState = { error?: string } | undefined

export async function createAccountAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAbility({ action: 'create', subject: 'account' })

  const parsed = createAccountSchema.safeParse({
    fullname: formData.get('fullname'),
    email: formData.get('email'),
    password: formData.get('password'),
    roleId: formData.get('roleId'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  try {
    await userService.createUser(parsed.data)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to create account' }
  }

  revalidatePath('/accounts')
  redirect('/accounts')
}

export async function updateUserRoleAction(userId: string, roleId: string) {
  const { user } = await requireAbility({ action: 'update', subject: 'account' })
  // account:update also covers deactivating/approving accounts, which Managers can do too —
  // reassigning roles is Admin-only so a Manager can't promote themselves or anyone else.
  if (user.roleKey !== 'admin') redirect('/accounts')
  await userService.updateUserRole(userId, roleId)
  revalidatePath('/accounts')
}

export async function setUserActiveAction(userId: string, isActive: boolean) {
  await requireAbility({ action: 'update', subject: 'account' })
  await userService.setUserActive(userId, isActive)
  revalidatePath('/accounts')
}

export async function approveUserAction(userId: string) {
  await requireAbility({ action: 'update', subject: 'account' })
  await userService.approveUser(userId)
  revalidatePath('/accounts')
}

export async function rejectUserAction(userId: string) {
  await requireAbility({ action: 'update', subject: 'account' })
  await userService.rejectUser(userId)
  revalidatePath('/accounts')
}
