import { expect, test, type Page } from '@playwright/test'

import { goToChapterTimeline, goToReader, openStory } from '../flows/navigation'
import {
  chapterByTitle,
  type ChapterRow,
  currentBranchId,
  queryApp,
  queryScalar,
} from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, toolLaneKey, type MockLlm } from '../harness/mock-llm'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import {
  createSeededUserDataDir,
  removeUserDataDir,
  setChapterAutoClose,
  setProviderEndpoint,
} from '../harness/seed'
import { chapterTimeline } from '../locators/chapter-timeline'
import { memoryBanner } from '../locators/memory-banner'
import { reader, undoText } from '../locators/reader'
import { rerunConfirm } from '../locators/rerun-confirm'
import { reviewWindow } from '../locators/review-window'

// Re-running a close (chapter-timeline.md → Re-run a close), UI-driven and DB-asserted on the bare
// hero seed, whose latest close wrote one change: Vorne's traits (lib/db/devtools/seed-dataset.ts).
const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// By title, never by position (milestone C8).
const CHAPTER = 'The Keep Leans Closer'
const CLOSE_ACTION = 'act_chapter_2'
const VORNE = 'Vorne'
const TRAITS_AFTER_CLOSE = ['patient', 'merciless']
const TRAITS_BEFORE_CLOSE = ['patient']
// memory/chapter-close.md → Run order: Lore's tools key its lane; every other lane ends its task.
const LORE_TOOLS = ['read_row', 'create_lore', 'update_lore'] as const
const FIRST_LORE = {
  title: 'The Keep Bell Rota',
  body: 'The keep rings its bell on the hour from dusk to dawn.',
}
const SECOND_LORE = {
  title: 'The Watch Ledger',
  body: 'The Watch keeps a ledger of every name the bell tower hears.',
}
// A re-run makes no call in boundary or metadata (C2): neither lane is asked.
const UNASKED = ['chapter-boundary', 'chapter-metadata']

const call = (name: string, args: Record<string, unknown>) => ({ toolCalls: [{ name, args }] })

