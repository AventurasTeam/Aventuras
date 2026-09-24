import { expect, test } from '@playwright/test'

import type { StorySettings } from '@/lib/db'

import { takeTurn } from '../flows/turn'
import { captureForTurn, currentBranchId, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  enableDiagnostics,
  enableStoryProbeMode,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

// Story Settings → Memory keyword mode (retrieval.md → Keyword injection): the
// saved mode governs the NEXT turn's retrieval. Two turns over one keyword,
// Boost then Inject, attribute the seating to the save, not to the keyword.
// Only a running app crosses that seam (docs/testing.md → Coverage).

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// Keyword of exactly one seeded lore row, of no entity, and of no seeded entry
// — so it reaches the scan surface only by being typed into the composer.
const KEYWORD = 'archivists'
const BOOST_MARKER = 'E2E-KW-BOOST-REPLY'
const INJECT_MARKER = 'E2E-KW-INJECT-REPLY'

async function keywordMode(app: LaunchedApp): Promise<StorySettings['keywordRetrieval']['mode']> {
  const [[json]] = await queryApp(app.window, `SELECT settings FROM stories WHERE id = ?`, [
    HERO_STORY,
  ])
  return (JSON.parse(json as string) as StorySettings).keywordRetrieval.mode
}

test.describe('story settings — keyword Inject seats a keyworded lore row', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn without an installed
    // embedder never reaches the reply; a cold cache downloads ~24 MB first.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(`${BOOST_MARKER} the archive door stays shut.`)
    setProviderEndpoint(seeded.dbPath, mock.url)
    // Both probe gates: app diagnostics and the story's probe_mode_active. The
    // save below patches only the memory-knob keys, so the story half survives.
    enableDiagnostics(seeded.dbPath)
    enableStoryProbeMode(seeded.dbPath, HERO_STORY)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('the same keyword is inert under Boost and seats the lore row once Inject is saved', async () => {
    test.setTimeout(180_000)
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    const branchId = await currentBranchId(app.window, HERO_STORY)

    // Seeded ids travel through substituteIds, so the row is found by keyword,
    // not named. `keywords` is a JSON array, so the quotes pin the match to a
    // whole element rather than a substring of a longer keyword.
    const loreRows = await queryApp(
      app.window,
      `SELECT id, injection_mode FROM lore WHERE branch_id = ? AND keywords LIKE ?`,
      [branchId, `%"${KEYWORD}"%`],
    )
    expect(loreRows.length, 'one seeded lore row is keyworded on the term').toBe(1)
    const loreId = loreRows[0][0] as string
    // The keyword pool is what the structural floor did NOT seat: an `always`
    // row is never keyword-injectable (lib/retrieval → filterLorePool) and a
    // `disabled` one is filtered outright. Asserted so a seed edit that flipped
    // this row fails here, not as an unexplained seating miss below.
    expect(loreRows[0][1], 'a floor-seated row is never a keyword-injection candidate').toBe('auto')
    // The before-state named at the settings layer, not assumed from the seed:
    // it is what the save below is a change FROM.
    expect(await keywordMode(app), 'the story starts on the default Boost mode').toBe('boost')

    const boostTargetEntryId =
      await test.step('under Boost the keyword reaches the scan surface and injects nothing', async () => {
        await takeTurn(app.window, `E2E-KW-1 I press the ${KEYWORD} for a name.`, BOOST_MARKER)
        const capture = await captureForTurn(app.window, branchId, undefined)
        // Lowercased as matchTerms does, so the empty array below is a
        // statement about the mode rather than about a term that never arrived.
        expect(capture.scan_text.toLowerCase()).toContain(KEYWORD)
        // Negative control: the same keyword seats nothing while the mode gate
        // (lib/retrieval/injection.ts → buildKeywordInjections' early return)
        // is live. Delete it and a mode-ignoring regression keeps Inject green.
        expect(capture.keyword_injections).toEqual([])
        return capture.target_entry_id
      })

    await test.step('the Memory tab saves the mode as inject', async () => {
      await storySettings.openFromReader(app.window).click()
      await storySettings.memoryTab(app.window).click()
      await expect(storySettings.memoryKnobsPanel(app.window)).toBeVisible()
      await storySettings.keywordInjectOption(app.window).click()
      await expect(storySettings.save(app.window)).toBeVisible()
      await storySettings.save(app.window).click()
      await expect(storySettings.save(app.window)).toBeHidden()
      await expect.poll(() => keywordMode(app)).toBe('inject')
    })

    await test.step('the next turn seats the keyworded lore row', async () => {
      mock.setNarrative(`${INJECT_MARKER} the archive door opens.`)
      await chrome.back(app.window).click()
      await expect(reader.composer(app.window)).toBeVisible({ timeout: 10_000 })
      await takeTurn(app.window, `E2E-KW-2 I press the ${KEYWORD} once more.`, INJECT_MARKER)

      const capture = await captureForTurn(app.window, branchId, boostTargetEntryId)
      const injected = capture.keyword_injections.find((row) => row.target_id === loreId)
      expect(injected, 'the keyworded lore row is a keyword injection').toBeDefined()
      expect(injected?.target_kind).toBe('lore')
      expect(injected?.terms).toContain(KEYWORD)
      // `seated: false` would mean the row matched but the budget cut it, which
      // is not the claim: seating is what puts it in the prompt.
      expect(injected?.seated).toBe(true)
    })
  })
})
