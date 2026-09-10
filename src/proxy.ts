import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// The App Service's default *.azurewebsites.net hostname can never be removed —
// it's the platform's permanent identity for this app and stays reachable
// alongside the custom domain. This redirects any request that doesn't arrive
// on the canonical custom domain, so the old URL still works but always lands
// users on kumbhdrishti.thecraftsync.com instead of serving content directly.
const CANONICAL_HOST = 'kumbhdrishti.thecraftsync.com'

export function proxy(request: NextRequest) {
  const host = request.headers.get('host')

  if (host && host !== CANONICAL_HOST) {
    const url = new URL(
      request.nextUrl.pathname + request.nextUrl.search,
      `https://${CANONICAL_HOST}`,
    )
    return NextResponse.redirect(url, 308)
  }

  return NextResponse.next()
}

export const config = {
  // Run on everything except static assets, image optimization, and common
  // metadata files — those should never be blocked by a host check.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
