import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Deliberately does NOT use the sveltekit() plugin: these are plain unit tests of TS logic, and
// pulling in the full SvelteKit pipeline would make them slow to run and easy to break. Only the
// $lib alias is needed, so it is resolved by hand.
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
