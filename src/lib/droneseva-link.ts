// Matches the exact `<p><a ...>View in DroneSeva</a></p>` snippet appended to `issue` HTML at
// creation time (see src/app/api/v1/tickets/route.ts) — not a general HTML parser, just enough
// to pull that one integration link back out so it can be rendered as its own button instead of
// buried in the prose.
const DRONESEVA_LINK_RE =
  /<p>\s*<a\s+[^>]*href="([^"]+)"[^>]*>\s*View in DroneSeva\s*<\/a>\s*<\/p>/i

/**
 * The DroneSeva portal's own URL (and port) can change independently of when a ticket was
 * created — rewriting the origin here, instead of at storage time, means every ticket (old or
 * new) always links to wherever the portal currently lives.
 */
function rewriteOrigin(url: string) {
  const origin = (process.env.DRONESEVA_PORTAL_ORIGIN ?? 'http://localhost:3010').replace(/\/$/, '')
  try {
    const parsed = new URL(url)
    return origin + parsed.pathname + parsed.search + parsed.hash
  } catch {
    return url
  }
}

/** Splits the "View in DroneSeva" link out of a ticket's issue HTML, if present. */
export function extractDroneSevaLink(issueHtml: string): {
  html: string
  droneSevaUrl: string | null
} {
  const match = issueHtml.match(DRONESEVA_LINK_RE)
  if (!match || match.index === undefined) return { html: issueHtml, droneSevaUrl: null }

  const html = (
    issueHtml.slice(0, match.index) + issueHtml.slice(match.index + match[0].length)
  ).trim()
  return { html, droneSevaUrl: rewriteOrigin(match[1]) }
}
