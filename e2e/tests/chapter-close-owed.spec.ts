import { expect, test, type Page } from '@playwright/test'

import { passProbe } from '../flows/classifier-pass'
import { openStory } from '../flows/navigation'
import { FixtureDb, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { copyNumber, copyPattern, t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  removeUserDataDir,
  setChapterTokenThreshold,
  setProviderEndpoint,
} from '../harness/seed'
import { chrome } from '../locators/chrome'
import { memoryBanner } from '../locators/memory-banner'
import { reader } from '../locators/reader'
import { toast } from '../locators/toast'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// The hero story's current branch in the fixture, read from the file before launch.
const HERO_BRANCH = 'br_hero_main'
// The harness keys structured calls by STRUCTURED_SHAPES name.
const METADATA = 'chapter-metadata'
const CHAPTER = {
  title: 'The Satchel at the Gate',
  summary: 'Kael hands the courier’s satchel to the gatekeeper and asks for the north road.',
  theme: 'debts settled at thresholds',
  keywords: ['satchel', 'gate', 'north road'],
}

const OPEN_REGION = `FROM story_entries WHERE branch_id = ? AND chapter_id IS NULL AND kind <> 'system'`

// The seeded open region's count. One token over it, nothing is owed before the first Send and
// that Send's turn owes a close.
function seededOpenRegionTokens(dbPath: string): number {
  const db = new FixtureDb(dbPath)
  try {
    const row = db.get<{ tokens: number }>(
      `SELECT COALESCE(SUM(content_tokens), 0) AS tokens ${OPEN_REGION}`,
      HERO_BRANCH,
    )
    const tokens = Number(row?.tokens ?? 0)
    // Rows seeded without content_tokens read 0: the turn would cross alone, from nowhere near it.
    if (tokens <= 0) throw new Error(`${HERO_BRANCH}'s seeded open region counts ${tokens} tokens`)
    return tokens
  } finally {
    db.close()
  }
}

type Hero = { readonly app: LaunchedApp; readonly mock: MockLlm }

// Registers its describe's launch: the hero story one token under its threshold, and the mock
// answering the close's metadata call.
function launchesHero(): () => Hero {
  let app: LaunchedApp | undefined
  let mock: MockLlm | undefined
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks narrative: no installed embedder, no reply.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    const threshold = seededOpenRegionTokens(seeded.dbPath) + 1
    setChapterTokenThreshold(seeded.dbPath, HERO_STORY, threshold)
    mock = await startMockLlm()
    mock.setStructured(METADATA, CHAPTER)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  return () => {
    if (!app || !mock) throw new Error('the hero app has not launched')
    return { app, mock }
  }
}

// The reads and drivers the describes share, each over its own launch.
function closeProbe(hero: () => Hero) {
  const page = (): Page => hero().app.window
  const mock = (): MockLlm => hero().mock
  const {
    branchId,
    entryIdByContent,
    pollEntryId,
    createDelta,
    passOutcomes,
    runOutcome,
    passDeltas,
    send,
  } = passProbe(page, mock)

  const scalar = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await queryApp(page(), sql, params))[0]?.[0])

  // pipeline_runs has no branch column; only the hero story's runs happen in this app.
  async function closeOutcomes(): Promise<(string | null)[]> {
    const rows = await queryApp(
      page(),
      `SELECT outcome FROM pipeline_runs WHERE kind = 'chapter-close' AND story_id = ?
       ORDER BY started_at, rowid`,
      [HERO_STORY],
    )
    return rows.map((r) => r[0] as string | null)
  }

  const chapterCount = (branch: string): Promise<number> =>
    scalar(`SELECT COUNT(*) FROM chapters WHERE branch_id = ?`, [branch])

  const openRegionTokens = (branch: string): Promise<number> =>
    scalar(`SELECT COALESCE(SUM(content_tokens), 0) ${OPEN_REGION}`, [branch])

  const threshold = (): Promise<number> =>
    scalar(`SELECT json_extract(settings, '$.chapterTokenThreshold') FROM stories WHERE id = ?`, [
      HERO_STORY,
    ])

  const logHead = (branch: string): Promise<number> =>
    scalar(`SELECT COALESCE(MAX(log_position), 0) FROM deltas WHERE branch_id = ?`, [branch])

  const closeDeltasAfter = (branch: string, logPosition: number): Promise<number> =>
    scalar(
      `SELECT COUNT(*) FROM deltas
       WHERE branch_id = ? AND source = 'chapter_close' AND log_position > ?`,
      [branch, logPosition],
    )

  // The open region's first row and latest reply, read before a turn: a close with no pick after
  // that turn ends on the reply before the head, so here, and the turn stays open.
  async function rangeBeforeTurn(branch: string): Promise<{ start: string; end: string }> {
    const rows = (await queryApp(page(), `SELECT id, kind ${OPEN_REGION} ORDER BY position`, [
      branch,
    ])) as [string, string][]
    const replies = rows.filter(([, kind]) => kind === 'ai_reply')
    expect(replies.length, 'the open region holds a reply to end on').toBeGreaterThan(0)
    return { start: rows[0][0], end: replies[replies.length - 1][0] }
  }

  const metadataCalls = (): number => mock().requests.filter((r) => r.agent === METADATA).length
  const streamedCalls = (): number => mock().requests.filter((r) => r.streamed).length

  // The held close's action id, once its metadata call reached the mock past `callsBefore`. A
  // release before the call arrives would leave it held for good.
  async function heldClose(callsBefore: number): Promise<string> {
    await expect.poll(metadataCalls, { timeout: 30_000 }).toBeGreaterThan(callsBefore)
    const rows = await queryApp(
      page(),
      `SELECT action_id FROM pipeline_runs
       WHERE kind = 'chapter-close' AND story_id = ? AND finished_at IS NULL`,
      [HERO_STORY],
    )
    expect(rows, 'one close in flight').toHaveLength(1)
    return rows[0][0] as string
  }

  // The branch's system entries as the reader persisted them: Retry reads `close` back.
  async function systemEntries(branch: string): Promise<unknown[][]> {
    return queryApp(
      page(),
      `SELECT json_extract(metadata, '$.systemFailure.close'),
              json_extract(metadata, '$.systemFailure.pass'),
              json_extract(metadata, '$.systemFailure.kind'),
              json_extract(metadata, '$.systemFailure.failure'),
              json_extract(metadata, '$.systemFailure.submission'),
              content
       FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
      [branch],
    )
  }

  const systemEntryIds = async (branch: string): Promise<string[]> =>
    (
      await queryApp(
        page(),
        `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
        [branch],
      )
    ).map((r) => r[0] as string)

  const closeFailureToast = () => toast.withText(page(), t('chrome.chapterCloseFailed'))
  const closeDeferralToast = () => toast.withText(page(), t('chrome.deferredWork.close'))

  return {
    branchId,
    entryIdByContent,
    pollEntryId,
    createDelta,
    passOutcomes,
    runOutcome,
    actionDeltas: passDeltas,
    send,
    closeOutcomes,
    chapterCount,
    openRegionTokens,
    threshold,
    logHead,
    closeDeltasAfter,
    rangeBeforeTurn,
    metadataCalls,
    streamedCalls,
    heldClose,
    systemEntries,
    systemEntryIds,
    closeFailureToast,
    closeDeferralToast,
  }
}

