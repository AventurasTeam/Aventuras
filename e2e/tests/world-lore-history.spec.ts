import { expect, test } from '@playwright/test'

import { currentBranchId, queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { world } from '../locators/world'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'

test.describe.serial('World lore', () => {
  let app: LaunchedApp
  let userDataDir: string

  test.beforeAll(async () => {
    userDataDir = createSeededUserDataDir().userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('a blank lore row saves with its body and shows its create in History', async () => {
    const page = app.window
    await home.openStory(page, HERO_TITLE).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await chrome.actionsTrigger(page).click()
    await chrome.goToWorldRow(page).click()
    await page.waitForURL(/\/world\//)
    const branchId = await currentBranchId(page, HERO_STORY)

    // Add lore… switches to Lore and opens the `[+]` menu in one update (world.spec.ts pins it).
    await chrome.actionsTrigger(page).click()
    await world.addLoreRow(page).click()
    await world.addMenuBlank(page).click()
    await world.nameTrigger(page).click()
    await world.nameInput(page).fill('The Drowned Bell')
    await world.nameInput(page).press('Enter')
    await world.loreBody(page).fill('A bell under the harbour rings before every flood.')
    await saveSession.saveBarSave(page).click()
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)

    const [[id, body]] = await queryApp(
      page,
      `SELECT id, body FROM lore WHERE branch_id = ? AND title = ?`,
      [branchId, 'The Drowned Bell'],
    )
    expect(body).toBe('A bell under the harbour rings before every flood.')

    await world.loreTab(page, 'history').click()
    await expect(world.historyRows(page)).toHaveCount(1)
    await expect(world.historyRows(page).first()).toContainText('create')
    await expect(world.historyRows(page).first()).toContainText('user')
    expect(await queryApp(page, `SELECT op FROM deltas WHERE target_id = ?`, [id])).toEqual([
      ['create'],
    ])
  })
})
