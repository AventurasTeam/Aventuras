import { expect, test, type Locator } from '@playwright/test'

import { gatedPassReply, passProbe } from '../flows/classifier-pass'
import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { EXAMPLES, startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  enableDiagnostics,
  parkClassifierWatermarkAtLastReply,
  removeUserDataDir,
  setClassifierCadence,
  setProviderEndpoint,
} from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { memoryBanner } from '../locators/memory-banner'
import { reader, worldStateCountOf } from '../locators/reader'
import { storyLeave } from '../locators/story-leave'

// The reader's distance from the bottom once its geometry has held for 10 frames: an end
// state, not the first sample that happens to pass. Capped so a layout that never settles
// fails with its last reading rather than the test timeout.
function settledDistanceFromBottom(scroller: Locator): Promise<number> {
  return scroller.evaluate(
    (el) =>
      new Promise<number>((resolve, reject) => {
        let stableFrames = 0
        let frames = 0
        let last = ''
        const tick = () => {
          const key = `${el.scrollHeight}|${el.clientHeight}|${el.scrollTop}`
          stableFrames = key === last ? stableFrames + 1 : 0
          last = key
          frames += 1
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight
          if (stableFrames >= 10) resolve(distance)
          else if (frames >= 300)
            reject(
              new Error(
                `reader never settled; distance ${distance} (scrollHeight|clientHeight|scrollTop ${key})`,
              ),
            )
          else requestAnimationFrame(tick)
        }
        tick()
      }),
  )
}