// memory/chapter-close.md → Failure modes, at the seams only a running app reaches: toast, entry,
// Cancel, Retry. Serial: each test builds on the last.
test.describe('chapter close owed — a close that fails', () => {
  test.describe.configure({ mode: 'serial' })

  const hero = launchesHero()
  const {
    branchId,
    entryIdByContent,
    pollEntryId,
    passOutcomes,
    runOutcome,
    send,
    closeOutcomes,
    chapterCount,
    openRegionTokens,
    threshold,
    logHead,
    closeDeltasAfter,
    rangeBeforeTurn,
    metadataCalls,
    streamedCalls,
    heldClose,
    systemEntries,
    systemEntryIds,
    closeFailureToast,
  } = closeProbe(hero)

  const U2 = 'E2E-OWED-U2 I ask the gatekeeper for the north road.'
  const U3 = 'E2E-OWED-U3 I wait for the bar to lift.'
  let chaptersBefore: number
  let range: { start: string; end: string }
  // The entry the failed Send wrote, as the cancelled Send must put it back.
  let closeEntry: unknown[][]

  test('a turn over the threshold chains a pass and a close, whose failure only warns', async () => {
    const page = hero().app.window
    await openStory(page, HERO_TITLE)
    const branch = await branchId()
    chaptersBefore = await chapterCount(branch)
    range = await rangeBeforeTurn(branch)
    const head = await logHead(branch)
    expect(await openRegionTokens(branch), 'one token short, so nothing is owed yet').toBe(
      (await threshold()) - 1,
    )
    const calls = metadataCalls()

    // An overflow fails the call unretried, and the close with it.
    hero().mock.overflowNextStructured(METADATA)
    await send(
      'E2E-OWED-U1 I hand the courier’s satchel to the gatekeeper.',
      'E2E-OWED-R1 the gatekeeper weighs it and nods.',
    )
    // The toast lasts 5 s, so it is awaited before the slower DB polls.
    await expect(closeFailureToast()).toBeVisible({ timeout: 30_000 })
    await pollEntryId(branch, 'E2E-OWED-R1')
    await expect.poll(closeOutcomes, { timeout: 20_000 }).toEqual(['failed'])
    // Phase 0: the turn left its two entries unprocessed, under the cadence, so a pass ran first.
    expect(await passOutcomes()).toEqual(['completed'])
    expect(await openRegionTokens(branch)).toBeGreaterThanOrEqual(await threshold())
    expect(metadataCalls()).toBe(calls + 1)
    expect(await chapterCount(branch)).toBe(chaptersBefore)
    expect(await closeDeltasAfter(branch, head)).toBe(0)
    // Outside a Send a failed close only warns: no entry (the Send dropped the seeded tail one).
    expect(await systemEntries(branch)).toEqual([])
  })

  test('the next Send runs the owed close first, and its failure fails the Send', async () => {
    const page = hero().app.window
    const branch = await branchId()
    // The first toast's 5 s must run out, so the count below sees only a toast this Send raised.
    await expect(closeFailureToast()).toHaveCount(0, { timeout: 10_000 })
    const narratives = streamedCalls()
    const calls = metadataCalls()

    hero().mock.overflowNextStructured(METADATA)
    await send(U2, 'E2E-OWED-R2 the gatekeeper points north.')
    await expect(reader.retrySystemEntry(page)).toBeVisible({ timeout: 20_000 })
    await expect(reader.dismissSystemEntry(page)).toBeVisible()
    // Send's own close reports through the entry: run_complete names it beforeTurn, and the root
    // hook stays quiet. Counted once, not awaited: a toast raised with it would still be up.
    expect(await closeFailureToast().count()).toBe(0)
    await expect(reader.composer(page)).toHaveValue(U2)
    expect(await entryIdByContent(branch, 'E2E-OWED-U2')).toBeUndefined()
    expect(streamedCalls()).toBe(narratives)
    expect(metadataCalls()).toBe(calls + 1)
    // Nothing was unprocessed, so Send started the close itself, with no pass before it.
    expect(await passOutcomes()).toEqual(['completed'])
    expect(await closeOutcomes()).toEqual(['failed', 'failed'])

    closeEntry = await systemEntries(branch)
    expect(closeEntry).toHaveLength(1)
    const [close, pass, kind, failure, submission, content] = closeEntry[0]
    // The draft was empty, so the text went back to the composer and the entry carries none.
    expect([close, pass, kind, failure, submission]).toEqual([
      'failed',
      null,
      'context-window',
      'provider',
      null,
    ])
    const copy = copyPattern('reader:systemEntry.failure.closeContextWindow.provider', {
      texts: ['message'],
      numbers: ['estimate'],
    }).exec(content as string)
    expect(copy, String(content)).not.toBeNull()
    expect(copy?.groups?.message).toContain('exceeds the available context size')
    expect(copyNumber(copy, 'estimate')).toBeGreaterThan(0)
  })

  test('a Send cancelled during its owed close puts the entry back and its text in the composer', async () => {
    test.setTimeout(120_000)
    const page = hero().app.window
    const branch = await branchId()
    const calls = metadataCalls()

    hero().mock.holdNextStructured(METADATA)
    // The composer holds U2, handed back by the failed Send; this Send's text replaces it.
    await send(U3, 'E2E-OWED-R3 the bar lifts.')
    const owed = await heldClose(calls)
    await expect(memoryBanner.closingBeforeTurn(page)).toBeVisible()
    // The Send dropped the entry before its close started.
    expect(await systemEntries(branch)).toEqual([])
    await expect(reader.cancel(page)).toBeVisible()
    await reader.cancel(page).click()

    await expect.poll(() => runOutcome(owed), { timeout: 20_000 }).toBe('aborted')
    await expect.poll(() => systemEntries(branch)).toEqual(closeEntry)
    await expect(reader.composer(page)).toHaveValue(U3)
    expect(await entryIdByContent(branch, 'E2E-OWED-U3')).toBeUndefined()
    await expect(reader.retrySystemEntry(page)).toBeVisible()
    expect(await chapterCount(branch)).toBe(chaptersBefore)
    // The first turn's pass left nothing unprocessed: no pass ran first, so nothing was written.
    expect(await passOutcomes()).toEqual(['completed'])
  })

  test('a Retry whose close fails again rewrites the entry as a close failure', async () => {
    const page = hero().app.window
    const branch = await branchId()
    const [failedId] = await systemEntryIds(branch)
    const calls = metadataCalls()

    hero().mock.overflowNextStructured(METADATA)
    await reader.retrySystemEntry(page).click()
    await expect
      .poll(closeOutcomes, { timeout: 20_000 })
      .toEqual(['failed', 'failed', 'aborted', 'failed'])
    // Not a Send, so the failure toasts as well as rewriting the entry.
    await expect(closeFailureToast()).toBeVisible()
    // A new entry in the old one's place, so the failure was written again, not left standing.
    await expect.poll(() => systemEntryIds(branch), { timeout: 15_000 }).not.toEqual([failedId])
    const rewritten = await systemEntries(branch)
    expect(rewritten).toHaveLength(1)
    // The entry carried no text and nothing holds the branch, so the draft stays the user's.
    expect(rewritten[0].slice(0, 5)).toEqual(['failed', null, 'context-window', 'provider', null])
    await expect(reader.retrySystemEntry(page)).toBeVisible()
    await expect(reader.composer(page)).toHaveValue(U3)
    expect(metadataCalls()).toBe(calls + 1)
    expect(await passOutcomes()).toEqual(['completed'])
    expect(await chapterCount(branch)).toBe(chaptersBefore)
  })

  test('Retry runs the owed close, which writes the chapter and clears the entry', async () => {
    test.setTimeout(120_000)
    const page = hero().app.window
    const branch = await branchId()
    const calls = metadataCalls()

    hero().mock.holdNextStructured(METADATA)
    await reader.retrySystemEntry(page).click()
    const retried = await heldClose(calls)
    // Not a Send: the close's own phase label, and no composer Cancel.
    await expect(memoryBanner.closingMetadata(page)).toBeVisible()
    await expect(reader.cancel(page)).toHaveCount(0)

    hero().mock.releaseStructured()
    await expect.poll(() => runOutcome(retried), { timeout: 20_000 }).toBe('completed')
    await expect(reader.retrySystemEntry(page)).toHaveCount(0)
    await expect.poll(() => systemEntries(branch)).toEqual([])
    const chapters = await queryApp(
      page,
      `SELECT sequence_number, start_entry_id, end_entry_id, title FROM chapters
       WHERE branch_id = ? ORDER BY sequence_number`,
      [branch],
    )
    expect(chapters).toHaveLength(chaptersBefore + 1)
    // No pick, so boundary took the latest reply before the head: the turn that crossed stays open.
    expect(chapters[chapters.length - 1]).toEqual([
      chaptersBefore + 1,
      range.start,
      range.end,
      CHAPTER.title,
    ])
    // Nothing was unprocessed, so Retry ran the close alone.
    expect(await passOutcomes()).toEqual(['completed'])
    expect(await closeOutcomes()).toEqual(['failed', 'failed', 'aborted', 'failed', 'completed'])
    // The draft is the user's, and Retry ran no turn.
    await expect(reader.composer(page)).toHaveValue(U3)
    expect(await entryIdByContent(branch, 'E2E-OWED-U3')).toBeUndefined()
  })
})

