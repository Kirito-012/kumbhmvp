import 'server-only'

import bcrypt from 'bcryptjs'
import { dbConnect } from '@/server/db/connect'
import { UserModel } from '@/server/db/models/user.model'
import { RoleModel } from '@/server/db/models/role.model'

/** Everyone except pending signups — the Accounts page's main table. */
export async function listUsers() {
  await dbConnect()
  const users = await UserModel.find({ deletedAt: null, status: { $ne: 'pending' } })
    .sort({ createdAt: -1 })
    .populate({ path: 'roleId', select: 'key name' })
    .lean()
  return users
}

/** Accounts awaiting Admin approval — surfaced at the top of the Accounts page. */
export async function listPendingUsers() {
  await dbConnect()
  const users = await UserModel.find({ deletedAt: null, status: 'pending' })
    .sort({ createdAt: -1 })
    .populate({ path: 'roleId', select: 'key name' })
    .lean()
  return users
}

export async function listRoles() {
  await dbConnect()
  return RoleModel.find().sort({ rank: 1 }).lean()
}

export async function createUser(input: {
  fullname: string
  email: string
  password: string
  roleId: string
}) {
  await dbConnect()

  const existing = await UserModel.findOne({ email: input.email.toLowerCase() }).lean()
  if (existing) throw new Error('An account with that email already exists.')

  const passwordHash = await bcrypt.hash(input.password, 12)
  return UserModel.create({
    email: input.email.toLowerCase(),
    passwordHash,
    fullname: input.fullname,
    roleId: input.roleId,
    isActive: true,
  })
}

export async function updateUserRole(userId: string, roleId: string) {
  await dbConnect()
  await UserModel.updateOne({ _id: userId }, { $set: { roleId } })
}

export async function setUserActive(userId: string, isActive: boolean) {
  await dbConnect()
  await UserModel.updateOne({ _id: userId }, { $set: { isActive } })
}

/**
 * Public self-registration — creates a `status: 'pending'` account that cannot sign in (see
 * auth.ts) until an Admin calls approveUser(). roleKey is restricted to 'manager' | 'agent' by
 * the caller's Zod schema (src/lib/schemas/register.ts); re-checked here too since this is the
 * one service function reachable by an unauthenticated caller.
 */
export async function registerPendingUser(input: {
  fullname: string
  email: string
  password: string
  roleKey: 'manager' | 'agent'
}) {
  await dbConnect()

  const existing = await UserModel.findOne({ email: input.email.toLowerCase() }).lean()
  if (existing) throw new Error('An account with that email already exists.')

  const role = await RoleModel.findOne({ key: input.roleKey }).lean()
  if (!role) throw new Error('That role is not available for self-registration.')

  const passwordHash = await bcrypt.hash(input.password, 12)
  return UserModel.create({
    email: input.email.toLowerCase(),
    passwordHash,
    fullname: input.fullname,
    roleId: role._id,
    isActive: true,
    status: 'pending',
  })
}

export async function approveUser(userId: string) {
  await dbConnect()
  await UserModel.updateOne({ _id: userId }, { $set: { status: 'active' } })
}

export async function rejectUser(userId: string) {
  await dbConnect()
  await UserModel.updateOne({ _id: userId }, { $set: { status: 'rejected' } })
}
