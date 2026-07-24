import { defineConfig } from '@playwright/test'

// E2E runner, separate from Vitest (which owns unit + Storybook). Tests drive a
// real Electron app; the harness launches it, so there is no global webServer.
// Launch mode is a project, not an env var — the harness reads the project name
// (dev | packaged). Run one with `--project=<name>`; the package scripts do.
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
  // A real app launched serially per spec has occasional window/IPC timing
  // hiccups; one retry absorbs a transient without masking a real failure
  // (a bug fails both attempts).
  retries: 1,
  // Deterministic: the github reporter is a no-op outside GitHub Actions, so
  // both run everywhere without an env check.
  reporter: [['list'], ['github']],
  projects: [{ name: 'dev' }, { name: 'packaged' }],
})
