import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // jsdom (used server-side by isomorphic-dompurify, see src/lib/sanitize-html.ts, for
  // sanitizing comment/ticket HTML in Server Actions) is on Next.js's own auto-external
  // package list, but its output file trace still misses jsdom's own lazily-required
  // internal submodules on Vercel -- causing "Failed to load external module jsdom-<hash>"
  // 500s in production even though everything works locally. Explicitly externalizing it
  // here makes Next.js require() it at runtime via Node's normal module resolution
  // (which follows pnpm's symlinked node_modules correctly) instead of trying to
  // statically trace/copy its files -- outputFileTracingIncludes with a **/* glob was
  // tried first but broke deployment entirely ("invalid deployment package... files in
  // symlinked directories") since jsdom's own nested deps are pnpm symlinks on Vercel's
  // Linux build image.
  serverExternalPackages: ['jsdom', 'isomorphic-dompurify'],
}

export default nextConfig
