import { expect, test } from '@playwright/test'

import { currentBranchId, queryApp, seedVectors, vecCounts } from '../harness/db'
import { t } from '../harness/i18n'
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
    await expect(world.historyRows(page).first()).toContainText('The Drowned Bell')
    await expect(world.historyRows(page).first()).toContainText(t('history:op.create'))
    expect(
      await queryApp(page, `SELECT op, source, target_table FROM deltas WHERE target_id = ?`, [id]),
    ).toEqual([['create', 'user_edit', 'lore']])
  })

  test('Delete removes the lore row with its translations and vectors', async () => {
    const page = app.window
    const branchId = await currentBranchId(page, HERO_STORY)
    const [[loreId]] = await queryApp(
      page,
      `SELECT id FROM lore WHERE branch_id = ? AND title = ?`,
      [branchId, 'The Drowned Bell'],
    )
    const id = loreId as string
    await seedVectors(page, 'lore', branchId, id)
    await queryApp(
      page,
      `INSERT INTO translations (id, branch_id, target_kind, target_id, field, language, translated_text, created_at, updated_at)
       VALUES (?, ?, 'lore', ?, 'body', 'es', 'Una campana bajo el puerto.', 1, 1)`,
      ['e2e_translation_bell', branchId, id],
    )
    const footprint = async () => ({
      lore: (
        await queryApp(page, `SELECT id FROM lore WHERE branch_id = ? AND id = ?`, [branchId, id])
      ).length,
      translations: (
        await queryApp(
          page,
          `SELECT id FROM translations WHERE branch_id = ? AND target_kind = 'lore' AND target_id = ?`,
          [branchId, id],
        )
      ).length,
      vectors: await vecCounts(page, 'lore', branchId, id),
    })
    expect(await footprint()).toEqual({ lore: 1, translations: 1, vectors: { 384: 1, 8: 1 } })

    // The prior test's Save left this row open.
    await world.moreActions(page).click()
    await world.menuItem(page, 'deleteLore').click()
    await world.deleteConfirm(page, 'lore').click()

    await expect
      .poll(footprint, { timeout: 15_000 })
      .toEqual({ lore: 0, translations: 0, vectors: { 384: 0, 8: 0 } })
    expect(
      await queryApp(
        page,
        `SELECT op, source, target_table FROM deltas WHERE target_id = ? ORDER BY log_position`,
        [id],
      ),
    ).toEqual([
      ['create', 'user_edit', 'lore'],
      ['delete', 'user_edit', 'lore'],
    ])
  })
})
