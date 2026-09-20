import { expect, test, type Page } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir, setAppEmbeddingModelId } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

// retrieval.md → The story-open upgrade prompt, at the seams only a running app reaches: Keep's
// suppression is a durable write a second story open reads back, Later's is session state a
// relaunch drops, and Upgrade hands off through the real router. Gate and per-open latch:
// lib/embedder-swap/upgrade-prompt.test.ts; the three actions: embedding-upgrade-host.stories.tsx.
// See docs/testing.md → Coverage.

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// Synthetic: the gate compares model ids and never checks the default is
// installed, so only the Upgrade case below has to make this a real embedder.
const NEWER_DEFAULT = 'e2e/newer-embedder'

async function declinedKey(app: LaunchedApp): Promise<string | undefined> {
  const [[settings]] = await queryApp(app.window, `SELECT settings FROM stories WHERE id = ?`, [
    HERO_STORY,
  ])
  return (JSON.parse(settings as string) as { embedding_upgrade_declined?: string })
    .embedding_upgrade_declined
}

// Re-opens from the library and asserts the prompt stays away. The composer is not a milestone
// the prompt follows, so the gear click closes that gap: the prompt is a modal AlertDialog, so
// its overlay fails the click's hit-target check and this step hangs while it is up. One that
// stopped being modal would leave both toBeHidden assertions below proving nothing. Only
// answering the prompt (Esc included) dismisses it — a route change touches no gate input.
async function reopenAndExpectQuiet(page: Page, title: string): Promise<void> {
  await home.openStory(page, title).click()
  await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
  await storySettings.openFromReader(page).click()
  await expect(storySettings.aboutPanel(page)).toBeVisible({ timeout: 20_000 })
  await expect(storySettings.upgradePrompt(page)).toBeHidden()
  await storySettings.back(page).click()
  await expect(reader.composer(page)).toBeVisible({ timeout: 10_000 })
  await expect(storySettings.upgradePrompt(page)).toBeHidden()
}

test.describe('embedding upgrade prompt — Keep', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    setAppEmbeddingModelId(seeded.dbPath, NEWER_DEFAULT)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('shows once, Keep records the declined default, and a re-open stays quiet', async () => {
    const page = app.window
    await home.openStory(page, HERO_TITLE).click()
    await expect(storySettings.upgradePrompt(page)).toBeVisible({ timeout: 20_000 })

    await storySettings.upgradeKeep(page).click()
    await expect(storySettings.upgradePrompt(page)).toBeHidden()
    // The app default, not the story's own model: the key names what the user
    // turned down, which is what the gate compares the next default against.
    await expect.poll(() => declinedKey(app)).toBe(NEWER_DEFAULT)

    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await storySettings.back(page).click()
    await expect(home.openStory(page, HERO_TITLE)).toBeVisible({ timeout: 10_000 })

    // Same click, same app, same story as the open that raised the prompt above, so the silence
    // here belongs to the key Keep wrote and to nothing else about the second visit.
    await reopenAndExpectQuiet(page, HERO_TITLE)
  })
})

test.describe('embedding upgrade prompt — Later', () => {
  let userDataDir: string

  test.beforeAll(() => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    setAppEmbeddingModelId(seeded.dbPath, NEWER_DEFAULT)
  })

  // Neither launch below owns the dir — the relaunch has to read back what the
  // first one left — so cleanup is here, once, after both have closed.
  test.afterAll(() => {
    removeUserDataDir(userDataDir)
  })

  test('Later dismisses for the session and the prompt returns after a relaunch', async () => {
    test.setTimeout(180_000)
    const first = await launchApp({ userDataDir, cleanupUserData: false })
    try {
      await home.openStory(first.window, HERO_TITLE).click()
      await expect(storySettings.upgradePrompt(first.window)).toBeVisible({ timeout: 20_000 })
      await storySettings.upgradeLater(first.window).click()
      await expect(storySettings.upgradePrompt(first.window)).toBeHidden()

      // Dismissing is not deciding, so nothing is written — this sample and the relaunch below
      // are its two halves: a recorded decline would have kept the prompt away next launch too.
      expect(await declinedKey(first)).toBeUndefined()

      await storySettings.back(first.window).click()
      await expect(home.openStory(first.window, HERO_TITLE)).toBeVisible({ timeout: 10_000 })
      // The deferral outlives the open it was made on: without it the latch would
      // re-read the still-open gate here and raise the prompt again.
      await reopenAndExpectQuiet(first.window, HERO_TITLE)
    } finally {
      await first.close()
    }

    const second = await launchApp({ userDataDir, cleanupUserData: false })
    try {
      await home.openStory(second.window, HERO_TITLE).click()
      await expect(storySettings.upgradePrompt(second.window)).toBeVisible({ timeout: 20_000 })
    } finally {
      await second.close()
    }
  })
})

test.describe('embedding upgrade prompt — Upgrade', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // The only case that needs the default to be a real embedder: the pre-seat matches the app
    // default's exact target, `local:<id>`, so it seats nothing unless that model is installed
    // on this device. `idOverride` relabels a copy of the provisioned default instead of
    // fetching a second model; a cold cache pays for that one download here.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir, { idOverride: NEWER_DEFAULT })
    setAppEmbeddingModelId(seeded.dbPath, NEWER_DEFAULT)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('over Story Settings, Upgrade switches to Memory with the app default seated', async () => {
    // beforeAll's setTimeout scopes to the hook; the body's own waits sum past the 90s default,
    // so a slow failure would report a timeout rather than the assertion that missed.
    test.setTimeout(120_000)
    const page = app.window
    await expect(home.newStory(page)).toBeVisible({ timeout: 20_000 })

    // Edit info opens the story straight onto Story Settings, so the prompt fires over the very
    // surface it hands off to — the hand-off has no screen to push and must move the tab instead.
    await home.storyActions(page, HERO_TITLE).click()
    await home.editInfo(page).click()
    await expect(storySettings.aboutPanel(page)).toBeVisible({ timeout: 20_000 })
    await expect(storySettings.upgradePrompt(page)).toBeVisible({ timeout: 20_000 })

    await storySettings.upgradeUpgrade(page).click()
    await expect(storySettings.upgradePrompt(page)).toBeHidden()

    // Upgrade navigates to the route this screen is already on, so the surface is reused rather
    // than pushed and the tab has to follow the param. The param is also the evidence it changed:
    // About is the tab Edit info opened on, and would still show had the navigation not landed.
    await expect(page).toHaveURL(/\/story-settings\/[^?]+\?tab=memory/, { timeout: 20_000 })
    await expect(storySettings.memoryPanel(page)).toBeVisible()
    await expect(storySettings.aboutPanel(page)).toBeHidden()

    // "The dialog opened" is not "the dialog seated the target": both panes are the same
    // dialog, so a hand-off that dropped the model would still get this far, on the pick list
    // with Next unpressed. The options title names the candidate seated, and a synthetic id has
    // no catalog entry, so the label is the id itself — shared with the provider copy, so this
    // pins seated-vs-not, not which copy. Which copy is memory-panel.stories.tsx's Preseat* plays.
    await expect(storySettings.swapOptionsTitle(page, NEWER_DEFAULT)).toBeVisible({
      timeout: 20_000,
    })
    await expect(storySettings.swapRelabel(page)).toBeVisible()
    await expect(storySettings.swapNext(page)).toBeHidden()
  })
})