// reader-composer.md → During a memory update: the banner's Cancel moves a close to the next turn,
// and that Send runs it first under its own label.
test.describe('chapter close owed — a close cancelled from the banner', () => {
  const hero = launchesHero()
  const {
    branchId,
    entryIdByContent,
    pollEntryId,
    createDelta,
    passOutcomes,
    runOutcome,
    actionDeltas,
    send,
    closeOutcomes,
    chapterCount,
    openRegionTokens,
    threshold,
    metadataCalls,
    heldClose,
    closeDeferralToast,
  } = closeProbe(hero)

  test('the banner’s Cancel moves a chained close to the next turn, and Send runs it first', async () => {
    test.setTimeout(150_000)
    const page = hero().app.window
    await openStory(page, HERO_TITLE)
    const branch = await branchId()
    const chaptersBefore = await chapterCount(branch)

    let calls = metadataCalls()
    hero().mock.holdNextStructured(METADATA)
    await send(
      'E2E-DEFER-U1 I hand the courier’s satchel to the gatekeeper.',
      'E2E-DEFER-R1 the gatekeeper weighs it and nods.',
    )
    await pollEntryId(branch, 'E2E-DEFER-R1')
    const cancelled = await heldClose(calls)
    await expect(memoryBanner.closingMetadata(page)).toBeVisible()
    // Not Send's run: the composer offers no Cancel, so only the banner cancels it.
    await expect(reader.cancel(page)).toHaveCount(0)
    await memoryBanner.cancel(page).click()
    await expect(closeDeferralToast()).toBeVisible()
    await expect.poll(() => runOutcome(cancelled)).toBe('aborted')
    // Held at its metadata call, it wrote nothing.
    expect((await actionDeltas(cancelled)).count).toBe(0)
    expect(await chapterCount(branch)).toBe(chaptersBefore)
    await expect(memoryBanner.closingMetadata(page)).toBeHidden()

    // The hold is one-shot: arm it again for the close this Send owes.
    calls = metadataCalls()
    hero().mock.holdNextStructured(METADATA)
    await send(
      'E2E-DEFER-U2 I ask for the north road.',
      'E2E-DEFER-R2 the gatekeeper points north.',
    )
    const owed = await heldClose(calls)
    await expect(memoryBanner.closingBeforeTurn(page)).toBeVisible()
    // Send's own run now: the composer offers Cancel, and the user_action waits for the close.
    await expect(reader.cancel(page)).toBeVisible()
    expect(await entryIdByContent(branch, 'E2E-DEFER-U2')).toBeUndefined()

    hero().mock.releaseStructured()
    const userAction = await createDelta(branch, await pollEntryId(branch, 'E2E-DEFER-U2'))
    await pollEntryId(branch, 'E2E-DEFER-R2')
    expect(await runOutcome(owed)).toBe('completed')
    const written = await actionDeltas(owed)
    expect(written.count).toBeGreaterThan(0)
    expect(written.last).not.toBeNull()
    expect(written.last!).toBeLessThan(userAction.logPosition)
    expect(owed).not.toBe(userAction.actionId)
    expect(await chapterCount(branch)).toBe(chaptersBefore + 1)
    // The close took the region back under the threshold, so the turn after it owed none.
    expect(await openRegionTokens(branch)).toBeLessThan(await threshold())
    // Nothing was unprocessed at Send, so it started the close itself.
    expect(await passOutcomes()).toEqual(['completed'])
    expect(await closeOutcomes()).toEqual(['aborted', 'completed'])
  })
})

