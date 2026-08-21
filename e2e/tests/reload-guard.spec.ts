import { expect, test } from '@playwright/test'

import type { StorySettings, SuggestionCategory } from '@/lib/db'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

// Electron's reload (Ctrl-R, Force reload, the devtools button) goes
// beforeunload → will-prevent-unload → native:reload-requested → the same ask
// chain a window close runs. Driven from main (webContents.reload) because
// page.reload() waits for a load that a cancelled unload never produces, and
// Playwright's key events do not reach Electron's menu accelerators.
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

// Same dirtying steps as openDirtyGenerationTab, minus the home → reader →
// settings hop: a reload's Cancel/Save leaves the app right back on this
// screen (the reload replays the same URL), so re-opening from home would
// find no home screen to click through.
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

// Electron's `will-prevent-unload` — not Playwright's dialog API — is the
// real authority over whether a beforeunload-triggered reload proceeds; the
// renderer's dialog is our own React overlay, not this. But Chromium still
// surfaces the underlying beforeunload attempt to Playwright as a native
// `dialog` event, and left to its own default (undocumented-timing) auto-
// dismissal, Playwright intermittently loses a race against Electron's own
// resolution and throws "Protocol error (Page.handleJavaScriptDialog): No
// dialog is showing" — a known Playwright/Electron interaction
// (microsoft/playwright#36627) reproduced locally across this file's
// multi-reload tests. Dismissing it ourselves, synchronously on the event,
// makes the acknowledgement deterministic instead of racy; `.catch()` covers
// it resolving before this handler runs.
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

    // The renderer is new: the marker is gone, the route re-hydrated from the
    // DB with no draft, and the DB never saw the edit.
    expect(await page.evaluate(() => (window as MarkedWindow).e2eReloadMarker)).toBeUndefined()
    await expect(storySettings.generationTab(page)).toBeVisible({ timeout: 20_000 })
    await expect(storySettings.save(page)).toHaveCount(0)
    const after = await readStorySettings(app)
    expect(after.suggestionCategories.find((c) => c.id === original.id)?.label).toBe(original.label)
  })

  // did-start-navigation's `confirmedReloads.delete(win.id)` has no other
  // consumer: Cancel never sets the flag, and Discard's will-prevent-unload
  // consumes it first. Save is the one path that clears the surface without
  // ever firing will-prevent-unload (the hook drops its beforeunload listener
  // before confirmReload()), so this line is the only thing left to clear it —
  // delete it and the flag survives to wave the *next* dirty reload through
  // with no dialog at all.
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

    // A real reload happened (Save doesn't just close the dialog in place),
    // and it happened after the write landed.
    expect(await page.evaluate(() => (window as MarkedWindow).e2eReloadMarker)).toBeUndefined()
    await expect(storySettings.generationTab(page)).toBeVisible({ timeout: 20_000 })
    await expect(storySettings.save(page)).toHaveCount(0)
    const afterSave = await readStorySettings(app)
    expect(afterSave.suggestionCategories.find((c) => c.id === original.id)?.label).toBe(
      'E2E Reload Save',
    )

    // Dirty the now-clean surface again and reload a second time. This covers
    // the Save flow end to end — the write lands, the reload commits, and the
    // guard re-arms — but it does NOT pin `confirmedReloads`' lifecycle, which
    // was the original reason for adding it. Mutation-tested 2026-08-22:
    // removing `confirmedReloads.delete(win.id)` from `did-start-navigation`,
    // and even making `will-prevent-unload` non-consuming as well so nothing
    // clears the flag at all, leaves all four tests green. Whatever keeps a
    // stale flag from waving this second reload through, it is not something
    // this spec observes. Do not add a comment here claiming otherwise without
    // re-running that mutation. See triage.md.
    await redirtyGenerationTab(app, 'E2E Reload Save Again')
    const secondReload = page.waitForEvent('load')
    await reloadFromMain(app)
    await expect(storySettings.unsavedDialog(page)).toBeVisible()
    await storySettings.unsavedDiscard(page).click()
    await secondReload

    await expect(storySettings.generationTab(page)).toBeVisible({ timeout: 20_000 })
    await expect(storySettings.save(page)).toHaveCount(0)
    const afterDiscard = await readStorySettings(app)
    // Discarded, not the "Again" edit — proves the second dialog was real and
    // the first save's write is what survives.
    expect(afterDiscard.suggestionCategories.find((c) => c.id === original.id)?.label).toBe(
      'E2E Reload Save',
    )
  })

  // did-start-navigation's `details.isSameDocument` guard is otherwise
  // unreached: every expo-router navigation in the other two cases happens
  // before setCloseGuard(true) is sent, so deleting the clause leaves both
  // green. No in-app surface reaches a same-document navigation while this
  // screen's guard is armed either — the chrome back arrow and the Actions
  // menu's route jump both already gate on the same unsaved-changes guard
  // (story-settings-suggestions.spec.ts covers those) — so a raw pushState is
  // the only way to exercise the branch: it fires did-start-navigation with
  // isSameDocument true and no DOM event (no popstate/hashchange), so it can't
  // be mistaken for a real app navigation and can't disturb expo-router state.
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

// Its own launch: confirming the close ends the app. The renderer's beforeunload
// listener now also sits in front of a confirmed close, so main must let that
// unload through or the window re-prompts forever.
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
