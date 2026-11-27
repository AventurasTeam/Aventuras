import { expect, test, type Page } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

// Electron pops history on the mouse's Back button, and expo-router answers a pop with a reset at
// the root that no beforeRemove sees. Only the button itself takes that path (page.goBack() drives
// history directly), so CDP sends the press as the hardware does.
const HERO_STORY = 'story_hero'
const LEFT_DIRTY = 'E2E-MOUSE-BACK a title left unsaved'

async function mouseButton(page: Page, button: 'back' | 'forward'): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  for (const type of ['mousePressed', 'mouseReleased'] as const)
    await cdp.send('Input.dispatchMouseEvent', { type, x: 20, y: 20, button, clickCount: 1 })
  await cdp.detach()
}

async function storyTitle(page: Page): Promise<string> {
  const [[title]] = await queryApp(page, `SELECT title FROM stories WHERE id = ?`, [HERO_STORY])
  return title as string
}

test.describe.serial("the mouse's Back and Forward", () => {
  let app: LaunchedApp
  let userDataDir: string

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
    await expect(home.newStory(app.window)).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('Back asks before it leaves a dirty Story Settings draft, and waits on its dialog', async () => {
    const page = app.window
    const stored = await storyTitle(page)
    await home.openStory(page, stored).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await storySettings.openFromReader(page).click()
    await expect(storySettings.aboutPanel(page)).toBeVisible({ timeout: 20_000 })
    await storySettings.aboutTitle(page).fill(LEFT_DIRTY)

    await mouseButton(page, 'back')
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    // A Back under the open dialog neither leaves nor answers it.
    await mouseButton(page, 'back')
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedCancel(page).click()
    await expect(storySettings.unsavedDialog(page)).toBeHidden()
    await expect(storySettings.aboutTitle(page)).toHaveValue(LEFT_DIRTY)

    await mouseButton(page, 'back')
    await storySettings.unsavedDiscard(page).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 10_000 })
    expect(await storyTitle(page)).toBe(stored)
  })

  test('Forward goes nowhere, and Back from the reader returns to the library', async () => {
    const page = app.window
    const url = page.url()
    await mouseButton(page, 'forward')
    await expect(reader.composer(page)).toBeVisible()
    expect(page.url()).toBe(url)

    await mouseButton(page, 'back')
    await expect(home.newStory(page)).toBeVisible({ timeout: 10_000 })
  })
})
