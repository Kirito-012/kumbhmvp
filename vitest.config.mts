import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Mirrors tsconfig.json's "@/*" -> "./src/*" path alias for vitest's own module resolution.
// Tests previously avoided the alias entirely (see ability.test.ts) rather than needing this;
// added so src/lib/questionnaire and src/lib/schemas tests can import sibling modules the same
// way the rest of the app does. Also scopes vitest to src/** so it doesn't try to collect
// e2e/*.spec.ts (those are Playwright specs, run via `pnpm e2e`, not `pnpm test`).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
