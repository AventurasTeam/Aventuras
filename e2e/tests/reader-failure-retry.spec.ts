import { expect, test } from '@playwright/test'

import { waitForTurnTerminal } from '../flows/turn'
import { currentBranchId, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  removeUserDataDir,
  setClassifierCadence,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Generation failure → retry (edge case): a failed narrative call surfaces a
// system entry with a Retry action; retrying (with the failure cleared) commits
// the reply and clears the system entry. The failure is injected at the mock's
// transport, so the whole pipeline error path runs for real. See
// docs/testing.md → Coverage + Mock LLM.
const REPLY = 'E2E-FAILRETRY-REPLY the courier finally answers.'

test.describe('reader — turn failure then retry', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so without an installed embedder the
    // turn fails there first — and an `embedder`-kind failure is a DIFFERENT
    // system entry (Switch embedder, describeTurnFailure) than the provider one
    // this spec pins. Cold cache downloads ~24 MB from Hugging Face.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative(REPLY)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  async function systemCount(branchId: string): Promise<number> {
    return (
      (
        await queryApp(
          app.window,
          `SELECT count(*) FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
          [branchId],
        )
      )[0] as [number]
    )[0]
  }

  test('surfaces a retriable system entry on failure, then commits on retry', async () => {
    mock.failNextNarrative()

    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-FAILRETRY-USER I call out.')
    await reader.send(app.window).click()

    // The failed turn writes a system entry with a Retry action.
    await expect(reader.retrySystemEntry(app.window)).toBeVisible({ timeout: 30_000 })
    const branchId = await currentBranchId(app.window, 'story_hero')
    expect(await systemCount(branchId), 'system entry written on failure').toBe(1)

    // Retry: the failure is one-shot, so the next narrative call succeeds.
    await reader.retrySystemEntry(app.window).click()
    await expect(app.window.getByText('E2E-FAILRETRY-REPLY', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    const reply = await queryApp(
      app.window,
      `SELECT id FROM story_entries WHERE branch_id = ? AND content LIKE '%E2E-FAILRETRY-REPLY%'`,
      [branchId],
    )
    expect(reply.length, 'reply committed on retry').toBe(1)
    await expect.poll(() => systemCount(branchId), { timeout: 15_000 }).toBe(0)
  })
})

// generation-pipeline.md → Cut-off replies, at the seam unit tests can't reach: a finish_reason
// 'length' read off the real SSE transport. Serial: the second test sends from the reader the
// first opened.
test.describe('reader — a reply cut off at its length limit', () => {
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
    // No pass chains under these turns, so each test reads only its narrative's outcome.
    setClassifierCadence(seeded.dbPath, 'story_hero', 100)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  // More than one row for a marker would be a duplicated write.
  async function entryIdByContent(branchId: string, marker: string): Promise<string | undefined> {
    const rows = await queryApp(
      app.window,
      `SELECT id FROM story_entries WHERE branch_id = ? AND content LIKE ?`,
      [branchId, `%${marker}%`],
    )
    expect(rows.length, `${marker} row count`).toBeLessThanOrEqual(1)
    return rows[0]?.[0] as string | undefined
  }

  async function pollEntryId(branchId: string, marker: string): Promise<string> {
    await expect.poll(() => entryIdByContent(branchId, marker), { timeout: 30_000 }).toBeDefined()
    const id = await entryIdByContent(branchId, marker)
    if (id === undefined) throw new Error(`${marker}: present at the poll, gone on read-back`)
    return id
  }

  async function replyCount(branchId: string): Promise<number> {
    const rows = await queryApp(
      app.window,
      `SELECT count(*) FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'`,
      [branchId],
    )
    return rows[0][0] as number
  }

  // The branch's system entries as the reader persisted them.
  async function systemFailures(branchId: string): Promise<unknown[][]> {
    return queryApp(
      app.window,
      `SELECT json_extract(metadata, '$.systemFailure.kind'),
              json_extract(metadata, '$.systemFailure.failure'),
              json_extract(metadata, '$.systemFailure.submission.content')
       FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
      [branchId],
    )
  }

  async function cutOffOf(entryId: string): Promise<unknown> {
    const rows = await queryApp(
      app.window,
      `SELECT json_extract(metadata, '$.cutOff') FROM story_entries WHERE id = ?`,
      [entryId],
    )
    const raw = rows[0]?.[0] as string | null | undefined
    return raw == null ? null : JSON.parse(raw)
  }

  test('a reply cut off before any text fails its turn, and Retry resends the held input', async () => {
    const page = app.window
    await home.openStory(page, 'The Veilstone Courier').click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branchId = await currentBranchId(page, 'story_hero')
    const replies = await replyCount(branchId)

    mock.setNarrative('')
    mock.cutNextNarrative()
    await reader.composer(page).fill('E2E-NOPROSE-USER I call across the ford.')
    await reader.send(page).click()

    await expect(reader.systemEntryFailure(page, 'replyCutOff.unknown')).toBeVisible({
      timeout: 30_000,
    })
    await expect(reader.fixProfile(page)).toBeVisible()
    await expect(reader.retrySystemEntry(page)).toBeVisible()
    // No max output on the seeded profile and no usage on the stream: cause `unknown`.
    expect(await systemFailures(branchId)).toEqual([
      ['reply-cut-off', 'unknown', expect.stringContaining('E2E-NOPROSE-USER')],
    ])
    expect(await replyCount(branchId), 'nothing committed').toBe(replies)
    await expect
      .poll(() => entryIdByContent(branchId, 'E2E-NOPROSE-USER'), { timeout: 5_000 })
      .toBeUndefined()

    mock.setNarrative('E2E-NOPROSE-RETRY the ferryman answers at last.')
    await reader.retrySystemEntry(page).click()

    await pollEntryId(branchId, 'E2E-NOPROSE-RETRY')
    expect(
      await entryIdByContent(branchId, 'E2E-NOPROSE-USER'),
      'Retry resent the held input',
    ).toBeDefined()
    await expect.poll(() => systemFailures(branchId), { timeout: 15_000 }).toEqual([])
  })

  test('a reply cut off in its prose commits with the mark and the notice', async () => {
    const page = app.window
    const branchId = await currentBranchId(page, 'story_hero')
    await waitForTurnTerminal(page)

    mock.setNarrative('E2E-INPROSE-REPLY the rope bridge sways, and the far plank')
    mock.cutNextNarrative()
    await reader.composer(page).fill('E2E-INPROSE-USER I step onto the bridge.')
    await reader.send(page).click()

    const replyId = await pollEntryId(branchId, 'E2E-INPROSE-REPLY')
    // After the piggyback fallback's metadata merge, which the mark must survive.
    await waitForTurnTerminal(page)
    // The cause names no limit, and the stream reported no output count.
    expect(await cutOffOf(replyId)).toEqual({ cause: 'unknown' })
    await expect(reader.cutOffNotice(page, replyId, 'unknown')).toBeVisible()
    // The route wires the profile fix into the notice; canon offers it for `unknown`.
    await expect(reader.row(page, replyId).locator(reader.fixProfile(page))).toBeVisible()
    expect(await systemFailures(branchId)).toEqual([])
  })
})
