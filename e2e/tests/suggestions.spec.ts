import { expect, test, type Page } from '@playwright/test'

import type { EntryMetadata } from '@/lib/db'

import { queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  disablePiggybackCapability,
  removeUserDataDir,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Next-turn suggestion chips (docs/ui/screens/reader-composer). Coverage
// targets the seams a running app is the only place to observe: the narrative
// fold's <suggestions> tag surviving a real render pass without leaking into
// the prose, the refresh pipeline's own agent/schema round-trip through the
// mock, CTRL-Z reversing a re-roll as its own delta-log unit, and the
// classifier-fold fallback when the narrative fold can't ride in-band. Pure
// parse/clamp/resolver-race logic already has thorough unit coverage
// (lib/pipeline/definitions/suggestion-refresh.test.ts,
// lib/actions/suggestions/refresh-suggestions.test.ts) and Storybook owns the
// strip's render variants (loading / error / empty-state) — none of that is
// re-driven here. See docs/testing.md → Coverage.

// Derived, not hand-duplicated: the first spec to parse the metadata column,
// so a future rename/variant on the real schema fails typecheck here instead
// of silently drifting until some assertion fails for a confusing reason.
type PersistedSuggestions = NonNullable<EntryMetadata['nextTurnSuggestions']>

async function currentBranchId(page: Page): Promise<string> {
  const rows = await queryApp(page, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
  return rows[0]?.[0] as string
}

// Reads the row the strip anchors to. Mirrors findSuggestionAnchor
// (lib/piggyback/suggestion-slots.ts): the highest-position AI-authored entry,
// skipping `user_action` and `system` tails. Highest-position alone would
// coincide today and diverge the moment a spec asserts after a submit or a
// failed turn — the two would then read different rows and the mismatch would
// look like a chip bug.
// metadata comes back as a raw JSON string: queryApp is a raw SQL bridge, not
// drizzle's typed select, so the column's `mode: 'json'` transform never runs.
async function readAnchorEntry(
  page: Page,
  branchId: string,
): Promise<{ id: string; suggestions?: PersistedSuggestions }> {
  const rows = await queryApp(
    page,
    `SELECT id, metadata FROM story_entries WHERE branch_id = ? AND kind IN ('ai_reply', 'opening')
     ORDER BY position DESC LIMIT 1`,
    [branchId],
  )
  const [id, raw] = rows[0] as [string, string | null]
  const metadata = raw ? (JSON.parse(raw) as { nextTurnSuggestions?: PersistedSuggestions }) : null
  return { id, suggestions: metadata?.nextTurnSuggestions }
}

const NARRATIVE_REPLY = 'E2E-SUGGEST-TURN the rain finds the gaps in the rooftop again.'
const CHIP_ACT_1 = 'E2E-CHIP-ACT-1 I press deeper into the Hollow, listening.'
const CHIP_SPEAK_1 = 'E2E-CHIP-SPEAK-1 I ask Mira what she saw in the market.'
const CHIP_ACT_2 = 'E2E-CHIP-ACT-2 I draw the blade and wait for footsteps.'

// Prose, then an (empty but well-formed) <state> block, then <suggestions> —
// an empty <state> still makes parseStateBlock report blockFound with no
// failures, so the piggyback fold succeeds outright and the per-turn fallback
// classifier never fires. Without it, a missing/failed <state> would trigger
// that fallback as an extra async structured call racing the steps below.
const NARRATIVE_WITH_TAGS = `${NARRATIVE_REPLY}
<state>
</state>
<suggestions>
  <item category="cat1">${CHIP_ACT_1}</item>
  <item category="cat2">${CHIP_SPEAK_1}</item>
  <item category="cat1">${CHIP_ACT_2}</item>
</suggestions>`

const REFRESH_CHIP_ACT = 'E2E-REFRESH-CHIP-ACT the alley narrows and Vorne is already waiting.'
const REFRESH_CHIP_SPEAK = 'E2E-REFRESH-CHIP-SPEAK I call a name into the dark and wait.'

test.describe('next-turn suggestions — narrative (piggyback) fold', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    mock = await startMockLlm()
    mock.setNarrative(NARRATIVE_WITH_TAGS)
    setProviderEndpoint(seeded.dbPath, mock.url)
    // Piggyback is on by default in the fixture (piggybackMode: 'on' +
    // taggedBlockReliable) — the narrative fold is the path under test here.
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('a turn emits chips via the tagged block, tap fills the composer, refresh re-rolls, and CTRL-Z undoes the re-roll', async () => {
    test.setTimeout(120_000)

    // Steps split the sequential journey in the reporter/trace: a failure at
    // step 3 shouldn't read as "unknown state somewhere in a 100-line test" —
    // it should point straight at "refresh" with steps 1-2 marked passed.
    let branchId = ''
    let entryId = ''

    await test.step('send a turn with a piggyback-tagged narrative reply', async () => {
      await home.openStory(app.window, 'The Veilstone Courier').click()
      await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
      await reader.composer(app.window).fill('E2E-SUGGEST-USER I listen at the door.')
      await reader.send(app.window).click()
      await expect(app.window.getByText('E2E-SUGGEST-TURN', { exact: false })).toBeVisible({
        timeout: 30_000,
      })
      branchId = await currentBranchId(app.window)
      // That text matches the STREAMING placeholder, which renders while the
      // run is still in flight — the ai_reply row lands at the end of the
      // narrative phase. Without this poll the next step's DB read races the
      // insert and comes back with the user_action row instead.
      await expect
        .poll(async () => (await readAnchorEntry(app.window, branchId)).suggestions?.source, {
          timeout: 30_000,
        })
        .toBe('piggyback')
    })

    await test.step('chips persist via the piggyback fold and render without leaking trailing blocks', async () => {
      const terminal = await readAnchorEntry(app.window, branchId)
      entryId = terminal.id
      expect(terminal.suggestions?.source).toBe('piggyback')
      expect(terminal.suggestions?.items).toEqual([
        { categoryId: 'act', text: CHIP_ACT_1 },
        { categoryId: 'speak', text: CHIP_SPEAK_1 },
        { categoryId: 'act', text: CHIP_ACT_2 },
      ])

      await expect(reader.suggestionChip(app.window, 'Act', CHIP_ACT_1)).toBeVisible()
      await expect(reader.suggestionChip(app.window, 'Speak', CHIP_SPEAK_1)).toBeVisible()
      await expect(reader.suggestionChip(app.window, 'Act', CHIP_ACT_2)).toBeVisible()

      // The entry's own rendered row must show only the prose — not the raw
      // tag markup, and not the chip prose the tags carried — the exact leak
      // stripTrailingBlocks exists to prevent.
      const entryRow = reader.row(app.window, entryId)
      await expect(entryRow).toContainText('E2E-SUGGEST-TURN')
      await expect(entryRow).not.toContainText('<suggestions>')
      await expect(entryRow).not.toContainText('<state>')
      await expect(entryRow).not.toContainText(CHIP_ACT_1)
    })

    await test.step('tap fills the composer in Free mode', async () => {
      // Switch away from Free first so the forced-Free-on-tap behavior is
      // actually exercised, not just coincidentally already true.
      await reader.modeTrigger(app.window).click()
      await reader.modeOption(app.window, 'do').click()

      await reader.suggestionChip(app.window, 'Act', CHIP_ACT_1).click()
      await expect(reader.composer(app.window)).toHaveValue(CHIP_ACT_1)
      await expect(reader.modeTrigger(app.window)).toHaveText(
        new RegExp(t('reader:composerMode.free')),
      )
    })

    await test.step('refresh re-rolls through the dedicated pipeline, passing the composer text as refreshGuidance', async () => {
      mock.setStructured('suggestion-refresh', {
        suggestions: [
          { categoryRef: 'cat1', text: REFRESH_CHIP_ACT },
          { categoryRef: 'cat2', text: REFRESH_CHIP_SPEAK },
        ],
      })
      await reader.suggestionRefresh(app.window).click()

      await expect(reader.suggestionChip(app.window, 'Act', REFRESH_CHIP_ACT)).toBeVisible({
        timeout: 15_000,
      })
      await expect(reader.suggestionChip(app.window, 'Speak', REFRESH_CHIP_SPEAK)).toBeVisible()
      await expect(reader.suggestionChip(app.window, 'Act', CHIP_ACT_1)).toHaveCount(0)

      const refreshed = await readAnchorEntry(app.window, branchId)
      expect(refreshed.id).toBe(entryId)
      expect(refreshed.suggestions).toEqual({
        items: [
          { categoryId: 'act', text: REFRESH_CHIP_ACT },
          { categoryId: 'speak', text: REFRESH_CHIP_SPEAK },
        ],
        source: 'refresh',
        refreshGuidance: CHIP_ACT_1,
      })
    })

    await test.step('CTRL-Z reverses the re-roll as its own unit, restoring the prior chips', async () => {
      // The refresh shares no actionId with the turn, so undo must not touch
      // the AI reply itself. Blur first: the global shortcut ignores editable
      // targets (so native textarea undo wins there), and the composer may
      // still hold focus from the chip tap.
      await app.window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await app.window.keyboard.press('Control+z')

      await expect(reader.suggestionChip(app.window, 'Act', CHIP_ACT_1)).toBeVisible({
        timeout: 15_000,
      })
      await expect(reader.suggestionChip(app.window, 'Act', REFRESH_CHIP_ACT)).toHaveCount(0)

      const undone = await readAnchorEntry(app.window, branchId)
      expect(undone.id).toBe(entryId)
      expect(undone.suggestions).toEqual({
        items: [
          { categoryId: 'act', text: CHIP_ACT_1 },
          { categoryId: 'speak', text: CHIP_SPEAK_1 },
          { categoryId: 'act', text: CHIP_ACT_2 },
        ],
        source: 'piggyback',
      })
    })
  })
})

const CLASSIFIER_NARRATIVE = 'E2E-SUGGEST-CLASSIFIER-TURN the corridor exhales old dust.'
const CLASSIFIER_CHIP_ACT =
  'E2E-CLASSIFIER-CHIP-ACT I climb toward the keep before the lamps light.'
const CLASSIFIER_CHIP_SPEAK = 'E2E-CLASSIFIER-CHIP-SPEAK I bargain with the watchman for a name.'

// With piggyback disabled, chips can't ride the narrative's in-band tag, so
// they arrive via the separate structured fallback-classifier call instead —
// the seam with the most machinery (a second schema, the mock's agent
// matching) and the least unit coverage. See docs/testing.md → Mock LLM.
test.describe('next-turn suggestions — classifier fold', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    mock = await startMockLlm()
    mock.setNarrative(CLASSIFIER_NARRATIVE)
    mock.setStructured('per-turn-classifier-suggestions', {
      sceneEntities: [],
      worldTimeDelta: 0,
      suggestions: [
        { categoryRef: 'cat1', text: CLASSIFIER_CHIP_ACT },
        { categoryRef: 'cat2', text: CLASSIFIER_CHIP_SPEAK },
      ],
    })
    setProviderEndpoint(seeded.dbPath, mock.url)
    disablePiggybackCapability(seeded.dbPath)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('chips arrive via the fallback classifier with source: classifier', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-SUGGEST-CLASSIFIER-USER I check the corridor.')
    await reader.send(app.window).click()

    await expect(app.window.getByText('E2E-SUGGEST-CLASSIFIER-TURN', { exact: false })).toBeVisible(
      { timeout: 30_000 },
    )

    await expect(reader.suggestionChip(app.window, 'Act', CLASSIFIER_CHIP_ACT)).toBeVisible({
      timeout: 15_000,
    })
    await expect(reader.suggestionChip(app.window, 'Speak', CLASSIFIER_CHIP_SPEAK)).toBeVisible()

    const branchId = await currentBranchId(app.window)
    const { suggestions } = await readAnchorEntry(app.window, branchId)
    expect(suggestions?.source).toBe('classifier')
    expect(suggestions?.items).toEqual([
      { categoryId: 'act', text: CLASSIFIER_CHIP_ACT },
      { categoryId: 'speak', text: CLASSIFIER_CHIP_SPEAK },
    ])
  })
})
