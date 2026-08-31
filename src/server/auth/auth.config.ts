import type { NextAuthConfig } from 'next-auth'

/**
 * Provider-free base config, reused by both the full auth.ts (Credentials + DB lookups)
 * and a lightweight NextAuth instance used in proxy.ts for route guarding. Keeping proxy's
 * instance free of mongoose/bcrypt keeps that bundle small — it only needs to decode the
 * JWT cookie, not hit the database.
 */
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user
      const { pathname } = request.nextUrl
      const isAuthPage = pathname === '/login' || pathname === '/register'

      if (isAuthPage) {
        if (isLoggedIn) return Response.redirect(new URL('/dashboard', request.url))
        return true
      }

      return isLoggedIn
    },
  },
} satisfies NextAuthConfig
