import { expect, test } from '@playwright/test'

import type { StorySettings, SuggestionCategory } from '@/lib/db'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

// Reload goes beforeunload → will-prevent-unload → native:reload-requested, the same chain a
// close runs. Driven via webContents.reload(): page.reload() awaits a load a cancelled unload
// never produces, and Playwright key events don't reach Electron's menu accelerators.
const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'

type MarkedWindow = Window & { e2eReloadMarker?: true }

async function readStorySettings(app: LaunchedApp): Promise<StorySettings> {
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

async function openDirtyGenerationTab(
  app: LaunchedApp,
  label: string,
): Promise<SuggestionCategory> {
  const page = app.window
  await home.openStory(page, HERO_TITLE).click()
  await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
  await storySettings.openFromReader(page).click()
  await storySettings.generationTab(page).click()
  await expect(storySettings.authoringAidsPanel(page)).toBeVisible()
  const original = firstByOrder((await readStorySettings(app)).suggestionCategories)
  await storySettings.categoryLabel(page, original.id).fill(label)
  await expect(storySettings.save(page)).toBeVisible()
  return original
}

// Skips the home → reader → settings hop: a reload replays the same URL, landing back on
// this screen, so there's no home screen left to click through.
async function redirtyGenerationTab(app: LaunchedApp, label: string): Promise<SuggestionCategory> {
  const page = app.window
  await storySettings.generationTab(page).click()
  await expect(storySettings.authoringAidsPanel(page)).toBeVisible()
  const original = firstByOrder((await readStorySettings(app)).suggestionCategories)
  await storySettings.categoryLabel(page, original.id).fill(label)
  await expect(storySettings.save(page)).toBeVisible()
  return original
}

const reloadFromMain = (app: LaunchedApp) =>
  app.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.reload()
  })

// Electron's `will-prevent-unload` (not Playwright's dialog API) decides if a reload proceeds,
// but Chromium still surfaces it to Playwright as a native `dialog` event, and left to its own
// timing Playwright intermittently loses the race and throws "No dialog is showing"
// (microsoft/playwright#36627). Dismiss it ourselves, synchronously; `.catch()` covers the race.
function suppressNativeUnloadDialogRace(app: LaunchedApp): void {
  app.window.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => {})
  })
}

