import NextAuth from 'next-auth'
import { authConfig } from '@/server/auth/auth.config'

// Lightweight NextAuth instance (no providers, no mongoose/bcrypt) purely for decoding the
// JWT session cookie on every request and running the `authorized` redirect logic.
const { auth } = NextAuth(authConfig)

export default auth

export const config = {
  // Run on everything except static assets, NextAuth's own routes, and api/v1 — the latter is
  // service-to-service (x-api-key auth in the route handler itself, see api/v1/tickets/route.ts),
  // not a browser session, so the session-cookie gate here would just redirect it to /login.
  // The trailing `|.*\..*` exclusion covers public/ static files (images, etc.) generically —
  // without it, any file served straight from public/ (e.g. /dashboard/some-image.png) falls
  // through to this matcher and gets redirected to /login like a protected page route.
  matcher: ['/((?!api/auth|api/v1|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
