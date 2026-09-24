import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Emit .next/standalone: Next copies only the files its build-time trace says the
  // server needs, including a pruned node_modules, plus a server.js that replaces
  // `next start`. This keeps the deployed tree small and — because the traced paths
  // and the shipped files are produced by the same build — self-consistent.
  output: 'standalone',
  // Files in public/ are served with `Cache-Control: public, max-age=0` by default, because their
  // paths are unhashed and Next cannot know when they change. For this app that default is
  // expensive: the vendored MapLibre worker pair and the vendored basemap style JSONs are 593 KB on
  // the map's critical path (maplibre-gl-shared.mjs alone is 476 KB), and every map load paid a
  // conditional revalidation round-trip for each of them.
  //
  // Deliberately NOT `immutable`: the worker imports maplibre-gl-shared.mjs by *relative* path
  // (which is why scripts/copy-maplibre-worker.mjs keeps them in the same directory), so a cache
  // buster on the worker URL alone could not bust its sibling -- a year-long `immutable` could pin
  // a visitor to a mismatched worker/shared pair across a maplibre upgrade. A day of `max-age` plus
  // a week of `stale-while-revalidate` removes the per-load round-trip while keeping the worst case
  // to a week, and needs no coordination with the postinstall copy step.
  async headers() {
    return [
      {
        source:
          '/:file(maplibre-gl-worker\.mjs|maplibre-gl-shared\.mjs|maptiler-bright-style\.json|carto-dark-matter-style\.json|carto-positron-style\.json)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ]
  },
  images: {
    // Surveyor-uploaded Before/After site photos are hosted on Cloudinary and rendered via
    // next/image (see SitePhotos.tsx) using delivery-transform URLs (f_auto,q_auto,w_*).
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
}

export default nextConfig
