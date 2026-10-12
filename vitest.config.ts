import { defineConfig } from 'vitest/config'

// Deliberately does NOT use the sveltekit() plugin: these are plain unit tests of TS logic, and
// pulling in the full SvelteKit pipeline would make them slow to run and easy to break. `#lib`
// resolves through the `imports` field in package.json.
export default defineConfig({
  test: {
    environment: 'node',
    // `scripts/` for the release script's version arithmetic. Plain `.js`: not built.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.js'],
  },
})
