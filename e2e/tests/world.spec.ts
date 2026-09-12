import { expect, test } from '@playwright/test'

import type { StorySettings, SuggestionCategory } from '@/lib/db'

import { currentBranchId, queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'
import { world } from '../locators/world'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'

// Serial suite, one shared app: later tests build on earlier ones' navigation state (a GO TO
// round trip must land on the same stack entry), mirroring reload-guard.spec.ts.
test.describe.serial('World panel', () => {
  let app: LaunchedApp
  let userDataDir: string

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  async function readStorySettings(): Promise<StorySettings> {
    const [[json]] = await queryApp(app.window, `SELECT settings FROM stories WHERE id = ?`, [
      HERO_STORY,
    ])
    return JSON.parse(json as string) as StorySettings
  }

  function firstByOrder(categories: readonly SuggestionCategory[]): SuggestionCategory {
    const first = [...categories].sort((a, b) => a.order - b.order)[0]
    if (first == null) throw new Error('seed has no suggestion categories')
    return first
  }

  // Precondition: reader already showing. Never call this from Home.
  async function dirtyGenerationTab(label: string): Promise<SuggestionCategory> {
    const page = app.window
    await storySettings.openFromReader(page).click()
    await storySettings.generationTab(page).click()
    await expect(storySettings.authoringAidsPanel(page)).toBeVisible()
    const original = firstByOrder((await readStorySettings()).suggestionCategories)
    await storySettings.categoryLabel(page, original.id).fill(label)
    await expect(storySettings.save(page)).toBeVisible()
    return original
  }

  test('opens from the reader, lists the branch, switches category, searches, selects', async () => {
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.actionsTrigger(app.window).click()
    await world.goToWorldRow(app.window).click()
    await app.window.waitForURL(/\/world\//)

    const branchId = await currentBranchId(app.window, HERO_STORY)
    const active = await queryApp(
      app.window,
      `SELECT name FROM entities WHERE branch_id = ? AND kind = 'character' AND status = 'active'`,
      [branchId],
    )
    for (const [name] of active) {
      await expect(world.row(app.window, name as string).first()).toBeVisible()
    }
    // The staged namesake sits in the collapsed Staged tier: one Brannoc row is mounted.
    await expect(world.row(app.window, 'Brannoc')).toHaveCount(1)
    await expect(world.reviewPill(app.window, 1)).toBeVisible()
    await expect(world.collisionStrip(app.window, 'Brannoc')).toBeVisible()

    // The seed's periodic_classifier delta for this row sits past the last reply's
    // boundary, so it renders `fresh` (world:detail.recentlyClassified) at boot.
    await world.row(app.window, 'Brannoc').click()
    await expect(world.detailName(app.window)).toHaveText('Brannoc')
    await expect(world.recentlyClassifiedBadge(app.window)).toBeVisible()

    await world.categoryTrigger(app.window).click()
    await world.categoryOption(app.window, 'lore').click()
    const loreTitles = await queryApp(app.window, `SELECT title FROM lore WHERE branch_id = ?`, [
      branchId,
    ])
    for (const [title] of loreTitles) {
      await expect(world.row(app.window, title as string)).toBeVisible()
    }

    await world.search(app.window, 'lore').fill('archivists')
    await expect(world.row(app.window, 'Origins of the Syndicate')).toBeVisible()
    await expect(world.row(app.window, 'The Veil')).toHaveCount(0)

    await world.row(app.window, 'Origins of the Syndicate').click()
    await expect(world.subHeader(app.window)).toContainText('Origins of the Syndicate')
  })

  // A GO TO round trip pops to the exact stack match: Story Settings' "Open World" returns to
  // the SAME World instance test 1 left on — its surviving selection proves nothing got pushed.
  test('GO TO reaches World from Story Settings, and World omits its own entry', async () => {
    const page = app.window
    await expect(world.subHeader(page)).toContainText('Origins of the Syndicate')

    await world.actionsTrigger(page).click()
    // A sibling check first, or a zero-count assertion could pass with the menu never open.
    await expect(world.goToStorySettingsRow(page)).toBeVisible()
    await expect(world.goToWorldRow(page)).toHaveCount(0)
    await world.goToStorySettingsRow(page).click()
    await page.waitForURL(/\/story-settings\//)

    await storySettings.actionsTrigger(page).click()
    await world.goToWorldRow(page).click()
    await page.waitForURL(/\/world\//)
    await expect(world.subHeader(page)).toContainText('Origins of the Syndicate')
  })

  // A replaced or duplicated reader instance would come back with an empty composer.
  test('a GO TO round trip keeps the same reader instance', async () => {
    const page = app.window
    await expect(world.subHeader(page)).toBeVisible()
    await world.actionsTrigger(page).click()
    await world.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await expect(reader.composer(page)).toHaveValue('')

    await reader.composer(page).fill('E2E draft survives')
    await reader.actionsTrigger(page).click()
    await world.goToWorldRow(page).click()
    await page.waitForURL(/\/world\//)

    await world.actionsTrigger(page).click()
    await world.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await expect(reader.composer(page)).toHaveValue('E2E draft survives')

    // Leave the composer clean for the tests that follow.
    await reader.composer(page).fill('')
  })

  // Pins that AppActionsMenu's beforeNavigate is the only prompt: useUnsavedChangesGuard's
  // usePreventRemove fires on the same pop and would double-prompt if Discard/Save hadn't
  // already cleared dirty state before the pop runs.
  test('a dirty Story Settings GO TO Discard shows one prompt and lands on the reader', async () => {
    const page = app.window
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await expect(reader.composer(page)).toHaveValue('')

    const original = await dirtyGenerationTab('E2E World GoTo Discard')

    await storySettings.actionsTrigger(page).click()
    await world.goToReaderRow(page).click()
    await expect(storySettings.unsavedDialog(page)).toBeVisible()

    const navigated = expect(
      page,
      'a second prompt or a stuck guard keeps us off the reader',
    ).toHaveURL(/\/reader-composer\//, { timeout: 15_000 })
    await storySettings.unsavedDiscard(page).click()
    await navigated

    await expect(storySettings.unsavedDialog(page)).toHaveCount(0)
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const after = await readStorySettings()
    expect(after.suggestionCategories.find((c) => c.id === original.id)?.label).toBe(original.label)
  })

  test('a dirty Story Settings GO TO Save shows one prompt and lands on the reader', async () => {
    const page = app.window
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })

    const original = await dirtyGenerationTab('E2E World GoTo Save')

    await storySettings.actionsTrigger(page).click()
    await world.goToReaderRow(page).click()
    await expect(storySettings.unsavedDialog(page)).toBeVisible()

    const navigated = expect(
      page,
      'a second prompt or a stuck guard keeps us off the reader',
    ).toHaveURL(/\/reader-composer\//, { timeout: 15_000 })
    await storySettings.unsavedSave(page).click()
    await navigated

    await expect(storySettings.unsavedDialog(page)).toHaveCount(0)
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const after = await readStorySettings()
    expect(after.suggestionCategories.find((c) => c.id === original.id)?.label).toBe(
      'E2E World GoTo Save',
    )
  })

  // The badge/pill chain (firstFlaggedRow -> category switch -> revealRow) is cross-surface —
  // only E2E reaches it. Scroll-into-view itself is covered by world-list-pane.stories.tsx.
  test('the review pill and collapsed-tier badge reveal the flagged row', async () => {
    const page = app.window
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await reader.actionsTrigger(page).click()
    await world.goToWorldRow(page).click()
    await page.waitForURL(/\/world\//)
    // Fresh World mount: Characters / All view, Active tier expanded by default.
    await expect(world.categoryTrigger(page)).toHaveText(t('world:categories.character'))

    const activeLabel = t('world:tiers.active')
    await world.tierHeader(page, activeLabel).click()
    await expect(world.row(page, 'Brannoc')).toHaveCount(0)
    await expect(world.tierBadge(page, activeLabel, 1)).toBeVisible()

    await world.tierBadge(page, activeLabel, 1).click()
    await expect(world.row(page, 'Brannoc')).toBeVisible()
    await expect(world.row(page, 'Brannoc')).toBeInViewport()

    await world.tierHeader(page, activeLabel).click()
    await expect(world.row(page, 'Brannoc')).toHaveCount(0)

    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'location').click()
    await expect(world.categoryTrigger(page)).toHaveText(t('world:categories.location'))

    await world.reviewPill(page, 1).click()
    await expect(world.categoryTrigger(page)).toHaveText(t('world:categories.character'))
    await expect(world.row(page, 'Brannoc')).toBeVisible()
    await expect(world.row(page, 'Brannoc')).toBeInViewport()
    await expect(world.tierHeader(page, activeLabel)).toHaveAttribute('aria-expanded', 'true')
  })

  // Actions → Add entity… is otherwise only smoke-covered; this exercises the real seam into
  // the `[+]` ImporterMenu's options, not just that the trigger renders.
  test('Actions → Add entity… opens the importer menu with its options', async () => {
    const page = app.window
    await expect(world.subHeader(page)).toBeVisible()

    await world.actionsTrigger(page).click()
    await world.addEntityRow(page).click()

    await expect(world.addMenuOption(page, 'blank')).toBeVisible()
    await expect(world.addMenuOption(page, 'fromJson')).toBeVisible()
    await expect(world.addMenuOption(page, 'fromVault')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(world.addMenuOption(page, 'blank')).toHaveCount(0)

    // A reopen exercises the route's addOpen state actually resetting, not just its initial open —
    // a controlled seam that silently no-ops on reopen is the failure mode this guards against.
    await world.actionsTrigger(page).click()
    await world.addEntityRow(page).click()
    await expect(world.addMenuOption(page, 'blank')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(world.addMenuOption(page, 'blank')).toHaveCount(0)
  })

  // Hand-written URL (docs/testing.md → Harness structure): no in-app path reaches a mid-session
  // kind/id selection, so the cold-mount reload IS the seam under test. Location (non-default
  // kind) also proves the route's entity-branch match (`e.kind === category`) and the detail
  // pane's entity half.
  test('a cold-mount deep link preselects the row', async () => {
    const page = app.window
    await expect(world.subHeader(page)).toBeVisible()

    const branchId = await currentBranchId(page, HERO_STORY)
    // Entity ids are UUID-substituted too (lib/ids/prefixes.ts) — read fresh, not hard-coded.
    const [[locationId]] = await queryApp(
      page,
      `SELECT id FROM entities WHERE branch_id = ? AND kind = 'location' AND name = 'The Drowned Market'`,
      [branchId],
    )

    await page.evaluate(
      ({ branchId, locationId }) => {
        window.history.replaceState(null, '', `/world/${branchId}?kind=location&id=${locationId}`)
      },
      { branchId, locationId: locationId as string },
    )

    const reloaded = page.waitForEvent('load')
    await reloadFromMain(app)
    await reloaded

    await expect(world.subHeader(page)).toContainText(t('world:categories.location'))
    await expect(world.subHeader(page)).toContainText('The Drowned Market')
    await expect(world.detailName(page)).toHaveText('The Drowned Market')

    // Known screen for anything appended after this test.
    await world.actionsTrigger(page).click()
    await world.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
  })
})

// Electron's `will-prevent-unload` fires a native `dialog` event, not Playwright's dialog API;
// dismissed to avoid a race with Playwright's own detection (playwright#36627) hanging a reload.
function suppressNativeUnloadDialogRace(app: LaunchedApp): void {
  app.window.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => {})
  })
}

const reloadFromMain = (app: LaunchedApp) =>
  app.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.reload()
  })
