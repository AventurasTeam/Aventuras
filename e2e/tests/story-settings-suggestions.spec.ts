import { expect, test } from '@playwright/test'

import type { StorySettings, SuggestionCategory } from '@/lib/db'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

// Story Settings → Generation tab (components/story-settings/authoring-aids-panel.tsx)
// round-tripping through the real save-session write path: renderer draft →
// IPC → updateStorySettings → SQLite → rehydrateStories back into the store,
// plus the save session's dirty guard intercepting a real chrome navigation.
// That's the seam a running app is the only place to observe — everything
// else is covered cheaper and isn't re-driven here: the categories adapter's
// order/colour round-trip and label validation are unit-tested
// (components/story-settings/suggestion-categories-draft.test.ts), and the
// panel's render variants, delete/reset confirmations, master-toggle gating
// and save-blocking are Storybook play stories (authoring-aids-panel.stories.tsx)
// plus the save chrome's own stories. See docs/testing.md → Coverage.

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'

async function readStorySettings(app: LaunchedApp): Promise<StorySettings> {
  const [[settingsJson]] = await queryApp(app.window, `SELECT settings FROM stories WHERE id = ?`, [
    HERO_STORY,
  ])
  return JSON.parse(settingsJson as string) as StorySettings
}

function firstByOrder(categories: readonly SuggestionCategory[]): SuggestionCategory {
  const sorted = [...categories].sort((a, b) => a.order - b.order)
  const first = sorted[0]
  if (first == null) throw new Error('seed has no suggestion categories')
  return first
}

test.describe('story settings — authoring aids save round-trip', () => {
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

  test('renames a category, bumps the count, flips the toggle off then back on, and every field survives its own re-read', async () => {
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    await storySettings.openFromReader(app.window).click()
    await storySettings.generationTab(app.window).click()
    await expect(storySettings.authoringAidsPanel(app.window)).toBeVisible()

    // Read before touching anything: the seeded suggestionCount is the +1
    // baseline below, and the first category's id/colour are what the
    // colour-round-trip assertion pins against.
    const seeded = await readStorySettings(app)
    const seededCount = seeded.suggestionCount
    const firstCategory = firstByOrder(seeded.suggestionCategories)

    const RENAMED_LABEL = 'E2E Renamed Act'

    // Order matters: the count stepper and the categories editor are both
    // `disabled={!enabled}`, so the toggle has to flip last.
    await storySettings.categoryLabel(app.window, firstCategory.id).fill(RENAMED_LABEL)
    await storySettings.countIncrement(app.window).click()
    await storySettings.suggestionsToggle(app.window).click()

    await expect(storySettings.save(app.window)).toBeVisible()
    await storySettings.save(app.window).click()
    // The bar disappearing is the success signal (docs/ui/patterns/save-sessions.md).
    await expect(storySettings.save(app.window)).toBeHidden()

    await expect
      .poll(
        async () =>
          (await readStorySettings(app)).suggestionCategories.find((c) => c.id === firstCategory.id)
            ?.label,
      )
      .toBe(RENAMED_LABEL)

    const afterFirstSave = await readStorySettings(app)
    expect({
      suggestionsEnabled: afterFirstSave.suggestionsEnabled,
      suggestionCount: afterFirstSave.suggestionCount,
    }).toEqual({ suggestionsEnabled: false, suggestionCount: seededCount + 1 })

    // Switch away and back: the label input must show what's on disk, not a
    // draft that happened to still be sitting in memory.
    await storySettings.memoryTab(app.window).click()
    await storySettings.generationTab(app.window).click()
    await expect(storySettings.categoryLabel(app.window, firstCategory.id)).toHaveValue(
      RENAMED_LABEL,
    )

    // .map() already returns a fresh array, so sorting it in place doesn't
    // touch afterFirstSave.suggestionCategories itself.
    const orders = afterFirstSave.suggestionCategories.map((c) => c.order).sort((a, b) => a - b)
    expect(orders).toEqual(afterFirstSave.suggestionCategories.map((_, i) => i))
    const renamedCategory = afterFirstSave.suggestionCategories.find(
      (c) => c.id === firstCategory.id,
    )
    expect(renamedCategory?.color).toBe(firstCategory.color)

    // Bring the story back onto the feature without disturbing what was just
    // saved — the slice's acceptance criterion for re-enabling suggestions.
    await storySettings.suggestionsToggle(app.window).click()
    await expect(storySettings.save(app.window)).toBeVisible()
    await storySettings.save(app.window).click()
    await expect(storySettings.save(app.window)).toBeHidden()

    await expect.poll(async () => (await readStorySettings(app)).suggestionsEnabled).toBe(true)

    const afterSecondSave = await readStorySettings(app)
    expect(afterSecondSave.suggestionsEnabled).toBe(true)
    expect(afterSecondSave.suggestionCategories).toEqual(afterFirstSave.suggestionCategories)
  })
})

test.describe('story settings — dirty navigate-away guard', () => {
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

  test('the chrome back arrow is intercepted while dirty, and Discard reaches the reset, not just the dialog', async () => {
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    await storySettings.openFromReader(app.window).click()
    await storySettings.generationTab(app.window).click()
    await expect(storySettings.authoringAidsPanel(app.window)).toBeVisible()

    const seeded = await readStorySettings(app)
    const original = firstByOrder(seeded.suggestionCategories)

    await storySettings.categoryLabel(app.window, original.id).fill('E2E Dirty Edit')
    await expect(storySettings.save(app.window)).toBeVisible()

    await storySettings.back(app.window).click()
    await expect(storySettings.unsavedDialog(app.window)).toBeVisible()

    await storySettings.unsavedDiscard(app.window).click()

    const afterDiscard = await readStorySettings(app)
    expect(afterDiscard.suggestionCategories.find((c) => c.id === original.id)?.label).toBe(
      original.label,
    )

    // Discard also settles the queued leave intent — the same click that threw
    // the draft away carries the navigation through.
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 10_000 })
  })
})
