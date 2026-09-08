import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Emit .next/standalone: Next copies only the files its build-time trace says the
  // server needs, including a pruned node_modules, plus a server.js that replaces
  // `next start`. This keeps the deployed tree small and — because the traced paths
  // and the shipped files are produced by the same build — self-consistent.
  output: 'standalone',
}

export default nextConfig