test.describe('reload guard', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

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

  test('a reload while dirty is held behind the unsaved-changes dialog; Cancel keeps the draft, Discard reloads clean', async () => {
    const page = app.window
    const original = await openDirtyGenerationTab(app, 'E2E Reload Edit')
    // A JS global survives a cancelled reload and dies with a real one.
    await page.evaluate(() => {
      ;(window as MarkedWindow).e2eReloadMarker = true
    })

    await reloadFromMain(app)
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedCancel(page).click()

    await expect(storySettings.categoryLabel(page, original.id)).toHaveValue('E2E Reload Edit')
    expect(await page.evaluate(() => (window as MarkedWindow).e2eReloadMarker)).toBe(true)

    const reloaded = page.waitForEvent('load')
    await reloadFromMain(app)
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedDiscard(page).click()
    await reloaded

    // New renderer: marker gone, route re-hydrated with no draft, DB never saw the edit.
    expect(await page.evaluate(() => (window as MarkedWindow).e2eReloadMarker)).toBeUndefined()
    await expect(storySettings.generationTab(page)).toBeVisible({ timeout: 20_000 })
    await expect(storySettings.save(page)).toHaveCount(0)
    const after = await readStorySettings(app)
    expect(after.suggestionCategories.find((c) => c.id === original.id)?.label).toBe(original.label)
  })

  // Pins did-navigate's `guard.confirmedReload = false`: Save's path never fires
  // will-prevent-unload (the hook drops its beforeunload listener before confirmReload()), so
  // this line is the only thing clearing the flag — delete it and the next dirty reload sails
  // through with no dialog at all.
  test('a reload confirmed via Save commits the draft and still guards the next dirty reload', async () => {
    const page = app.window
    const original = await redirtyGenerationTab(app, 'E2E Reload Save')
    await page.evaluate(() => {
      ;(window as MarkedWindow).e2eReloadMarker = true
    })

    const firstReload = page.waitForEvent('load')
    await reloadFromMain(app)
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedSave(page).click()
    await firstReload

    // A real reload happened (not just a dialog close), after the write landed.
    expect(await page.evaluate(() => (window as MarkedWindow).e2eReloadMarker)).toBeUndefined()
    await expect(storySettings.generationTab(page)).toBeVisible({ timeout: 20_000 })
    await expect(storySettings.save(page)).toHaveCount(0)
    const afterSave = await readStorySettings(app)
    expect(afterSave.suggestionCategories.find((c) => c.id === original.id)?.label).toBe(
      'E2E Reload Save',
    )

    // This second reload is what pins `guard.confirmedReload`'s lifecycle. Instrumenting main
    // shows the flag is usually set and NOT consumed by will-prevent-unload — the guard hook
    // drops its beforeunload listener before main reloads — leaving did-navigate's
    // `guard.confirmedReload = false` as its only clear. Drop that line, or disable both
    // clears, and the stale flag makes this reload sail through with no dialog.
    await redirtyGenerationTab(app, 'E2E Reload Save Again')
    const secondReload = page.waitForEvent('load')
    await reloadFromMain(app)
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedDiscard(page).click()
    await secondReload

    await expect(storySettings.generationTab(page)).toBeVisible({ timeout: 20_000 })
    await expect(storySettings.save(page)).toHaveCount(0)
    const afterDiscard = await readStorySettings(app)
    // Discarded, not "Again" — the second dialog was real; the first save's write survives.
    expect(afterDiscard.suggestionCategories.find((c) => c.id === original.id)?.label).toBe(
      'E2E Reload Save',
    )
  })

  // Pins did-start-navigation's `details.isSameDocument` guard, otherwise unreached: the other
  // two cases navigate before setCloseGuard(true) is sent, and in-app same-document navigations
  // already gate elsewhere (story-settings-suggestions.spec.ts). A raw pushState is the only way
  // to exercise the branch — no DOM event, so it can't be mistaken for a real app navigation.
  test('a same-document navigation does not clear the armed guard', async () => {
    const page = app.window
    const original = await redirtyGenerationTab(app, 'E2E Reload SameDoc')

    await page.evaluate(() => {
      window.history.pushState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#e2e-same-doc-nav`,
      )
    })

    await reloadFromMain(app)
    await expect(storySettings.unsavedDialog(page)).toBeVisible()

    const reloaded = page.waitForEvent('load')
    await storySettings.unsavedDiscard(page).click()
    await reloaded

    await expect(storySettings.generationTab(page)).toBeVisible({ timeout: 20_000 })
    await expect(storySettings.save(page)).toHaveCount(0)
    const after = await readStorySettings(app)
    expect(after.suggestionCategories.find((c) => c.id === original.id)?.label).not.toBe(
      'E2E Reload SameDoc',
    )
  })
})

// Its own launch — confirming the close ends the app. The renderer's beforeunload listener now
// sits in front of a confirmed close too; main must let that unload through or the window
// re-prompts forever.
test.describe('window close behind the reload guard', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    // The test closes the app itself; a second close must not fail teardown.
    await app?.close().catch(() => {})
    removeUserDataDir(userDataDir)
  })

  test('a confirmed close still closes the window', async () => {
    const page = app.window
    await openDirtyGenerationTab(app, 'E2E Close Edit')

    const closed = app.app.waitForEvent('close')
    await app.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close()
    })
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedDiscard(page).click()
    await closed
  })
})

// Its own launch — this one closes the app too. Covers `will-prevent-unload`'s
// `!guard.guarded` fail-open clause, which nothing else reaches: every other case
// arms the guard through a complete preload bridge, and the clause only fires for an unguarded
// beforeunload — a partial bridge, where `closeBridge()` probes false and the hook registers
// the browser listener alone. Without it main asks a renderer that has no dialog to show and
// the close never completes, so removing the clause fails this as a hang rather than an
// assertion — an unquittable window has nothing to assert against.
test.describe('an unguarded beforeunload does not make the window unquittable', () => {
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

  test('a close still completes with no guard armed', async () => {
    const page = app.window
    await expect(home.openStory(page, HERO_TITLE)).toBeVisible({ timeout: 20_000 })
    // Raw listener, no setCloseGuard: stands in for a renderer whose bridge probe failed.
    await page.evaluate(() => {
      window.addEventListener('beforeunload', (event) => event.preventDefault())
    })

    const closed = app.app.waitForEvent('close')
    await app.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close()
    })
    await closed
  })
})
