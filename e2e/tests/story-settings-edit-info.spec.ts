import { expect, test, type Page } from '@playwright/test'

import { storySettingsSchema, type StorySettings } from '@/lib/db'

import { createAdventureStory } from '../flows/create-story'
import { waitForTurnTerminal } from '../flows/turn'
import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  corruptStorySettings,
  createSeededUserDataDir,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storyRecovery } from '../locators/recovery'
import { storySettings } from '../locators/story-settings'
import { wizard } from '../locators/wizard'

// story-list.md → Story card / principles.md → Stack-aware Return: `Edit info` boots
// the story and opens Story Settings on About, and every exit off the surface is a plain
// stack move that only a running router shows. The save session, the flagged-field table
// and the panels are covered cheaper in unit (save-session, flagged-fields, about-draft)
// and Storybook. See docs/testing.md → Coverage.

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
const RENAMED = 'E2E Renamed Courier'
const LEFT_DIRTY = 'E2E Draft Left Dirty'
const SAVED_ON_LEAVE = 'E2E Saved On Leave'
const FRESH_STORY = {
  lead: 'Ilse Marrow',
  title: 'E2E Fresh Ledger',
  opening: 'The ledger was already open when she reached the desk.',
}
const REPLY = 'E2E-EDITINFO-REPLY — the ledger answers in a borrowed hand.'

async function storyTitle(app: LaunchedApp, storyId: string): Promise<string> {
  const [[title]] = await queryApp(app.window, `SELECT title FROM stories WHERE id = ?`, [storyId])
  return title as string
}

// Deliberately untyped: the corrupt-settings case reads a blob that by construction
// fails `storySettingsSchema`, so a StorySettings return type would be a lie.
async function readSettings(app: LaunchedApp, storyId: string): Promise<unknown> {
  const [[json]] = await queryApp(app.window, `SELECT settings FROM stories WHERE id = ?`, [
    storyId,
  ])
  return JSON.parse(json as string)
}

async function wrapPov(
  app: LaunchedApp,
  storyId: string,
): Promise<StorySettings['composerWrapPov']> {
  return ((await readSettings(app, storyId)) as StorySettings).composerWrapPov
}

// Reads the stored value instead of assuming one: the seeded hero is 3rd person, a
// wizard-built adventure story 1st, and only a real change publishes the flagged field.
async function flipWrapPov(
  app: LaunchedApp,
  storyId: string,
): Promise<StorySettings['composerWrapPov']> {
  const target = (await wrapPov(app, storyId)) === 'first' ? 'third' : 'first'
  await storySettings.wrapPovOption(app.window, target).click()
  return target
}

// Card ⋯ → Edit info, the library-side entry into Story Settings. The URL is what makes
// the destination discriminating: About is also the desktop default tab, so a route that
// dropped `?tab=about` would still land the panel and every visible assertion here would pass.
async function openEditInfo(page: Page, title: string): Promise<void> {
  await home.storyActions(page, title).click()
  await home.editInfo(page).click()
  await expect(storySettings.aboutPanel(page)).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(/\/story-settings\/[^?]+\?tab=about/)
}