// classifier.md → Pipeline framing. The mock holds the pass's call open, so every step acts on a
// pass provably in flight. Serial: the tests build on one another (see reader-regenerate.spec.ts).
test.describe('periodic classifier — the gated pass', () => {
  test.describe.configure({ mode: 'serial' })

  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

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
    parkClassifierWatermarkAtLastReply(seeded.dbPath, 'br_hero_main')
    // The Actions menu's Diagnostics row, a jump out of the story from any in-story screen.
    enableDiagnostics(seeded.dbPath)
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

  // The reply under the head turn: its pencil is off the head, so a pass keeps it disabled.
  async function replyBefore(branch: string, entryId: string): Promise<string> {
    const rows = await queryApp(
      app.window,
      `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply' AND position <
         (SELECT position FROM story_entries WHERE id = ?) ORDER BY position DESC LIMIT 1`,
      [branch, entryId],
    )
    expect(rows, `a reply before ${entryId}`).toHaveLength(1)
    return rows[0][0] as string
  }

  async function shownWorldStateCount(): Promise<number | null> {
    const [line] = await reader.rollbackWorldStateLine(app.window).allTextContents()
    return line == null ? null : worldStateCountOf(line)
  }

  test('a turn chains its pass, which holds the gate under the banner with an action of its own', async () => {
    test.setTimeout(120_000)
    const page = app.window
    await home.openStory(page, 'The Veilstone Courier').click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branch = await branchId()

    mock.setStructured('periodic-classifier', gatedPassReply('E2E-GATE-H1'))
    mock.holdNextStructured('periodic-classifier')
    const calls = passCalls()
    await send('E2E-GATE-U1 I ride for the ferry.', 'E2E-GATE-R1 the ferryman waves you aboard.')
    const reply = await pollEntryId(branch, 'E2E-GATE-R1')
    const pass = await heldPass(calls)
    const userEntry = await pollEntryId(branch, 'E2E-GATE-U1')
    const userAction = await createDelta(branch, userEntry)
    expect(pass).not.toBe(userAction.actionId)

    await expect(memoryBanner.updating(page)).toBeVisible()
    // Geometry, not the DB: the reader's viewport shrinks under the shell's banner and the
    // composer, a route seam no story reaches. The reply's stream-end settle leaves the reader
    // at the bottom under the banner (reader-composer.md → Autoscroll).
    const scroller = reader.scroller(page)
    expect(await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0)
    expect(await settledDistanceFromBottom(scroller)).toBeLessThanOrEqual(1)
    // A draft that grows the composer shrinks the reader again, long after the settle; the
    // viewport-shrink re-pin keeps it at the bottom.
    const readerHeight = await scroller.evaluate((el) => el.clientHeight)
    await reader.composer(page).fill('E2E-GATE-LINES\ntwo\nthree\nfour\nfive\nsix')
    await expect.poll(() => scroller.evaluate((el) => el.clientHeight)).toBeLessThan(readerHeight)
    expect(await settledDistanceFromBottom(scroller)).toBeLessThanOrEqual(1)
    await reader.composer(page).fill('')
    // The head reversals interrupt a pass, so they stay live; the rest keeps the whole gate.
    const offHead = await replyBefore(branch, userEntry)
    await expect(reader.regenEntry(page, reply)).toBeEnabled()
    await expect(reader.deleteEntry(page, reply)).toBeEnabled()
    await expect(reader.editEntry(page, reply)).toBeEnabled()
    await expect(reader.editEntry(page, userEntry)).toBeEnabled()
    await expect(
      reader.gatedEntryAction(page, offHead, t('generationGate.updatingMemory')),
    ).toBeDisabled()
    await expect(reader.suggestionRefreshAny(page)).toBeEnabled()
    await chrome.actionsTrigger(page).click()
    await expect(reader.undoMenuRow(page)).toBeEnabled()
    // The turn's commit cleared the redo stack, so Redo is absent, not disabled.
    await expect(reader.redoRow(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(reader.undoMenuRow(page)).toBeHidden()
    // Not Send's run: the composer stays live, Send waits, and only the banner cancels.
    await reader.composer(page).fill('E2E-GATE-DRAFT the next move')
    await expect(reader.send(page)).toBeDisabled()
    await expect(reader.cancel(page)).toHaveCount(0)

    // An in-story move asks nothing, and the banner rides along.
    await chrome.actionsTrigger(page).click()
    await chrome.goToWorldRow(page).click()
    await page.waitForURL(/\/world\//)
    await expect(memoryBanner.updating(page)).toBeVisible()
    await expect(storyLeave.dialog(page)).toHaveCount(0)
    // World's own guard: a jump out of the story asks, and Stay keeps the screen and the pass.
    await chrome.actionsTrigger(page).click()
    await chrome.diagnosticsHubRow(page).click()
    await expect(storyLeave.dialog(page)).toBeVisible()
    await storyLeave.stay(page).click()
    await expect(storyLeave.dialog(page)).toBeHidden()
    expect(page.url()).toMatch(/\/world\//)
    expect(await runOutcome(pass)).toBeNull()
    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)

    mock.releaseStructured()
    await expect.poll(() => runOutcome(pass), { timeout: 20_000 }).toBe('completed')
    expect((await passDeltas(pass)).count).toBeGreaterThan(0)
    await expect(memoryBanner.updating(page)).toBeHidden()
    await expect(reader.send(page)).toBeEnabled()
    expect(await passOutcomes()).toEqual(['completed'])
    await reader.composer(page).fill('')
  })

  // rollback-confirm.md → Counts: an open confirm recounts when a pass commits under it.
  test('an open rollback confirm recounts when the pass under it commits', async () => {
    test.setTimeout(120_000)
    const page = app.window
    const branch = await branchId()

    mock.setStructured('periodic-classifier', gatedPassReply('E2E-GATE-HC'))
    mock.holdNextStructured('periodic-classifier')
    const calls = passCalls()
    await send(
      'E2E-GATE-UC I count the coins in my purse.',
      'E2E-GATE-RC three coins and a button.',
    )
    await pollEntryId(branch, 'E2E-GATE-RC')
    const pass = await heldPass(calls)
    // The pass anchors its writes on the window's first turn, this user_action, so a rollback
    // from it removes them.
    const userEntry = await pollEntryId(branch, 'E2E-GATE-UC')
    await reader.deleteEntry(page, userEntry).click()
    await expect(reader.rollbackConfirm(page)).toBeVisible()
    const before = await shownWorldStateCount()
    if (before === null) throw new Error('the rollback confirm shows no world-state count')

    mock.releaseStructured()
    await expect.poll(() => runOutcome(pass), { timeout: 20_000 }).toBe('completed')
    const written = (await passDeltas(pass)).count
    expect(written).toBeGreaterThan(0)
    await expect.poll(() => shownWorldStateCount()).toBe(before + written)

    await reader.rollbackCancel(page).click()
    await expect(reader.rollbackConfirm(page)).toBeHidden()
    expect(await entryIdByContent(branch, 'E2E-GATE-UC')).toBe(userEntry)
  })

  test('a regenerate interrupts the pass and defers it, and the next Send runs it first', async () => {
    test.setTimeout(120_000)
    const page = app.window
    const branch = await branchId()
    const settled = await classifierStatus(branch)
    const outcomesBefore = (await passOutcomes()).length
    await expect(deferralToast()).toHaveCount(0)

    mock.setStructured('periodic-classifier', gatedPassReply('E2E-GATE-H2'))
    mock.holdNextStructured('periodic-classifier')
    let calls = passCalls()
    await send(
      'E2E-GATE-U2 I ask the ferryman his price.',
      'E2E-GATE-R2A he names a coin you lack.',
    )
    const reply = await pollEntryId(branch, 'E2E-GATE-R2A')
    const interrupted = await heldPass(calls)
    await expect(memoryBanner.updating(page)).toBeVisible()

    // The head reply's ↻ stays live through the pass; a terminal reply needs no confirm.
    mock.setNarrative('E2E-GATE-R2B he waves the fare away.')
    await reader.regenEntry(page, reply).click()
    await expect(deferralToast()).toBeVisible()
    await pollEntryId(branch, 'E2E-GATE-R2B')
    await expect
      .poll(() => entryIdByContent(branch, 'E2E-GATE-R2A'), { timeout: 15_000 })
      .toBeUndefined()
    await expect.poll(() => runOutcome(interrupted)).toBe('aborted')
    // Held at its call, it wrote nothing; a burst's own reversal is unit-tested.
    expect((await passDeltas(interrupted)).count).toBe(0)
    // Its pre-run status back: no failure recorded, the watermark where it stood.
    await expect.poll(() => classifierStatus(branch)).toEqual(settled)
    await expect(memoryBanner.updating(page)).toBeHidden()

    mock.setStructured('periodic-classifier', gatedPassReply('E2E-GATE-H3'))
    mock.holdNextStructured('periodic-classifier')
    calls = passCalls()
    await send('E2E-GATE-U3 I step onto the ferry.', 'E2E-GATE-R3 the rope creaks as you push off.')
    const deferred = await heldPass(calls)
    await expect(memoryBanner.updatingBeforeTurn(page)).toBeVisible()
    // Send's own run now: the composer offers Cancel, and the user_action waits for the pass.
    await expect(reader.cancel(page)).toBeVisible()
    expect(await entryIdByContent(branch, 'E2E-GATE-U3')).toBeUndefined()

    mock.releaseStructured()
    // The turn's commit chains the next due pass; an inert reply lets it finish untouched.
    mock.setStructured('periodic-classifier', EXAMPLES['periodic-classifier'])
    const userAction = await createDelta(branch, await pollEntryId(branch, 'E2E-GATE-U3'))
    await pollEntryId(branch, 'E2E-GATE-R3')
    expect(await runOutcome(deferred)).toBe('completed')
    expect(deferred).not.toBe(userAction.actionId)
    const written = await passDeltas(deferred)
    expect(written.count).toBeGreaterThan(0)
    expect(written.last).not.toBeNull()
    expect(written.last!).toBeLessThan(userAction.logPosition)
    // The interrupted pass, then its deferred run at this Send, then the pass this turn chains.
    await expect
      .poll(async () => (await passOutcomes()).slice(outcomesBefore), { timeout: 20_000 })
      .toEqual(['aborted', 'completed', 'completed'])
  })

  test('Cancel moves a pass to the next turn, and Cancel during that run keeps the text', async () => {
    test.setTimeout(120_000)
    const page = app.window
    const branch = await branchId()
    const settled = await classifierStatus(branch)
    const outcomesBefore = (await passOutcomes()).length
    await expect(deferralToast()).toHaveCount(0)

    mock.setStructured('periodic-classifier', gatedPassReply('E2E-GATE-H4'))
    mock.holdNextStructured('periodic-classifier')
    let calls = passCalls()
    await send('E2E-GATE-U4 I watch the far bank.', 'E2E-GATE-R4 lanterns move in the reeds.')
    await pollEntryId(branch, 'E2E-GATE-R4')
    const cancelled = await heldPass(calls)
    await expect(memoryBanner.updating(page)).toBeVisible()
    await memoryBanner.cancel(page).click()
    await expect(deferralToast()).toBeVisible()
    await expect.poll(() => runOutcome(cancelled)).toBe('aborted')
    await expect.poll(() => classifierStatus(branch)).toEqual(settled)

    const action = 'E2E-GATE-U5 I call out to the lanterns.'
    mock.holdNextStructured('periodic-classifier')
    calls = passCalls()
    await send(action, 'E2E-GATE-R5 the lanterns go dark at once.')
    const beforeTurn = await heldPass(calls)
    await expect(memoryBanner.updatingBeforeTurn(page)).toBeVisible()
    await memoryBanner.cancel(page).click()
    await expect.poll(() => runOutcome(beforeTurn)).toBe('aborted')
    // The whole Send is cancelled: no user_action, the text back in the composer.
    await expect(reader.composer(page)).toHaveValue(action)
    expect(await entryIdByContent(branch, 'E2E-GATE-U5')).toBeUndefined()

    // Still deferred: the Send sent again runs the pass first again.
    mock.holdNextStructured('periodic-classifier')
    calls = passCalls()
    await reader.send(page).click()
    await heldPass(calls)
    await expect(memoryBanner.updatingBeforeTurn(page)).toBeVisible()
    mock.releaseStructured()
    mock.setStructured('periodic-classifier', EXAMPLES['periodic-classifier'])
    await pollEntryId(branch, 'E2E-GATE-U5')
    await pollEntryId(branch, 'E2E-GATE-R5')
    await expect
      .poll(async () => (await passOutcomes()).slice(outcomesBefore), { timeout: 20_000 })
      .toEqual(['aborted', 'aborted', 'completed', 'completed'])
  })

  test('leaving the story mid-pass asks first, and Cancel & leave defers the pass', async () => {
    test.setTimeout(120_000)
    const page = app.window
    const branch = await branchId()
    const settled = await classifierStatus(branch)
    await expect(deferralToast()).toHaveCount(0)

    mock.setStructured('periodic-classifier', gatedPassReply('E2E-GATE-H6'))
    mock.holdNextStructured('periodic-classifier')
    const calls = passCalls()
    await send('E2E-GATE-U6 I tie the ferry up.', 'E2E-GATE-R6 the rope holds fast.')
    await pollEntryId(branch, 'E2E-GATE-R6')
    const held = await heldPass(calls)
    await expect(memoryBanner.updating(page)).toBeVisible()

    await chrome.back(page).click()
    await expect(storyLeave.dialog(page)).toBeVisible()
    await storyLeave.stay(page).click()
    await expect(storyLeave.dialog(page)).toBeHidden()
    await expect(memoryBanner.updating(page)).toBeVisible()
    expect(await runOutcome(held)).toBeNull()

    await chrome.back(page).click()
    await storyLeave.cancelAndLeave(page).click()
    await expect(deferralToast()).toBeVisible()
    await expect(home.openStory(page, 'The Veilstone Courier')).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => runOutcome(held)).toBe('aborted')
    await expect.poll(() => classifierStatus(branch)).toEqual(settled)
  })
})
