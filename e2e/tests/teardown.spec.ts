import { existsSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { openWorld } from '../flows/navigation'
import { launchApp } from '../harness/launch'
import { createSeededUserDataDir } from '../harness/seed'
import { saveSession } from '../locators/save-session'
import { world } from '../locators/world'

// e2e/harness/launch.ts → closeApp: a dirty pane arms main's close guard, which cancels the quit
// Playwright sends; teardown must still end the app and remove its temp userData.
test('closing over a dirty pane still ends the app and removes its userData', async () => {
  test.setTimeout(120_000)
  const { userDataDir } = createSeededUserDataDir()
  const app = await launchApp({ userDataDir, cleanupUserData: true })
  const page = app.window
  await openWorld(page, 'The Veilstone Courier')
  await world.categoryTrigger(page).click()
  await world.categoryOption(page, 'character').click()
  await world.row(page, 'Kael').click()
  await world.tab(page, 'identity').click()
  await world.description(page).fill('E2E dirty draft')
  await expect(saveSession.saveBarSave(page)).toBeVisible()

  const started = Date.now()
  await app.close()
  expect(Date.now() - started).toBeLessThan(60_000)
  expect(existsSync(userDataDir)).toBe(false)
})
