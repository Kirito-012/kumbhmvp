// Keeps public/maplibre-gl-worker.mjs + public/maplibre-gl-shared.mjs in
// sync with the installed maplibre-gl version. See the comment in
// components/map/MapView.tsx for why this exists (Turbopack worker resolution).
import { copyFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist')
const destDir = path.join(__dirname, '..', 'public')

for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(path.join(srcDir, file), path.join(destDir, file))
}
console.log('Copied maplibre-gl worker files to public/')
