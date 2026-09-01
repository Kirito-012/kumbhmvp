import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // jsdom (used server-side by isomorphic-dompurify, see src/lib/sanitize-html.ts, for
  // sanitizing comment/ticket HTML in Server Actions) is on Next.js's own auto-external
  // package list, but its output file trace still misses jsdom's own lazily-required
  // internal submodules on Vercel -- causing "Failed to load external module jsdom-<hash>"
  // 500s in production even though everything works locally (where the full node_modules
  // tree is always present). Forcing the whole package into every route's trace fixes it.
  outputFileTracingIncludes: {
    '/*': ['./node_modules/jsdom/**/*', './node_modules/isomorphic-dompurify/**/*'],
  },
}

export default nextConfig
