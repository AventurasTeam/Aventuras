import { expect, test, type Page } from '@playwright/test'

import { openWorld } from '../flows/navigation'
import { queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir, seedUnplacedPlace } from '../harness/seed'
import { saveSession } from '../locators/save-session'
import { world } from '../locators/world'

// world.md → Overview and Delete; data-model.md → LocationState shape. Places are seeded unplaced
// (the fixture has none); state is read back as parsed JSON, so key order decides no pin.

const HERO_TITLE = 'The Veilstone Courier'
const HERO_BRANCH = 'br_hero_main'
const SALTMERE = 'E2E Saltmere'
const WHARF = 'E2E Smugglers Wharf'

async function placeState(page: Page, id: string): Promise<unknown> {
  const rows = await queryApp(page, `SELECT state FROM entities WHERE branch_id = ? AND id = ?`, [
    HERO_BRANCH,
    id,
  ])
  const raw = rows[0]?.[0]
  return typeof raw === 'string' ? JSON.parse(raw) : null
}

async function savePane(page: Page): Promise<void> {
  await saveSession.saveBarSave(page).click()
  await expect(saveSession.saveBarSave(page)).toHaveCount(0)
}

// Serial, one shared app: each test continues from the last one's World selection.
test.describe.serial('World — unplaced places', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let saltmereId = ''
  let wharfId = ''

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    saltmereId = seedUnplacedPlace(seeded.dbPath, HERO_BRANCH, SALTMERE)
    wharfId = seedUnplacedPlace(seeded.dbPath, HERO_BRANCH, WHARF)
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test("an unplaced place's picker reads Unknown, and Top level places it", async () => {
    const page = app.window
    await openWorld(page, HERO_TITLE)
    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'location').click()
    await world.row(page, SALTMERE).click()
    await expect(world.detailName(page)).toHaveText(SALTMERE)

    await world.tab(page, 'connections').click()
    await world.placementPicker(page, t('world:connections.placementUnknown')).click()
    await world.placementOption(page, t('world:connections.placementTopLevel')).click()
    await savePane(page)
    expect(await placeState(page, saltmereId)).toEqual({ parent_location_id: null })
  })

  test('the picker places an unplaced place under a parent', async () => {
    const page = app.window
    await world.row(page, WHARF).click()
    await expect(world.detailName(page)).toHaveText(WHARF)
    await world.tab(page, 'connections').click()
    await world.placementPicker(page, t('world:connections.placementUnknown')).click()
    await world.placementOption(page, SALTMERE).click()
    await savePane(page)
    expect(await placeState(page, wharfId)).toEqual({ parent_location_id: saltmereId })
  })

  test('deleting a parent leaves the place inside unplaced', async () => {
    const page = app.window
    await world.row(page, SALTMERE).click()
    await expect(world.detailName(page)).toHaveText(SALTMERE)
    await world.moreActions(page).click()
    await world.deleteEntityItem(page).click()
    await world.deleteConfirm(page, 'location').click()
    await expect
      .poll(() => placeState(page, wharfId), { timeout: 15_000 })
      .toEqual({ parent_location_id: null, unplaced: true })
    expect(await placeState(page, saltmereId)).toBeNull()
  })
})