// generation-pipeline.md → Prose reversals and the interrupt: CTRL-Z of the turn passes a close
// by interrupting it, and the turn reverses.
test.describe('chapter close owed — CTRL-Z of the turn during a close', () => {
  const hero = launchesHero()
  const {
    branchId,
    entryIdByContent,
    pollEntryId,
    runOutcome,
    actionDeltas,
    send,
    chapterCount,
    logHead,
    closeDeltasAfter,
    metadataCalls,
    heldClose,
  } = closeProbe(hero)

  test('CTRL-Z of the turn interrupts the held close, which leaves no chapter and no delta', async () => {
    test.setTimeout(120_000)
    const page = hero().app.window
    await openStory(page, HERO_TITLE)
    const branch = await branchId()
    const chaptersBefore = await chapterCount(branch)
    const head = await logHead(branch)
    const calls = metadataCalls()

    hero().mock.holdNextStructured(METADATA)
    await send(
      'E2E-UNDO-U1 I hand the courier’s satchel to the gatekeeper.',
      'E2E-UNDO-R1 the gatekeeper weighs it and nods.',
    )
    await pollEntryId(branch, 'E2E-UNDO-R1')
    const interrupted = await heldClose(calls)
    await expect(memoryBanner.closingMetadata(page)).toBeVisible()

    // CTRL-Z's touch-tier twin: the keyboard shortcut is inert while focus is in the composer.
    await chrome.actionsTrigger(page).click()
    await expect(reader.undoMenuRow(page)).toBeEnabled()
    await reader.undoRow(page).click()

    await expect.poll(() => runOutcome(interrupted), { timeout: 20_000 }).toBe('aborted')
    await expect
      .poll(() => entryIdByContent(branch, 'E2E-UNDO-R1'), { timeout: 15_000 })
      .toBeUndefined()
    expect(await entryIdByContent(branch, 'E2E-UNDO-U1')).toBeUndefined()
    expect((await actionDeltas(interrupted)).count).toBe(0)
    expect(await closeDeltasAfter(branch, head)).toBe(0)
    expect(await chapterCount(branch)).toBe(chaptersBefore)
    await expect(memoryBanner.closingMetadata(page)).toBeHidden()
  })
})
