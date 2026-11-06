import { expect, test } from '@playwright/test'

import { gatedPassReply, passProbe } from '../flows/classifier-pass'
import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { copyNumber, copyPattern, t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { EXAMPLES, startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  parkClassifierWatermarkAtLastReply,
  removeUserDataDir,
  setClassifierCadence,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { memoryBanner } from '../locators/memory-banner'
import { reader } from '../locators/reader'
import { toast } from '../locators/toast'

// Valid JSON the pass's schema rejects, so both parse attempts fail and the pass fails.
const UNPARSEABLE_PASS_REPLY = { happenings: 'not a list' }

// The inert reply cut after its sixth list: jsonrepair would close it into a reply the schema
// accepts, so only the strict parse a 'length' stop gets refuses it.
const CUT_PASS_REPLY =
  '{"happenings":[],"relationships":[],"statusFlips":[],"newCharacters":[],"newFactions":[],"memberships":[]'

// classifier.md → Failure policy, at the seams only a running app reaches: the chained pass's
// toast, Send's owed pass failing it via the entry, and its Retry. Serial: each builds on the last.
test.describe('periodic classifier — failure policy', () => {
  test.describe.configure({ mode: 'serial' })

  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  let parked: number

  test.beforeAll(async () => {
    // Retrieval blocks narrative: no installed embedder, no reply. Cold cache downloads ~24 MB.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setStructured('periodic-classifier', UNPARSEABLE_PASS_REPLY)
    setProviderEndpoint(seeded.dbPath, mock.url)
    // A turn writes two entries, so with the watermark at the last reply each turn owes one pass.
    setClassifierCadence(seeded.dbPath, 'story_hero', 2)
    parked = parkClassifierWatermarkAtLastReply(seeded.dbPath, 'br_hero_main')
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  const {
    branchId,
    entryIdByContent,
    pollEntryId,
    passOutcomes,
    runOutcome,
    passDeltas,
    classifierStatus,
    passCalls,
    heldPass,
    send,
  } = passProbe(
    () => app.window,
    () => mock,
  )

  const U2 = 'E2E-POLICY-U2 I wade into the ford.'
  const failureToast = () => toast.withText(app.window, t('chrome.memoryUpdateFailed'))
  const streamedCalls = () => mock.requests.filter((r) => r.streamed).length

  async function positionOf(entryId: string): Promise<number> {
    return (
      await queryApp(app.window, `SELECT position FROM story_entries WHERE id = ?`, [entryId])
    )[0][0] as number
  }

  // The branch's system entries as the reader persisted them: Retry reads `pass` back.
  async function systemFailures(branch: string): Promise<unknown[][]> {
    return queryApp(
      app.window,
      `SELECT json_extract(metadata, '$.systemFailure.pass'),
              json_extract(metadata, '$.systemFailure.kind'),
              json_extract(metadata, '$.systemFailure.submission')
       FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
      [branch],
    )
  }

  async function systemEntryIds(branch: string): Promise<unknown[]> {
    return (
      await queryApp(
        app.window,
        `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
        [branch],
      )
    ).map((r) => r[0])
  }

  test('a chained pass that fails records failed, leaves the watermark and warns', async () => {
    const page = app.window
    await home.openStory(page, 'The Veilstone Courier').click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branch = await branchId()

    await send('E2E-POLICY-U1 I ride for the ford.', 'E2E-POLICY-R1 the water runs high.')
    await pollEntryId(branch, 'E2E-POLICY-R1')
    await expect(failureToast()).toBeVisible({ timeout: 20_000 })
    await expect.poll(passOutcomes, { timeout: 20_000 }).toEqual(['failed'])
    const [state, lastError, watermark] = await classifierStatus(branch)
    expect(state).toBe('failed')
    expect(lastError).not.toBeNull()
    expect(watermark).toBe(parked)
  })

  test('the next Send runs the owed pass first, and its failure fails the Send', async () => {
    const page = app.window
    const branch = await branchId()
    // The first toast's 5 s must run out, so the check below sees only a toast this Send raised.
    await expect(failureToast()).toHaveCount(0, { timeout: 10_000 })
    const narratives = streamedCalls()
    const calls = passCalls()

    await send(U2, 'E2E-POLICY-R2 the far bank comes up out of the mist.')
    await expect(reader.systemEntryFailure(page, 'memory')).toBeVisible({ timeout: 20_000 })
    await expect(reader.retrySystemEntry(page)).toBeVisible()
    // Send's own pass reports through the entry: run_complete names it beforeTurn, and the root
    // hook stays quiet. Counted once, not awaited: a toast raised with it would still be up.
    expect(await failureToast().count()).toBe(0)
    await expect(reader.composer(page)).toHaveValue(U2)
    expect(await entryIdByContent(branch, 'E2E-POLICY-U2')).toBeUndefined()
    expect(await passOutcomes()).toEqual(['failed', 'failed'])
    expect(passCalls()).toBeGreaterThan(calls)
    expect(streamedCalls()).toBe(narratives)
    // The draft was empty, so the text went back to the composer and the entry carries none.
    // The reply fails the schema, a parse-tier failure, so the kind is phase-logic.
    expect(await systemFailures(branch)).toEqual([['failed', 'phase-logic', null]])
    const [state, , watermark] = await classifierStatus(branch)
    expect(state).toBe('failed')
    expect(watermark).toBe(parked)
  })

  test('a Retry whose pass fails again rewrites the entry and warns', async () => {
    const page = app.window
    const branch = await branchId()
    const [before] = await systemEntryIds(branch)
    await expect(failureToast()).toHaveCount(0)
    const outcomes = await passOutcomes()
    const narratives = streamedCalls()
    const calls = passCalls()

    // The reply still fails the schema.
    await reader.retrySystemEntry(page).click()
    // Not a Send's pass, so the root hook warns beside the entry.
    await expect(failureToast()).toBeVisible({ timeout: 20_000 })
    await expect.poll(passOutcomes, { timeout: 20_000 }).toEqual([...outcomes, 'failed'])
    expect(passCalls()).toBeGreaterThan(calls)
    // A new row for the new cause, still the pass's, still without the text the composer holds.
    await expect.poll(() => systemEntryIds(branch)).not.toEqual([before])
    expect(await systemFailures(branch)).toEqual([['failed', 'phase-logic', null]])
    await expect(reader.retrySystemEntry(page)).toBeVisible()
    expect(streamedCalls()).toBe(narratives)
    await expect(reader.composer(page)).toHaveValue(U2)
    const [state, , watermark] = await classifierStatus(branch)
    expect(state).toBe('failed')
    expect(watermark).toBe(parked)
  })

  test('Retry runs the pass alone, and its success clears the entry', async () => {
    const page = app.window
    const branch = await branchId()
    const narratives = streamedCalls()
    mock.setStructured('periodic-classifier', gatedPassReply('E2E-POLICY-H1'))
    mock.holdNextStructured('periodic-classifier')
    const calls = passCalls()

    await reader.retrySystemEntry(page).click()
    const retried = await heldPass(calls)
    // Not a Send: the plain banner, and no composer Cancel.
    await expect(memoryBanner.updating(page)).toBeVisible()
    await expect(reader.cancel(page)).toHaveCount(0)

    mock.releaseStructured()
    await expect.poll(() => runOutcome(retried), { timeout: 20_000 }).toBe('completed')
    // The turn the next test sends chains a pass of its own; an inert reply lets it pass untouched.
    mock.setStructured('periodic-classifier', EXAMPLES['periodic-classifier'])
    expect((await passDeltas(retried)).count).toBeGreaterThan(0)
    await expect(reader.retrySystemEntry(page)).toHaveCount(0)
    expect(await systemFailures(branch)).toEqual([])
    // The entry was the branch's tail when the pass ran: the watermark stops at the last prose
    // row, so the next Send's user_action lands above it.
    const replyAt = await positionOf(await pollEntryId(branch, 'E2E-POLICY-R1'))
    expect(await classifierStatus(branch)).toEqual(['idle', null, replyAt])
    expect(streamedCalls()).toBe(narratives)
    await expect(reader.composer(page)).toHaveValue(U2)
    expect(await entryIdByContent(branch, 'E2E-POLICY-U2')).toBeUndefined()
  })

  test('Send then lands the turn above the watermark', async () => {
    const page = app.window
    const branch = await branchId()
    const [, , watermark] = await classifierStatus(branch)
    await expect(reader.composer(page)).toHaveValue(U2)

    mock.holdNextNarrative()
    mock.setNarrative('E2E-POLICY-R2 the far bank comes up out of the mist.')
    const narratives = streamedCalls()
    await reader.send(page).click()
    // Held at its narrative call, the turn has written its user_action and chained nothing yet.
    // A release before the call reaches the mock would leave it held for good.
    await expect.poll(streamedCalls, { timeout: 30_000 }).toBeGreaterThan(narratives)
    const userEntry = await pollEntryId(branch, 'E2E-POLICY-U2')
    expect(await positionOf(userEntry)).toBeGreaterThan(watermark as number)
    // Nothing was owed: no pass ran ahead of this user_action.
    expect(await passOutcomes()).toEqual(['failed', 'failed', 'failed', 'completed'])

    mock.releaseNarrative()
    await pollEntryId(branch, 'E2E-POLICY-R2')
    // The turn's commit chains the next pass, as the cadence counts it.
    await expect
      .poll(passOutcomes, { timeout: 20_000 })
      .toEqual(['failed', 'failed', 'failed', 'completed', 'completed'])
  })
})

// classifier.md → Failure policy, generation-pipeline.md → Cut-off replies: a length-stopped pass
// reply fails the pass unrepaired, chained or owed. Serial: test 2's Send owes test 1's pass.
test.describe('periodic classifier — a pass reply cut off at its length limit', () => {
  test.describe.configure({ mode: 'serial' })

  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  let parked: number

  test.beforeAll(async () => {
    // Retrieval blocks narrative: no installed embedder, no reply. Cold cache downloads ~24 MB.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    // A turn writes two entries, so with the watermark at the last reply each turn owes one pass.
    setClassifierCadence(seeded.dbPath, 'story_hero', 2)
    parked = parkClassifierWatermarkAtLastReply(seeded.dbPath, 'br_hero_main')
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  const {
    branchId,
    entryIdByContent,
    pollEntryId,
    passOutcomes,
    classifierStatus,
    passCalls,
    send,
  } = passProbe(
    () => app.window,
    () => mock,
  )

  const U2 = 'E2E-CUTPASS-U2 I wade into the ford.'
  const streamedCalls = () => mock.requests.filter((r) => r.streamed).length

  async function systemFailures(branch: string): Promise<unknown[][]> {
    return queryApp(
      app.window,
      `SELECT json_extract(metadata, '$.systemFailure.pass'),
              json_extract(metadata, '$.systemFailure.kind'),
              json_extract(metadata, '$.systemFailure.failure'),
              json_extract(metadata, '$.systemFailure.submission')
       FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
      [branch],
    )
  }

  test('a chained pass whose reply is cut off fails after one call and leaves the watermark', async () => {
    const page = app.window
    await home.openStory(page, 'The Veilstone Courier').click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branch = await branchId()
    const calls = passCalls()

    mock.cutNextStructured('periodic-classifier', CUT_PASS_REPLY)
    await send('E2E-CUTPASS-U1 I ride for the ford.', 'E2E-CUTPASS-R1 the water runs high.')
    await pollEntryId(branch, 'E2E-CUTPASS-R1')

    await expect.poll(passOutcomes, { timeout: 20_000 }).toEqual(['failed'])
    // Not retried: a second call would have drawn the inert default and completed.
    expect(passCalls()).toBe(calls + 1)
    const [state, lastError, watermark] = await classifierStatus(branch)
    expect(state).toBe('failed')
    expect(lastError).not.toBeNull()
    expect(watermark).toBe(parked)
  })

  test('the owed pass at Send, cut off again, fails the Send with its own entry', async () => {
    const page = app.window
    const branch = await branchId()
    const narratives = streamedCalls()
    const calls = passCalls()

    mock.cutNextStructured('periodic-classifier', CUT_PASS_REPLY)
    await send(U2, 'E2E-CUTPASS-R2 the far bank comes up out of the mist.')

    await expect(reader.systemEntryFailure(page, 'memoryCutOff.unknown')).toBeVisible({
      timeout: 20_000,
    })
    await expect(reader.fixProfile(page)).toBeVisible()
    await expect(reader.retrySystemEntry(page)).toBeVisible()
    await expect(reader.dismissSystemEntry(page)).toBeVisible()
    await expect(reader.composer(page)).toHaveValue(U2)
    expect(await entryIdByContent(branch, 'E2E-CUTPASS-U2')).toBeUndefined()
    expect(await passOutcomes()).toEqual(['failed', 'failed'])
    expect(passCalls()).toBe(calls + 1)
    expect(streamedCalls()).toBe(narratives)
    // The draft was empty, so the text went back to the composer and the entry carries none.
    expect(await systemFailures(branch)).toEqual([['failed', 'reply-cut-off', 'unknown', null]])
    const [state, , watermark] = await classifierStatus(branch)
    expect(state).toBe('failed')
    expect(watermark).toBe(parked)
  })
})

// architecture.md → Recognizing an overflow rejection, classifier.md → Failure policy: a pass the
// provider rejects fails unretried, chained or owed. Serial: test 2's Send owes test 1's pass.
test.describe('periodic classifier — a pass the provider rejects as over the window', () => {
  test.describe.configure({ mode: 'serial' })

  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  let parked: number

  test.beforeAll(async () => {
    // Retrieval blocks narrative: no installed embedder, no reply. Cold cache downloads ~24 MB.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    // A turn writes two entries, so with the watermark at the last reply each turn owes one pass.
    setClassifierCadence(seeded.dbPath, 'story_hero', 2)
    parked = parkClassifierWatermarkAtLastReply(seeded.dbPath, 'br_hero_main')
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  const {
    branchId,
    entryIdByContent,
    pollEntryId,
    passOutcomes,
    classifierStatus,
    passCalls,
    send,
  } = passProbe(
    () => app.window,
    () => mock,
  )

  const U2 = 'E2E-OVERPASS-U2 I wade into the ford.'
  const streamedCalls = () => mock.requests.filter((r) => r.streamed).length

  async function systemFailures(branch: string): Promise<unknown[][]> {
    return queryApp(
      app.window,
      `SELECT json_extract(metadata, '$.systemFailure.pass'),
              json_extract(metadata, '$.systemFailure.kind'),
              json_extract(metadata, '$.systemFailure.failure'),
              json_extract(metadata, '$.systemFailure.submission'),
              content
       FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
      [branch],
    )
  }

  test('a chained pass the provider rejects fails after one call and leaves the watermark', async () => {
    const page = app.window
    await home.openStory(page, 'The Veilstone Courier').click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branch = await branchId()
    const calls = passCalls()

    // The harness keys structured calls by STRUCTURED_SHAPES name, not by agent id.
    mock.overflowNextStructured('periodic-classifier')
    await send('E2E-OVERPASS-U1 I ride for the ford.', 'E2E-OVERPASS-R1 the water runs high.')
    await pollEntryId(branch, 'E2E-OVERPASS-R1')

    await expect.poll(passOutcomes, { timeout: 20_000 }).toEqual(['failed'])
    // Not retried: a second call would have drawn the inert default and completed.
    expect(passCalls()).toBe(calls + 1)
    const [state, lastError, watermark] = await classifierStatus(branch)
    expect(state).toBe('failed')
    // Recognized as a window failure, the server's message kept, not a bare provider 400.
    expect(lastError).toEqual(expect.stringContaining('context window'))
    expect(lastError).toEqual(expect.stringContaining('exceeds the available context size'))
    expect(watermark).toBe(parked)
  })

  test('the owed pass at Send, rejected again, fails the Send with a window entry', async () => {
    const page = app.window
    const branch = await branchId()
    const narratives = streamedCalls()
    const calls = passCalls()

    mock.overflowNextStructured('periodic-classifier')
    await send(U2, 'E2E-OVERPASS-R2 the far bank comes up out of the mist.')

    await expect(reader.retrySystemEntry(page)).toBeVisible({ timeout: 20_000 })
    await expect(reader.dismissSystemEntry(page)).toBeVisible()
    // A window entry offers no profile fix.
    await expect(reader.fixProfile(page)).toHaveCount(0)
    await expect(reader.composer(page)).toHaveValue(U2)
    expect(await entryIdByContent(branch, 'E2E-OVERPASS-U2')).toBeUndefined()
    expect(await passOutcomes()).toEqual(['failed', 'failed'])
    expect(passCalls()).toBe(calls + 1)
    expect(streamedCalls()).toBe(narratives)

    const rows = await systemFailures(branch)
    expect(rows).toHaveLength(1)
    const [pass, kind, failure, submission, content] = rows[0]
    // The draft was empty, so the text went back to the composer and the entry carries none.
    expect([pass, kind, failure, submission]).toEqual([
      'failed',
      'context-window',
      'provider',
      null,
    ])
    const copy = copyPattern('reader:systemEntry.failure.memoryContextWindow.provider', {
      texts: ['message'],
      numbers: ['estimate'],
    }).exec(content as string)
    expect(copy, String(content)).not.toBeNull()
    expect(copy?.groups?.message).toContain('exceeds the available context size')
    expect(copyNumber(copy, 'estimate')).toBeGreaterThan(0)
    const [state, , watermark] = await classifierStatus(branch)
    expect(state).toBe('failed')
    expect(watermark).toBe(parked)
  })
})

// classifier.md → Failure policy: a Cancel's deferral mark lives in memory, so a relaunch on the
// same userData drops it, and Send finds the pass owed from the persisted watermark alone.
test.describe('periodic classifier — an owed pass across a restart', () => {
  test.describe.configure({ mode: 'serial' })

  let app: LaunchedApp
  let mock: MockLlm
  // The relaunch reopens this dir, so no launch owns it: afterAll removes it once.
  let userDataDir: string
  let parked: number

  test.beforeAll(async () => {
    // Retrieval blocks narrative: no installed embedder, no reply. Cold cache downloads ~24 MB.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    setClassifierCadence(seeded.dbPath, 'story_hero', 2)
    parked = parkClassifierWatermarkAtLastReply(seeded.dbPath, 'br_hero_main')
    app = await launchApp({ userDataDir, cleanupUserData: false })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  const {
    branchId,
    entryIdByContent,
    pollEntryId,
    createDelta,
    passOutcomes,
    runOutcome,
    passDeltas,
    classifierStatus,
    passCalls,
    heldPass,
    send,
    deferralToast,
  } = passProbe(
    () => app.window,
    () => mock,
  )

  test('Cancel moves the chained pass to the next turn and leaves the watermark', async () => {
    test.setTimeout(120_000)
    const page = app.window
    await home.openStory(page, 'The Veilstone Courier').click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branch = await branchId()

    mock.setStructured('periodic-classifier', gatedPassReply('E2E-RESTART-H1'))
    mock.holdNextStructured('periodic-classifier')
    const calls = passCalls()
    await send('E2E-RESTART-U1 I bank the fire for the night.', 'E2E-RESTART-R1 the embers settle.')
    await pollEntryId(branch, 'E2E-RESTART-R1')
    const cancelled = await heldPass(calls)
    await expect(memoryBanner.updating(page)).toBeVisible()
    await memoryBanner.cancel(page).click()
    await expect(deferralToast()).toBeVisible()
    await expect.poll(() => runOutcome(cancelled)).toBe('aborted')
    expect((await passDeltas(cancelled)).count).toBe(0)
    await expect.poll(() => classifierStatus(branch)).toEqual(['idle', null, parked])
  })

  test('after a relaunch, Send runs the pass the cadence owes first', async () => {
    // A close, a cold launch and a story open, on top of this test's own steps.
    test.setTimeout(150_000)
    await app.close()
    app = await launchApp({ userDataDir, cleanupUserData: false })
    const page = app.window
    await home.openStory(page, 'The Veilstone Courier').click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branch = await branchId()
    // Only the persisted state crossed the restart: the watermark behind the cancelled turn.
    expect(await classifierStatus(branch)).toEqual(['idle', null, parked])
    const outcomesBefore = (await passOutcomes()).length

    mock.setStructured('periodic-classifier', gatedPassReply('E2E-RESTART-H2'))
    mock.holdNextStructured('periodic-classifier')
    const calls = passCalls()
    await send('E2E-RESTART-U2 I wake before the light.', 'E2E-RESTART-R2 frost on the saddle.')
    const owed = await heldPass(calls)
    // Send's own run: the user_action waits for the pass, and the composer offers Cancel.
    expect(await entryIdByContent(branch, 'E2E-RESTART-U2')).toBeUndefined()
    await expect(memoryBanner.updatingBeforeTurn(page)).toBeVisible()
    await expect(reader.cancel(page)).toBeVisible()

    mock.releaseStructured()
    // The turn's commit chains the next due pass; an inert reply lets it finish untouched.
    mock.setStructured('periodic-classifier', EXAMPLES['periodic-classifier'])
    const userAction = await createDelta(branch, await pollEntryId(branch, 'E2E-RESTART-U2'))
    await pollEntryId(branch, 'E2E-RESTART-R2')
    expect(await runOutcome(owed)).toBe('completed')
    expect(owed).not.toBe(userAction.actionId)
    const written = await passDeltas(owed)
    expect(written.count).toBeGreaterThan(0)
    expect(written.last).not.toBeNull()
    expect(written.last!).toBeLessThan(userAction.logPosition)
    // The owed pass at this Send, then the pass this turn chains.
    await expect
      .poll(async () => (await passOutcomes()).slice(outcomesBefore), { timeout: 20_000 })
      .toEqual(['completed', 'completed'])
  })
})
