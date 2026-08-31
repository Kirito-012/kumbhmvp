import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { dbConnect } from '@/server/db/connect'
import { UserModel } from '@/server/db/models/user.model'
import { RoleModel } from '@/server/db/models/role.model'
import { authConfig } from '@/server/auth/auth.config'

const credentialsSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null

        await dbConnect()
        const user = await UserModel.findOne({
          email: parsed.data.email.toLowerCase(),
          deletedAt: null,
          isActive: true,
        })
        if (!user) return null

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash)
        if (!valid) return null

        // The authoritative block on pending/rejected self-registrations — the friendlier
        // "awaiting approval" message is a separate pre-check in the login Server Action
        // (src/server/actions/auth.actions.ts); this is what actually stops the sign-in
        // regardless of how the credentials endpoint is reached. Missing `status` (accounts
        // created before this field existed) is treated as 'active'.
        if (user.status && user.status !== 'active') return null

        const role = await RoleModel.findById(user.roleId).lean()
        await UserModel.updateOne({ _id: user._id }, { lastLoginAt: new Date() })

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.fullname,
          image: user.avatarUrl ?? null,
          roleKey: role?.key ?? 'customer',
          roleName: role?.name ?? 'Customer',
          grants: role?.grants ?? [],
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      if (user) {
        token.roleKey = user.roleKey
        token.roleName = user.roleName
        token.grants = user.grants
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.sub!
      session.user.roleKey = (token.roleKey as string) ?? 'customer'
      session.user.roleName = (token.roleName as string) ?? 'Customer'
      session.user.grants = (token.grants as string[]) ?? []
      return session
    },
  },
})
