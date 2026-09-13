// Verifies an unpacked Next standalone artifact can actually resolve everything the
// server needs, without requiring a database.
//
// Why this exists: the deploy smoke test boots the artifact and asserts HTTP 200, but
// that cannot prove the database packages resolve. There is no database in CI, so any
// route touching one fails on ECONNREFUSED *before* it imports mongoose. That is
// exactly how a missing bson/lib/bson.cjs shipped green and crashed production on the
// first real request.
//
// Next externalizes some server dependencies into .next/node_modules/<pkg>-<hash>.
// Requiring each one here forces the same module graph the server loads lazily, so a
// missing transitive file throws MODULE_NOT_FOUND at build time instead of in prod.
//
// Usage: node scripts/verify-standalone-artifact.mjs [artifact-root]

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const require = createRequire(import.meta.url);

const externalsDir = resolve(root, '.next/node_modules');
if (!existsSync(externalsDir)) {
  console.error(`FATAL: ${externalsDir} does not exist; this is not a standalone artifact.`);
  process.exit(1);
}

const externals = readdirSync(externalsDir);
if (externals.length === 0) {
  console.error(`FATAL: no externalized packages found under ${externalsDir}.`);
  process.exit(1);
}

let failed = 0;
for (const name of externals) {
  try {
    require(resolve(externalsDir, name));
    console.log(`  loaded ${name}`);
  } catch (err) {
    const [firstLine] = String(err.message).split('\n');
    console.error(`FATAL: ${name} failed to load -- ${firstLine}`);
    failed++;
  }
}

// The tree must be flat and self-contained: a .pnpm store here means the artifact
// depends on a layout that only existed on the build machine.
if (existsSync(resolve(root, 'node_modules/.pnpm'))) {
  console.error('FATAL: node_modules/.pnpm exists; the shipped tree is not flat.');
  failed++;
}

if (failed > 0) {
  process.exit(1);
}
console.log(`Verified ${externals.length} externalized package(s).`);
