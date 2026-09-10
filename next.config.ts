import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Emit .next/standalone: Next copies only the files its build-time trace says the
  // server needs, including a pruned node_modules, plus a server.js that replaces
  // `next start`. This keeps the deployed tree small and — because the traced paths
  // and the shipped files are produced by the same build — self-consistent.
  output: 'standalone',
  images: {
    // Surveyor-uploaded Before/After site photos are hosted on Cloudinary and rendered via
    // next/image (see SitePhotos.tsx) using delivery-transform URLs (f_auto,q_auto,w_*).
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
}

export default nextConfig