test.describe('story settings — the Edit info route', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('opens Story Settings on About, saves a title, and the first back returns to the library', async () => {
    const page = app.window
    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })

    await openEditInfo(page, HERO_TITLE)
    await expect(storySettings.aboutTitle(page)).toHaveValue(HERO_TITLE)

    await storySettings.aboutTitle(page).fill(RENAMED)
    await expect(storySettings.save(page)).toBeVisible()
    await storySettings.save(page).click()
    await expect(storySettings.save(page)).toBeHidden()

    await expect.poll(() => storyTitle(app, HERO_STORY)).toBe(RENAMED)
    // The breadcrumb reads the store row, so this is also the save's re-hydrate.
    await expect(storySettings.breadcrumb(page)).toContainText(RENAMED)

    // One ← reaches the library, which is what pins that the route interposed no
    // reader between the two screens even though `Edit info` opens the story.
    await chrome.back(page).click()
    await expect(home.openStory(page, RENAMED)).toBeVisible({ timeout: 10_000 })
    await expect(storySettings.aboutPanel(page)).toBeHidden()
  })

  test('the story segment pushes a reader over the surface, and a tab switch adds no history entry', async () => {
    const page = app.window
    const title = await storyTitle(app, HERO_STORY)
    // A retry restarts the worker, which makes this the first test after
    // beforeAll and hands it the cold-boot budget tests 1 and 7 already carry.
    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })

    await openEditInfo(page, title)
    await expect(home.newStory(page)).toBeHidden()

    // Nothing below to pop to, so the segment pushes a reader on top instead.
    await storySettings.breadcrumbStory(page, title).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await expect(storySettings.aboutPanel(page)).toBeHidden()

    // The push is what makes this ← land back on Story Settings; had the segment
    // replaced the surface, the library would be here instead.
    await chrome.back(page).click()
    await expect(storySettings.aboutPanel(page)).toBeVisible({ timeout: 10_000 })
    await expect(reader.composer(page)).toBeHidden()

    // Selecting a tab mirrors it into `?tab=` through navigation.setParams, which rewrites
    // the focused route's params rather than pushing — hence both the URL each switch lands
    // on and the ← below still reaching the library. Two switches, because either one
    // turning into a push would leave an entry that ← spends on the surface instead.
    await storySettings.generationTab(page).click()
    await expect(storySettings.authoringAidsPanel(page)).toBeVisible()
    await expect(storySettings.aboutPanel(page)).toBeHidden()
    await expect(page).toHaveURL(/\/story-settings\/[^?]+\?tab=generation/)
    await storySettings.aboutTab(page).click()
    await expect(storySettings.aboutPanel(page)).toBeVisible()
    await expect(storySettings.authoringAidsPanel(page)).toBeHidden()
    await expect(page).toHaveURL(/\/story-settings\/[^?]+\?tab=about/)

    await chrome.back(page).click()
    await expect(home.newStory(page)).toBeVisible({ timeout: 10_000 })
    await expect(storySettings.aboutPanel(page)).toBeHidden()
  })

  test('entering from the reader opens About, and back pops to the reader below', async () => {
    const page = app.window
    const title = await storyTitle(app, HERO_STORY)
    await home.openStory(page, title).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })

    // About is the rail's first entry, so the gear's `?tab=`-less route opens it.
    await storySettings.openFromReader(page).click()
    await expect(storySettings.aboutPanel(page)).toBeVisible({ timeout: 20_000 })
    await expect(reader.composer(page)).toBeHidden()

    await chrome.back(page).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 10_000 })
    await expect(storySettings.aboutPanel(page)).toBeHidden()

    // A second ← reaches the library: the reader was the screen below the
    // surface, not one this visit pushed over it.
    await chrome.back(page).click()
    await expect(home.newStory(page)).toBeVisible({ timeout: 10_000 })
  })

  test('a dirty leave through the story segment cancels, discards, or saves on the way out', async () => {
    const page = app.window
    const stored = await storyTitle(app, HERO_STORY)
    await home.openStory(page, stored).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await storySettings.openFromReader(page).click()
    await expect(storySettings.aboutPanel(page)).toBeVisible({ timeout: 20_000 })

    // The breadcrumb labels the segment from the store row, so its name stays the
    // stored title however far the About draft has moved from it.
    await storySettings.aboutTitle(page).fill(LEFT_DIRTY)
    await storySettings.breadcrumbStory(page, stored).click()
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedCancel(page).click()
    await expect(storySettings.unsavedDialog(page)).toBeHidden()
    await expect(storySettings.aboutTitle(page)).toHaveValue(LEFT_DIRTY)
    await expect(storySettings.aboutPanel(page)).toBeVisible()
    await expect(reader.composer(page)).toBeHidden()

    // The assertions above only say the surface has not left yet. A Cancel that
    // let its queued intent fire late is caught here instead: this segment exists
    // on no other screen, so the click fails once the reader has taken over.
    await storySettings.breadcrumbStory(page, stored).click()
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedDiscard(page).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 10_000 })
    await expect(storySettings.unsavedDialog(page)).toBeHidden()
    expect(await storyTitle(app, HERO_STORY)).toBe(stored)

    await storySettings.openFromReader(page).click()
    await expect(storySettings.aboutPanel(page)).toBeVisible({ timeout: 20_000 })
    // The read above is a point sample, so a commit that landed after Discard returned
    // would slip past it. This panel mounts from the store, where a late write would show.
    await expect(storySettings.aboutTitle(page)).toHaveValue(stored)
    await storySettings.aboutTitle(page).fill(SAVED_ON_LEAVE)
    await storySettings.breadcrumbStory(page, stored).click()
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedSave(page).click()
    // The queued leave settles only once the commit lands, so arriving on the
    // reader is itself the evidence the write went through.
    await expect(reader.composer(page)).toBeVisible({ timeout: 10_000 })
    await expect(storySettings.unsavedDialog(page)).toBeHidden()
    await expect.poll(() => storyTitle(app, HERO_STORY)).toBe(SAVED_ON_LEAVE)

    // The segment dismissed down to the reader that was already below the
    // surface, so one more ← reaches the library rather than Story Settings.
    await chrome.back(page).click()
    await expect(home.newStory(page)).toBeVisible({ timeout: 10_000 })
  })

  test('a story with turns asks for consent before a definitional change is written', async () => {
    const page = app.window
    const title = await storyTitle(app, HERO_STORY)
    await openEditInfo(page, title)

    await storySettings.generationTab(page).click()
    await expect(storySettings.authoringAidsPanel(page)).toBeVisible()
    const target = await flipWrapPov(app, HERO_STORY)

    await expect(storySettings.save(page)).toBeVisible()
    await storySettings.save(page).click()
    // The seeded hero branch carries user actions and replies, so the flagged
    // field parks the save behind the confirmation rather than committing it.
    await expect(storySettings.confirmSaveAnyway(page)).toBeVisible()
    expect(await wrapPov(app, HERO_STORY)).not.toBe(target)

    await storySettings.confirmSaveAnyway(page).click()
    await expect(storySettings.confirmSaveAnyway(page)).toBeHidden()
    await expect.poll(() => wrapPov(app, HERO_STORY)).toBe(target)
    // Only once the dialog is gone: its "Save anyway" also matches the anchored
    // regex behind `save`, and the save bar stays in the tree behind the dialog.
    await expect(storySettings.save(page)).toBeHidden()

    await chrome.back(page).click()
    await expect(home.newStory(page)).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('story settings — consent on a story with no turns yet', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so the turn below never reaches a
    // reply without an installed embedder; a cold cache downloads ~24 MB first.
    test.setTimeout(240_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(REPLY)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('saves a definitional change silently until the first turn lands, then asks', async () => {
    test.setTimeout(240_000)
    const page = app.window
    // Built through the wizard, not seeded: fixture stories all have turns, and the
    // opening-only seed helper's creative-mode definition leaves wrap PoV inert and disabled.
    await home.newStory(page).click()
    await expect(wizard.modeOption(page, 'adventure')).toBeVisible({ timeout: 20_000 })
    await createAdventureStory(page, FRESH_STORY)
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const storyRows = await queryApp(page, `SELECT id FROM stories WHERE title = ?`, [
      FRESH_STORY.title,
    ])
    expect(storyRows.length, 'the wizard committed one story under this title').toBe(1)
    const storyId = storyRows[0][0] as string

    // Finish replaces the wizard with the reader, so this ← reaches the library.
    await chrome.back(page).click()
    await expect(home.newStory(page)).toBeVisible({ timeout: 10_000 })

    await openEditInfo(page, FRESH_STORY.title)
    await storySettings.generationTab(page).click()
    await expect(storySettings.authoringAidsPanel(page)).toBeVisible()

    const beforeTurn = await flipWrapPov(app, storyId)
    await expect(storySettings.save(page)).toBeVisible()
    await storySettings.save(page).click()
    // The wizard's opening is not a turn, so nothing parks. The write is asserted first:
    // `toBeHidden` on a never-opened dialog passes instantly; a parked save would not move it.
    await expect.poll(() => wrapPov(app, storyId)).toBe(beforeTurn)
    await expect(storySettings.confirmSaveAnyway(page)).toBeHidden()
    await expect(storySettings.save(page)).toBeHidden()

    // Edit info came from the library, so the segment pushes a reader here too.
    await storySettings.breadcrumbStory(page, FRESH_STORY.title).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await reader.composer(page).fill('E2E-EDITINFO I sign the ledger and wait.')
    await reader.send(page).click()
    await expect(page.getByText('E2E-EDITINFO-REPLY', { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    await waitForTurnTerminal(app.window)

    // Back onto the surface the reader was pushed over. It re-reads storyHasTurns
    // on every focus precisely because a reader above it can add one.
    await chrome.back(page).click()
    await expect(storySettings.authoringAidsPanel(page)).toBeVisible({ timeout: 10_000 })
    await expect(reader.composer(page)).toBeHidden()

    const afterTurn = await flipWrapPov(app, storyId)
    await expect(storySettings.save(page)).toBeVisible()
    await storySettings.save(page).click()
    await expect(storySettings.confirmSaveAnyway(page)).toBeVisible()
    expect(await wrapPov(app, storyId)).toBe(beforeTurn)

    await storySettings.confirmSaveAnyway(page).click()
    await expect(storySettings.confirmSaveAnyway(page)).toBeHidden()
    await expect.poll(() => wrapPov(app, storyId)).toBe(afterTurn)
  })
})

test.describe('story settings — Edit info on a story whose settings are corrupt', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    corruptStorySettings(seeded.dbPath, HERO_STORY)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('the recovery reset repairs the settings and keeps the About destination', async () => {
    const page = app.window
    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })
    expect(storySettingsSchema.safeParse(await readSettings(app, HERO_STORY)).success).toBe(false)

    await home.storyActions(page, HERO_TITLE).click()
    await home.editInfo(page).click()
    await expect(storyRecovery.resetStorySettings(page)).toBeVisible({ timeout: 20_000 })

    await storyRecovery.resetStorySettings(page).click()
    await expect(storyRecovery.confirmReset(page)).toBeVisible()
    await storyRecovery.confirmReset(page).click()

    // The reset re-runs the open against the destination the failed attempt
    // carried, so it lands on About — not the story list's reader default.
    await expect(storySettings.aboutPanel(page)).toBeVisible({ timeout: 20_000 })
    await expect(reader.composer(page)).toBeHidden()
    await expect(storyRecovery.resetStorySettings(page)).toBeHidden()
    expect(storySettingsSchema.safeParse(await readSettings(app, HERO_STORY)).success).toBe(true)
  })
})
