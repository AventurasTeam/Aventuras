import { defineConfig } from 'vitest/config'

// No sveltekit() plugin: plain unit tests of TS logic stay fast. `#lib` resolves through the
// `imports` field in package.json.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.{js,ts}'],
  },
})
