import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'

// A held key's auto-repeat goes to whatever takes focus, and the browser and RN-Web's
// PressResponder act on each keydown there
// (lessons-learned/keydown-focus-move-hands-off-key-repeat.md). Only the real keyboard sends a
// repeat the browser acts on; user-event's held keys carry `repeat: false`.
const HERO_STORY = 'story_hero'

async function heroRow(page: LaunchedApp['window']): Promise<{ title: string; status: string }> {
  const [[title, status]] = await queryApp(page, `SELECT title, status FROM stories WHERE id = ?`, [
    HERO_STORY,
  ])
  return { title: title as string, status: status as string }
}

test.describe('a held Enter', () => {
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

  test("on a story card's ⋯ opens its menu and runs no entry the menu focuses", async () => {
    const page = app.window
    const before = await heroRow(page)
    expect(before.status).toBe('active')

    await home.storyActions(page, before.title).focus()
    await page.keyboard.down('Enter')
    await expect(page.getByRole('menuitem').first()).toBeFocused()
    for (let repeat = 0; repeat < 6; repeat += 1) await page.keyboard.down('Enter')
    await page.keyboard.up('Enter')

    // An entry a repeat pressed closes the menu as it runs; Archive is the first.
    await expect(page.getByRole('menuitem').first()).toBeVisible()
    expect((await heroRow(page)).status).toBe('active')
  })
})
