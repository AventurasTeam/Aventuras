import { availableParallelism } from 'node:os'

import { defineConfig } from '@playwright/test'

// E2E runner, separate from Vitest (which owns unit + Storybook). Tests drive a
// real Electron app; the harness launches it, so there is no global webServer.
// Launch mode is a project, not an env var — the harness reads the project name
// (dev | packaged). Run one with `--project=<name>`; the package scripts do.
// See docs/testing.md.

// Half the cores, capped: past the cap a run waits on its longest file, and dev
// slots share the machine.
const WORKERS_CAP = 8
const defaultWorkers = Math.max(1, Math.min(WORKERS_CAP, Math.floor(availableParallelism() / 2)))

// A count or a percentage of the cores. Playwright's config refuses a numeric string.
function workersFromEnv(raw: string | undefined): number | string | undefined {
  if (raw === undefined || raw === '') return undefined
  if (/^\d+%$/.test(raw)) return raw
  const count = Number(raw)
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`E2E_WORKERS must be a positive count or a percentage, not "${raw}"`)
  }
  return count
}

export default defineConfig({
  testDir: './e2e/tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  // Parallel only when each launch gets its own virtual display: real windows on
  // one screen take the focus from each other (docs/testing.md → Workers).
  workers:
    workersFromEnv(process.env.E2E_WORKERS) ??
    (process.env.E2E_VIRTUAL_DISPLAY === '1' ? defaultWorkers : 1),
  // A file's tests share the app its beforeAll launched, so files are the unit.
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Absorbs a real app's window/IPC timing hiccup without masking a bug, which
  // fails both attempts.
  retries: 1,
  // Deterministic: the github reporter is a no-op outside GitHub Actions, so
  // both run everywhere without an env check.
  reporter: [['list'], ['github']],
  projects: [{ name: 'dev' }, { name: 'packaged' }],
})
