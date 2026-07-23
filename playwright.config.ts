import { defineConfig } from '@playwright/test'

// E2E runner, separate from Vitest (which owns unit + Storybook). Tests drive a
// real Electron app; the harness launches it, so there is no global webServer.
// See docs/testing.md.
export default defineConfig({
  testDir: './e2e/tests',
  testMatch: '**/*.spec.ts',
  // Electron launch + seed are heavy; keep runs serial until the suite grows a
  // per-worker fixture story (docs/testing.md → Fixture + seed contract).
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
})
