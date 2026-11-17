import { expect, test } from '@playwright/test'

import type { StorySettings } from '@/lib/db'

import { waitForTurnTerminal } from '../flows/turn'
import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  addProviderCustomModel,
  createSeededUserDataDir,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

// Story Settings → Models (components/story-settings/models-panel.tsx) end to
// end: the override pinned on the tab, with the settings it copied from the
// narrative profile, is the `model` and `temperature` the next narrative call
// puts on the wire, and clearing it restores the profile chain. Only a running
// app shows the wire; the resolver and the panel are covered cheaper in unit and
// Storybook. See docs/testing.md → Coverage.

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
const SEED_MODEL = 'seed/narrative'
const SEED_PROFILE = 'Seed Narrative'
// The seed narrative profile's temperature, which an override made from the chain copies.
const SEED_TEMPERATURE = 0.8
const OVERRIDE_MODEL = 'e2e/override-model'
const REPLY_OVERRIDE = 'E2E-MODELS-REPLY the courier answers.'
const REPLY_CLEARED = 'E2E-MODELS-REPLY-2 the bell answers.'

async function readModels(app: LaunchedApp): Promise<StorySettings['models']> {
  const [[settingsJson]] = await queryApp(app.window, `SELECT settings FROM stories WHERE id = ?`, [
    HERO_STORY,
  ])
  return (JSON.parse(settingsJson as string) as StorySettings).models
}

// `streamed` is what separates the narrative call from a turn's structured ones:
// per-turn's narrative phase is the app's only streamText call site, and the
// mock flags a request streamed off `stream: true` in the body it received.
function lastNarrativeBody(mock: MockLlm): Record<string, unknown> | undefined {
  const streamed = mock.requests.filter((r) => r.streamed)
  return streamed[streamed.length - 1]?.body
}

function lastNarrativeModel(mock: MockLlm): string | undefined {
  return lastNarrativeBody(mock)?.model as string | undefined
}

test.describe('story settings — narrative override reaches the wire', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn without an installed
    // embedder never reaches the reply.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    addProviderCustomModel(seeded.dbPath, OVERRIDE_MODEL)
    mock = await startMockLlm()
    mock.setNarrative(REPLY_OVERRIDE)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('pins the override, sends it on the next turn, and clearing restores the chain', async () => {
    test.setTimeout(180_000)
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    await storySettings.openFromReader(app.window).click()
    await storySettings.modelsTab(app.window).click()
    await expect(storySettings.modelsPanel(app.window)).toBeVisible()

    // The hero ships `models: {}`, so the row starts on the App Settings chain.
    // The sentinel only renders while nothing is pinned, which is what makes the
    // same assertion after the clear below non-trivial.
    const narrativeRow = storySettings.modelRow(app.window, 'narrative')
    await expect(narrativeRow).toContainText(
      t('storySettings:models.appDefault', { model: SEED_MODEL, profile: SEED_PROFILE }),
    )

    await storySettings.modelPickerTrigger(narrativeRow).click()
    // `seed/narrative` is the provider's only other id and doesn't match, so the
    // query leaves exactly one option — the seeded favourite included.
    await storySettings.modelPickerSearch(app.window).fill('override')
    await storySettings.modelPickerOption(app.window, OVERRIDE_MODEL).click()

    await expect(storySettings.save(app.window)).toBeVisible()
    await storySettings.save(app.window).click()
    await expect(storySettings.save(app.window)).toBeHidden()
    await expect
      .poll(async () => (await readModels(app)).narrative)
      .toEqual({ providerId: 'prov_local', modelId: OVERRIDE_MODEL, temperature: SEED_TEMPERATURE })

    await chrome.back(app.window).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 10_000 })
    await reader.composer(app.window).fill('E2E-MODELS I draw the blade and wait.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-MODELS-REPLY', { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    await waitForTurnTerminal(app.window)
    expect(lastNarrativeModel(mock)).toBe(OVERRIDE_MODEL)
    // The override's own copy, not the profile: an override sent no settings before it carried any.
    expect(lastNarrativeBody(mock)?.temperature).toBe(SEED_TEMPERATURE)

    mock.setNarrative(REPLY_CLEARED)

    await storySettings.openFromReader(app.window).click()
    await storySettings.modelsTab(app.window).click()
    await storySettings
      .clearOverride(
        storySettings.modelRow(app.window, 'narrative'),
        t('storySettings:models.narrative'),
      )
      .click()
    await expect(storySettings.modelRow(app.window, 'narrative')).toContainText(
      t('storySettings:models.appDefault', { model: SEED_MODEL, profile: SEED_PROFILE }),
    )
    await expect(storySettings.save(app.window)).toBeVisible()
    await storySettings.save(app.window).click()
    await expect(storySettings.save(app.window)).toBeHidden()
    await expect.poll(async () => (await readModels(app)).narrative).toBeUndefined()

    await chrome.back(app.window).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 10_000 })
    await reader.composer(app.window).fill('E2E-MODELS-2 I listen for the bell.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-MODELS-REPLY-2', { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    await waitForTurnTerminal(app.window)
    expect(lastNarrativeModel(mock)).toBe(SEED_MODEL)
  })
})
