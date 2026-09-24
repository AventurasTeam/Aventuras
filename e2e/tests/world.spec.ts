import { expect, test, type Page } from '@playwright/test'

import type { StorySettings, SuggestionCategory } from '@/lib/db'

import { currentBranchId, queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import {
  expectCloseGuardArmed,
  reloadFromMain,
  suppressNativeUnloadDialogRace,
  watchCloseGuard,
} from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { storySettings } from '../locators/story-settings'
import { world } from '../locators/world'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'

async function entityId(page: Page, branchId: string, name: string): Promise<string> {
  const [[id]] = await queryApp(page, `SELECT id FROM entities WHERE branch_id = ? AND name = ?`, [
    branchId,
    name,
  ])
  return id as string
}

type EntitySnapshot = {
  description: unknown
  tags: string[]
  state: { visual?: { hair?: string } }
}

// JSON columns parsed, so a round trip compares values, not serializations.
async function entitySnapshot(page: Page, id: string): Promise<EntitySnapshot> {
  const [[description, tags, state]] = await queryApp(
    page,
    `SELECT description, tags, state FROM entities WHERE id = ?`,
    [id],
  )
  return {
    description,
    tags: JSON.parse(tags as string) as string[],
    state: JSON.parse(state as string) as EntitySnapshot['state'],
  }
}

// Reader → World over GO TO. The round trip pops to the World instance already on the stack, which
// keeps its category and selection, so callers pick the category they need.
async function goToWorld(page: Page): Promise<string> {
  await chrome.actionsTrigger(page).click()
  await chrome.goToWorldRow(page).click()
  await page.waitForURL(/\/world\//)
  return currentBranchId(page, HERO_STORY)
}

async function openWorldFromHome(app: LaunchedApp): Promise<void> {
  await home.openStory(app.window, HERO_TITLE).click()
  await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
  await goToWorld(app.window)
}

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
    await chrome.actionsTrigger(app.window).click()
    await chrome.goToWorldRow(app.window).click()
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

    // The strip link jumps to the staged namesake, which isn't recently classified: selected,
    // and revealed by expanding Staged. Staged is shut again after, as the later tests expect.
    const stagedLabel = t('world:tiers.staged')
    await world.collisionStrip(app.window, 'Brannoc').click()
    await expect(world.tierHeader(app.window, stagedLabel)).toHaveAttribute('aria-expanded', 'true')
    await expect(world.row(app.window, 'Brannoc')).toHaveCount(2)
    await expect(world.detailName(app.window)).toHaveText('Brannoc')
    await expect(world.recentlyClassifiedBadge(app.window)).toHaveCount(0)
    await world.tierHeader(app.window, stagedLabel).click()
    await expect(world.tierHeader(app.window, stagedLabel)).toHaveAttribute(
      'aria-expanded',
      'false',
    )

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

    await chrome.actionsTrigger(page).click()
    // A sibling check first, or a zero-count assertion could pass with the menu never open.
    await expect(chrome.goToStorySettingsRow(page)).toBeVisible()
    await expect(chrome.goToWorldRow(page)).toHaveCount(0)
    await chrome.goToStorySettingsRow(page).click()
    await page.waitForURL(/\/story-settings\//)

    await chrome.actionsTrigger(page).click()
    await chrome.goToWorldRow(page).click()
    await page.waitForURL(/\/world\//)
    await expect(world.subHeader(page)).toContainText('Origins of the Syndicate')
  })

  // A replaced or duplicated reader instance would come back with an empty composer.
  test('a GO TO round trip keeps the same reader instance', async () => {
    const page = app.window
    await expect(world.subHeader(page)).toBeVisible()
    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await expect(reader.composer(page)).toHaveValue('')

    await reader.composer(page).fill('E2E draft survives')
    await chrome.actionsTrigger(page).click()
    await chrome.goToWorldRow(page).click()
    await page.waitForURL(/\/world\//)

    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
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

    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
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

    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
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
    await chrome.actionsTrigger(page).click()
    await chrome.goToWorldRow(page).click()
    await page.waitForURL(/\/world\//)
    // A fresh World instance starts on Characters, but tier collapse is session-scoped: this
    // relies on the earlier tests leaving Active open and Staged shut.
    await expect(world.categoryTrigger(page)).toHaveText(t('world:categories.character'))
    const activeLabel = t('world:tiers.active')
    await expect(world.tierHeader(page, activeLabel)).toHaveAttribute('aria-expanded', 'true')
    await expect(world.tierHeader(page, t('world:tiers.staged'))).toHaveAttribute(
      'aria-expanded',
      'false',
    )

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

    await chrome.actionsTrigger(page).click()
    await world.addEntityRow(page).click()

    await expect(world.addMenuOption(page, 'blank')).toBeVisible()
    await expect(world.addMenuOption(page, 'fromJson')).toBeVisible()
    await expect(world.addMenuOption(page, 'fromVault')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(world.addMenuOption(page, 'blank')).toHaveCount(0)

    // A reopen exercises the route's addOpen state actually resetting, not just its initial open —
    // a controlled seam that silently no-ops on reopen is the failure mode this guards against.
    await chrome.actionsTrigger(page).click()
    await world.addEntityRow(page).click()
    await expect(world.addMenuOption(page, 'blank')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(world.addMenuOption(page, 'blank')).toHaveCount(0)

    // Add lore… switches to Lore and opens the menu in the same update — the seam's other half.
    await chrome.actionsTrigger(page).click()
    await world.addLoreRow(page).click()
    await expect(world.categoryTrigger(page)).toHaveText(t('world:categories.lore'))
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
    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
  })

  test('Identity and Settings edits save as one delta; reader undo reverses all three', async () => {
    const page = app.window
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branchId = await goToWorld(page)
    const kael = await entityId(page, branchId, 'Kael')
    const before = await entitySnapshot(page, kael)
    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'character').click()
    await world.row(page, 'Kael').click()
    await world.tab(page, 'identity').click()
    await world.description(page).fill('A courier turned fugitive — E2E.')
    await world.visualField(page, 'hair').fill('dark, rain-soaked')
    await world.tab(page, 'settings').click()
    await world.tagsInput(page).fill('fugitive')
    await world.tagsInput(page).press('Enter')
    await expect(saveSession.saveBarSave(page)).toBeVisible()
    await saveSession.saveBarSave(page).click()
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)

    const saved = await entitySnapshot(page, kael)
    expect(saved.description).toBe('A courier turned fugitive — E2E.')
    expect(saved.tags).toContain('fugitive')
    expect(saved.state.visual?.hair).toBe('dark, rain-soaked')
    const rows = await queryApp(
      page,
      `SELECT action_id, op, undo_payload FROM deltas WHERE branch_id = ? AND target_table = 'entities' AND target_id = ? AND source = 'user_edit'`,
      [branchId, kael],
    )
    expect(rows).toHaveLength(1)
    const [actionId, op, undo] = rows[0]
    expect(op).toBe('update')
    const payload = JSON.parse(undo as string) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['description', 'state', 'tags'])
    expect(payload.state).toEqual({ visual: { hair: before.state.visual?.hair } })
    expect(
      await queryApp(page, `SELECT COUNT(*) FROM deltas WHERE action_id = ?`, [actionId]),
    ).toEqual([[1]])

    // CTRL-Z lives on the reader; the Actions menu row is its touch-tier twin.
    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await chrome.actionsTrigger(page).click()
    await reader.undoRow(page).click()
    await expect.poll(() => entitySnapshot(page, kael), { timeout: 30_000 }).toEqual(before)
  })

  test('a dirty pane guards a row switch: Cancel keeps the draft, Discard drops it', async () => {
    const page = app.window
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branchId = await goToWorld(page)
    const kael = await entityId(page, branchId, 'Kael')
    const committed = (await entitySnapshot(page, kael)).description
    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'character').click()
    await world.row(page, 'Kael').click()
    await world.tab(page, 'identity').click()
    await world.description(page).fill('E2E dirty draft')

    await world.row(page, 'Mira').click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedCancel(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(world.subHeader(page)).toContainText('Kael')
    await expect(world.description(page)).toHaveValue('E2E dirty draft')

    await world.row(page, 'Mira').click()
    await saveSession.unsavedDiscard(page).click()
    await expect(world.subHeader(page)).toContainText('Mira')
    expect((await entitySnapshot(page, kael)).description).toBe(committed)
  })

  test('[+] Blank on Locations creates a location on Save and selects it', async () => {
    const page = app.window
    await expect(world.subHeader(page)).toBeVisible()
    const branchId = await currentBranchId(page, HERO_STORY)
    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'location').click()
    await world.addTrigger(page, 'location').click()
    await world.addMenuBlank(page).click()
    await world.nameTrigger(page).click()
    await world.nameInput(page).fill('E2E Salt Wells')
    await world.nameInput(page).press('Enter')
    await saveSession.saveBarSave(page).click()
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)
    expect(
      await queryApp(page, `SELECT kind, state FROM entities WHERE branch_id = ? AND name = ?`, [
        branchId,
        'E2E Salt Wells',
      ]),
    ).toEqual([['location', JSON.stringify({ parent_location_id: null })]])
    await expect(world.subHeader(page)).toContainText('E2E Salt Wells')
  })

  test('Set as lead moves the lead to Mira', async () => {
    const page = app.window
    await expect(world.subHeader(page)).toBeVisible()
    const branchId = await currentBranchId(page, HERO_STORY)
    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'character').click()
    await world.row(page, 'Mira').click()
    await expect(world.leadTag(page, 'Kael')).toBeVisible()
    await world.moreActions(page).click()
    await world.menuItem(page, 'setLead').click()
    const mira = await entityId(page, branchId, 'Mira')
    await expect
      .poll(
        async () =>
          (
            await queryApp(
              page,
              `SELECT json_extract(definition, '$.leadEntityId') FROM stories WHERE id = ?`,
              [HERO_STORY],
            )
          )[0][0],
      )
      .toBe(mira)
    await expect(world.leadTag(page, 'Mira')).toBeVisible()
    // The row first, or the zero count could pass with Kael's row never mounted.
    await expect(world.row(page, 'Kael')).toBeVisible()
    await expect(world.leadTag(page, 'Kael')).toHaveCount(0)
  })

  // Hand-written URL (docs/testing.md → Harness structure): no in-app link carries World's `tab=`
  // (Plot's Open in World sends kind and id only). What this pins is the route wiring: the stores
  // hydrate before `open`, so the linked pane mounts while the link is still pending. The one-shot
  // itself is use-world-deep-link.test.tsx's; the remount only checks the route reads it.
  test('a cold-mount deep link opens its tab, on that mount only', async () => {
    const page = app.window
    await expect(world.subHeader(page)).toBeVisible()
    const branchId = await currentBranchId(page, HERO_STORY)
    const kael = await entityId(page, branchId, 'Kael')

    await page.evaluate(
      ({ branchId, kael }) => {
        window.history.replaceState(
          null,
          '',
          `/world/${branchId}?kind=character&id=${kael}&tab=connections`,
        )
      },
      { branchId, kael },
    )

    const reloaded = page.waitForEvent('load')
    await reloadFromMain(app)
    await reloaded

    await expect(world.detailName(page)).toHaveText('Kael')
    await expect(world.tab(page, 'connections')).toHaveAttribute('aria-selected', 'true')

    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'location').click()
    await world.row(page, 'The Drowned Market').click()
    await expect(world.detailName(page)).toHaveText('The Drowned Market')
    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'character').click()
    await world.row(page, 'Kael').click()
    await expect(world.detailName(page)).toHaveText('Kael')
    await expect(world.tab(page, 'overview')).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('World panel — window close', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    removeUserDataDir(userDataDir)
  })

  test('a window close with a dirty pane raises the unsaved-changes dialog', async () => {
    const page = app.window
    await openWorldFromHome(app)
    await world.row(page, 'Kael').click()
    await world.tab(page, 'identity').click()
    await watchCloseGuard(app)
    await world.description(page).fill('E2E close draft')
    // The pane's save bar commits first; the route arms the guard a render later, over IPC.
    await expectCloseGuardArmed(app)

    const closed = app.app.waitForEvent('close')
    await app.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close()
    })
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedDiscard(page).click()
    await closed
  })
})
