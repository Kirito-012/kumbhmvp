import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/server/auth/auth.config'

// The App Service's default *.azurewebsites.net hostname can never be removed —
// it's the platform's permanent identity for this app and stays reachable
// alongside the custom domain. Any request that doesn't arrive on the canonical
// custom domain is redirected there, so the old URL still works but always lands
// users on kumbhdrishti.thecraftsync.com instead of serving content directly.
const CANONICAL_HOST = 'kumbhdrishti.thecraftsync.com'

// Provider-free NextAuth instance (see auth.config.ts) — only decodes the JWT
// session cookie for route guarding, keeping mongoose/bcrypt out of this bundle.
const { auth } = NextAuth(authConfig)

export default auth((request) => {
  const host = request.headers.get('host')

  if (host && host !== CANONICAL_HOST) {
    const url = new URL(
      request.nextUrl.pathname + request.nextUrl.search,
      `https://${CANONICAL_HOST}`,
    )
    return NextResponse.redirect(url, 308)
  }

  return NextResponse.next()
})

export const config = {
  // Run on everything except static assets, image optimization, common metadata
  // files, and /api/auth/* — that last one is Auth.js's own route handler
  // (src/app/api/auth/[...nextauth]/route.ts) and must reach it untouched. This
  // proxy wraps a *second*, provider-free NextAuth instance (see authConfig above)
  // purely to read the session cookie for route guarding; letting it also intercept
  // /api/auth/* makes it try to dispatch sign-in/callback/session actions itself,
  // which it can't do without providers — that surfaces as `UnknownAction` errors
  // and breaks login entirely.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