// Serial, one app: the shortcut case runs first and leaves no turns after the chapter behind it.
test.describe.serial('re-running a close', () => {
  let app: LaunchedApp | undefined
  let mock: MockLlm | undefined
  let userDataDir: string | undefined
  let branchId: string
  let chapter: ChapterRow
  // The close's group as the seed logs it: what each CTRL-Z of a re-run gives back.
  let closeGroup: unknown[][]
  let firstRerun: string
  let secondRerun: string

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    // A re-run refuses while a close is owed; auto-close off keeps the region out of it.
    setChapterAutoClose(seeded.dbPath, HERO_STORY, false)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  function page(): Page {
    if (!app) throw new Error('the hero app has not launched')
    return app.window
  }

  function liveMock(): MockLlm {
    if (!mock) throw new Error('the mock has closed')
    return mock
  }

  const groupOf = (actionId: string) =>
    queryApp(
      page(),
      `SELECT id, log_position, target_table, target_id, op FROM deltas
        WHERE branch_id = ? AND action_id = ? ORDER BY log_position`,
      [branchId, actionId],
    )

  async function reportAction(): Promise<unknown> {
    const rows = await queryApp(
      page(),
      `SELECT json_extract(close_report, '$.actionId') FROM chapters WHERE branch_id = ? AND id = ?`,
      [branchId, chapter.id],
    )
    return rows[0]?.[0]
  }

  async function vorneTraits(): Promise<unknown> {
    const rows = await queryApp(
      page(),
      `SELECT json_extract(state, '$.traits') FROM entities WHERE branch_id = ? AND name = ?`,
      [branchId, VORNE],
    )
    expect(rows, 'one Vorne on the branch').toHaveLength(1)
    return JSON.parse(rows[0]![0] as string)
  }

  const journals = () =>
    queryScalar(page(), `SELECT COUNT(*) FROM reversal_journals WHERE branch_id = ?`, [branchId])

  const entriesPastEnd = () =>
    queryScalar(page(), `SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND position > ?`, [
      branchId,
      chapter.endPosition,
    ])

  const entriesThroughEnd = () =>
    queryScalar(
      page(),
      `SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND position <= ?`,
      [branchId, chapter.endPosition],
    )

  async function closeRuns(): Promise<[string, string | null][]> {
    const rows = await queryApp(
      page(),
      `SELECT action_id, outcome FROM pipeline_runs
        WHERE kind = 'chapter-close' AND story_id = ? ORDER BY started_at, rowid`,
      [HERO_STORY],
    )
    return rows.map(([actionId, outcome]) => [actionId as string, outcome as string | null])
  }

  const loreCount = (title: string) =>
    queryScalar(page(), `SELECT COUNT(*) FROM lore WHERE branch_id = ? AND title = ?`, [
      branchId,
      title,
    ])

  const loreCreateActions = (title: string) =>
    queryApp(
      page(),
      `SELECT d.action_id FROM deltas d
         JOIN lore l ON l.branch_id = d.branch_id AND l.id = d.target_id
        WHERE d.branch_id = ? AND l.title = ? AND d.op = 'create'`,
      [branchId, title],
    )

  // `setToolSteps` replaces the lane's queue, so each re-run scripts its own write.
  function scriptLore(lore: { title: string; body: string }): void {
    liveMock().setToolSteps(LORE_TOOLS, [
      call('create_lore', { ...lore, turns: ['t1'], why: 'The chapter’s first turn sets it out.' }),
    ])
  }

  async function expandCard(): Promise<void> {
    const head = chapterTimeline.cardHead(page(), chapter.id)
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
    await expect(head).toHaveAttribute('aria-expanded', 'true')
  }

  // The run started after `before` runs: its action, once it committed.
  async function committedRerun(before: number): Promise<string> {
    await expect
      .poll(async () => (await closeRuns()).slice(before), {
        timeout: 120_000,
        message: 'the re-run never finished',
      })
      .toEqual([[expect.any(String), expect.any(String)]])
    const [[actionId, outcome]] = (await closeRuns()).slice(before)
    expect(outcome, 'the re-run committed').toBe('completed')
    expect(actionId).not.toBe(CLOSE_ACTION)
    return actionId
  }

  async function expectRerunLanded(
    actionId: string,
    lore: { title: string },
    requestsBefore: number,
  ): Promise<void> {
    expect(await reportAction(), "the report is the re-run's").toBe(actionId)
    expect(await loreCreateActions(lore.title), "the scripted write is the re-run's").toEqual([
      [actionId],
    ])
    expect(await vorneTraits(), "the reversal took the close's change").toEqual(TRAITS_BEFORE_CLOSE)
    expect(await groupOf(CLOSE_ACTION), 'the close keeps its row, stamps and report').toEqual(
      closeGroup.filter(([, , table]) => table === 'chapters' || table === 'story_entries'),
    )
    expect(await journals()).toBe(1)
    const asked = liveMock()
      .requests.slice(requestsBefore)
      .map((request) => request.agent)
    expect(asked).toContain(toolLaneKey(LORE_TOOLS))
    for (const agent of UNASKED) expect(asked).not.toContain(agent)
    await expect(memoryBanner.rerun(page(), chapter.sequenceNumber)).toBeVisible()
  }

  async function undoTheRerun(): Promise<void> {
    await goToReader(page())
    await expect(reader.composer(page())).toBeVisible()
    // The shortcut ignores editable targets, and the composer can hold focus on return.
    await page().evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page().keyboard.press('Control+z')
    await expect(
      reader.undoConfirm(page(), undoText('title', 'rerun', { number: chapter.sequenceNumber })),
    ).toBeVisible()
    await reader.undoConfirmUndo(page()).click()
    await expect.poll(reportAction, { timeout: 15_000 }).toBe(CLOSE_ACTION)
  }

  async function expectCloseRestored(actionId: string, lore: { title: string }): Promise<void> {
    expect(await groupOf(CLOSE_ACTION), 'the close, its deltas at their positions').toEqual(
      closeGroup,
    )
    expect(await groupOf(actionId)).toEqual([])
    expect(await vorneTraits()).toEqual(TRAITS_AFTER_CLOSE)
    expect(await loreCount(lore.title)).toBe(0)
    expect(await journals()).toBe(0)
  }

  test('from the card with turns since: Roll back & re-run removes them and re-runs the close', async () => {
    test.setTimeout(180_000)
    await openStory(page(), HERO_TITLE)
    branchId = await currentBranchId(page(), HERO_STORY)
    chapter = await chapterByTitle(page(), branchId, CHAPTER)
    closeGroup = await groupOf(CLOSE_ACTION)
    expect(closeGroup.length).toBeGreaterThan(0)
    expect(await reportAction()).toBe(CLOSE_ACTION)
    expect(await vorneTraits()).toEqual(TRAITS_AFTER_CLOSE)
    // Turns since: entries past the chapter's end, whose creates sit above its group (the seed's log).
    expect(await entriesPastEnd()).toBeGreaterThan(0)
    const throughEnd = await entriesThroughEnd()

    scriptLore(FIRST_LORE)
    await goToChapterTimeline(page())
    await expandCard()
    await expect(chapterTimeline.rerunClose(page(), chapter.id)).toBeEnabled()
    await chapterTimeline.rerunClose(page(), chapter.id).click()

    const confirm = rerunConfirm(page())
    await expect(confirm.root).toBeVisible()
    await expect(confirm.root).toContainText(
      t('chapters:rerunConfirm.title', { number: chapter.sequenceNumber }),
    )
    await expect(confirm.root).toContainText(t('chapters:rerunConfirm.rollbackWarning'))
    await expect(confirm.cancel).toBeEnabled()
    await expect(confirm.rollbackAndRerun).toBeEnabled()
    await expect(confirm.rerunOnBranch).toBeDisabled()
    await expect(confirm.rerun).toHaveCount(0)

    const runsBefore = (await closeRuns()).length
    const requestsBefore = liveMock().requests.length
    await confirm.rollbackAndRerun.click()
    await expect.poll(entriesPastEnd, { timeout: 15_000 }).toBe(0)
    expect(await entriesThroughEnd(), 'the chapter keeps every entry').toBe(throughEnd)
    firstRerun = await committedRerun(runsBefore)
    await expect(confirm.root).toHaveCount(0)
    await expectRerunLanded(firstRerun, FIRST_LORE, requestsBefore)
  })

  test('CTRL-Z from the reader brings the first close back', async () => {
    await undoTheRerun()
    await expectCloseRestored(firstRerun, FIRST_LORE)
  })

  test('from the review window with no turns since: the confirm opens alone, and its Cancel reopens the window', async () => {
    await goToChapterTimeline(page())
    await expandCard()
    await chapterTimeline.reviewChanges(page(), chapter.id).click()
    await expect(reviewWindow.window(page())).toBeVisible()
    await reviewWindow.rerun(page()).click()

    const confirm = rerunConfirm(page())
    await expect(confirm.root).toBeVisible()
    await expect(reviewWindow.mounted(page())).toHaveCount(0)
    await expect(confirm.root).not.toContainText(t('chapters:rerunConfirm.rollbackWarning'))
    await expect(confirm.rerun).toBeEnabled()
    await expect(confirm.rollbackAndRerun).toHaveCount(0)
    await expect(confirm.rerunOnBranch).toHaveCount(0)

    await confirm.cancel.click()
    await expect(confirm.root).toHaveCount(0)
    await expect(reviewWindow.window(page())).toBeVisible()
  })

  test('Re-run… again and confirming commits the re-run; CTRL-Z restores the close the same way', async () => {
    test.setTimeout(180_000)
    scriptLore(SECOND_LORE)
    await reviewWindow.rerun(page()).click()
    const confirm = rerunConfirm(page())
    await expect(confirm.root).toBeVisible()

    const runsBefore = (await closeRuns()).length
    const requestsBefore = liveMock().requests.length
    // Held mid-re-run: a commit would close any window left over the report it no longer holds.
    liveMock().holdNextStructured(toolLaneKey(LORE_TOOLS))
    try {
      await confirm.rerun.click()
      await expect
        .poll(
          () =>
            liveMock()
              .requests.slice(requestsBefore)
              .some((request) => request.agent === toolLaneKey(LORE_TOOLS)),
          { timeout: 60_000, message: "the re-run never reached Lore's call" },
        )
        .toBe(true)
      await expect(confirm.root).toHaveCount(0)
      // Confirming leaves the window closed.
      await expect(reviewWindow.mounted(page())).toHaveCount(0)
    } finally {
      liveMock().releaseStructured()
    }
    secondRerun = await committedRerun(runsBefore)
    await expectRerunLanded(secondRerun, SECOND_LORE, requestsBefore)

    await undoTheRerun()
    await expectCloseRestored(secondRerun, SECOND_LORE)
  })

  test('every scripted step was taken', async () => {
    const closing = liveMock()
    mock = undefined
    await expect(closing.close()).resolves.toBeUndefined()
  })
})
