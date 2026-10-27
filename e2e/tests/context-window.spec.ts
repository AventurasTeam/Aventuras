import { expect, test, type Locator, type Page } from '@playwright/test'

import { waitForTurnTerminal } from '../flows/turn'
import { currentBranchId, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { copyNumber, copyPattern, t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  removeUserDataDir,
  setClassifierCadence,
  setContextWindowOverride,
  setProviderEndpoint,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { toast } from '../locators/toast'

// architecture.md → Model context window, at the seams unit tests stop short of: a window read from
// settings at boot, the real SSE transport, the reader's entry and the boot-wired toast
// (docs/testing.md → Coverage). Effects read back through the DB bridge (Selector strategy, tier 1).

// The seeded narrative profile's model, which the classifier profile shares (lib/db/devtools/seed-dataset.ts).
const SEED_MODEL = 'seed/narrative'
const STORY = 'The Veilstone Courier'

type SystemRow = { content: string; kind: unknown; failure: unknown; submission: unknown }

async function systemRows(page: Page, branchId: string): Promise<SystemRow[]> {
  const rows = await queryApp(
    page,
    `SELECT content,
            json_extract(metadata, '$.systemFailure.kind'),
            json_extract(metadata, '$.systemFailure.failure'),
            json_extract(metadata, '$.systemFailure.submission.content')
     FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
    [branchId],
  )
  return rows.map(([content, kind, failure, submission]) => ({
    content: content as string,
    kind,
    failure,
    submission,
  }))
}

// The seeded branch ends on a plain system row (no systemFailure), which the first Send deletes,
// so the wait is for one row that carries a failure kind, not for any one row.
async function failureRow(page: Page, branchId: string): Promise<SystemRow> {
  await expect
    .poll(async () => (await systemRows(page, branchId)).map((row) => row.kind), {
      timeout: 30_000,
    })
    .toEqual([expect.any(String)])
  const [row] = await systemRows(page, branchId)
  return row
}

// More than one row for a marker would be a duplicated write.
async function entryIdByContent(
  page: Page,
  branchId: string,
  marker: string,
): Promise<string | undefined> {
  const rows = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? AND content LIKE ?`,
    [branchId, `%${marker}%`],
  )
  expect(rows.length, `${marker} row count`).toBeLessThanOrEqual(1)
  return rows[0]?.[0] as string | undefined
}

async function pollEntryId(page: Page, branchId: string, marker: string): Promise<string> {
  await expect
    .poll(() => entryIdByContent(page, branchId, marker), { timeout: 30_000 })
    .toBeDefined()
  const id = await entryIdByContent(page, branchId, marker)
  if (id === undefined) throw new Error(`${marker}: present at the poll, gone on read-back`)
  return id
}

async function promptTotal(page: Page, entryId: string): Promise<number> {
  const rows = await queryApp(
    page,
    `SELECT json_extract(metadata, '$.tokens.prompt') FROM story_entries WHERE id = ?`,
    [entryId],
  )
  return Number(rows[0]?.[0] ?? 0)
}

const streamedCalls = (mock: MockLlm): number => mock.requests.filter((r) => r.streamed).length

test.describe('context window — a turn over a configured window', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  // Far under any narrative prompt the seeded story builds.
  const WINDOW = 100

  test.beforeAll(async () => {
    // Retrieval blocks narrative: no installed embedder, no call to refuse. Cold cache downloads ~24 MB.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    setContextWindowOverride(seeded.dbPath, SEED_MODEL, WINDOW)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('is refused before it is sent, with the numbers on its entry and the input held', async () => {
    const page = app.window
    await home.openStory(page, STORY).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branchId = await currentBranchId(page, 'story_hero')

    await reader.composer(page).fill('E2E-WINDOW-CHECK-U1 I ride for the ford.')
    await reader.send(page).click()

    const row = await failureRow(page, branchId)
    expect([row.kind, row.failure]).toEqual(['context-window', 'check'])
    expect(row.submission).toEqual(expect.stringContaining('E2E-WINDOW-CHECK-U1'))
    const copy = copyPattern('reader:systemEntry.failure.contextWindow.check', {
      fixed: {
        model: SEED_MODEL,
        window: WINDOW,
        source: t('common:contextWindowSource.configured'),
      },
      numbers: ['estimate'],
    }).exec(row.content)
    expect(copy, row.content).not.toBeNull()
    expect(copyNumber(copy, 'estimate')).toBeGreaterThan(WINDOW)
    // The check runs before the request is built: nothing reached the server.
    expect(streamedCalls(mock)).toBe(0)
    expect(await entryIdByContent(page, branchId, 'E2E-WINDOW-CHECK-U1')).toBeUndefined()

    await expect(reader.retrySystemEntry(page)).toBeVisible()
    await expect(reader.dismissSystemEntry(page)).toBeVisible()
    // `Set window` stays hidden until M7.1, and a window entry offers no profile fix.
    await expect(reader.fixProfile(page)).toHaveCount(0)
  })
})

// Serial: each test sends from the reader the first opened, and the toast's once-per-model rule
// spans the app session the turns share.
test.describe('context window — a provider overflow, then the truncation cross-check', () => {
  test.describe.configure({ mode: 'serial' })

  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  // The prompt total a turn the server counted in full recorded; set by the usage test.
  let fullPrompt = 0

  test.beforeAll(async () => {
    // Retrieval blocks narrative: no installed embedder, no reply. Cold cache downloads ~24 MB.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    // No pass chains under these turns, so each test reads only its narrative's effects.
    setClassifierCadence(seeded.dbPath, 'story_hero', 100)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  async function send(action: string, reply: string): Promise<void> {
    mock.setNarrative(reply)
    await reader.composer(app.window).fill(action)
    await reader.send(app.window).click()
  }

  // The counts vary with the prompt, so the toast is found by its whole copy with both captured.
  const truncationCopy = (): RegExp =>
    copyPattern('common:truncationWarning', {
      fixed: { model: SEED_MODEL },
      numbers: ['reported', 'estimate'],
    })
  const truncationToast = (): Locator => toast.withText(app.window, truncationCopy())

  test('a provider overflow fails the turn after one request, and Retry resends the held input', async () => {
    const page = app.window
    await home.openStory(page, STORY).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branchId = await currentBranchId(page, 'story_hero')
    const before = streamedCalls(mock)

    mock.overflowNextNarrative()
    await send('E2E-OVERFLOW-U1 I call across the ford.', 'E2E-OVERFLOW-R1 the ferryman answers.')

    const row = await failureRow(page, branchId)
    expect([row.kind, row.failure]).toEqual(['context-window', 'provider'])
    expect(row.submission).toEqual(expect.stringContaining('E2E-OVERFLOW-U1'))
    const copy = copyPattern('reader:systemEntry.failure.contextWindow.provider', {
      texts: ['message'],
      numbers: ['estimate'],
    }).exec(row.content)
    expect(copy, row.content).not.toBeNull()
    // llama.cpp's own message, quoted as the server sent it.
    expect(copy?.groups?.message).toContain('exceeds the available context size')
    // The window is unknown, so the check let the call through, but the estimate was still counted.
    expect(copyNumber(copy, 'estimate')).toBeGreaterThan(0)
    // Never retried: one request, rejected.
    expect(streamedCalls(mock)).toBe(before + 1)
    await expect(reader.retrySystemEntry(page)).toBeVisible()
    await expect(reader.fixProfile(page)).toHaveCount(0)

    await reader.retrySystemEntry(page).click()

    await pollEntryId(page, branchId, 'E2E-OVERFLOW-R1')
    expect(
      await entryIdByContent(page, branchId, 'E2E-OVERFLOW-U1'),
      'Retry resent the held input',
    ).toBeDefined()
    await expect
      .poll(async () => (await systemRows(page, branchId)).length, { timeout: 15_000 })
      .toBe(0)
    expect(streamedCalls(mock)).toBe(before + 2)
  })

  test('a streamed turn records the prompt total the server reported, and warns of nothing', async () => {
    const page = app.window
    const branchId = await currentBranchId(page, 'story_hero')
    await waitForTurnTerminal(page)

    await send('E2E-USAGE-U1 I step off the ferry.', 'E2E-USAGE-R1 the bank is mud to the ankle.')
    const replyId = await pollEntryId(page, branchId, 'E2E-USAGE-R1')
    await waitForTurnTerminal(page)

    // includeUsage asks for it; without it a stream reports none and the total reads 0.
    fullPrompt = await promptTotal(page, replyId)
    expect(fullPrompt).toBeGreaterThan(0)
    // The harness counts near the app's estimate, so a full count raises no warning.
    expect(await truncationToast().count()).toBe(0)
  })

  test('an under-reported prompt raises the warning toast with both counts', async () => {
    const page = app.window
    const branchId = await currentBranchId(page, 'story_hero')

    mock.underReportNextUsage()
    await send('E2E-USAGE-U2 I look back at the river.', 'E2E-USAGE-R2 the ferry is already gone.')
    const replyId = await pollEntryId(page, branchId, 'E2E-USAGE-R2')

    await expect(truncationToast()).toBeVisible({ timeout: 10_000 })
    const reported = await promptTotal(page, replyId)
    // The server's count reached the entry under-reported: a tenth of a prompt at least this large.
    expect(reported).toBeLessThan(fullPrompt / 2)
    const counts = truncationCopy().exec((await truncationToast().textContent())?.trim() ?? '')
    expect(copyNumber(counts, 'reported')).toBe(reported)
    expect(copyNumber(counts, 'estimate')).toBeGreaterThan(reported * 2)
    await waitForTurnTerminal(page)
  })

  test('a second under-reported turn on the same model warns no more', async () => {
    const page = app.window
    const branchId = await currentBranchId(page, 'story_hero')
    // The first toast's 5 s must run out, so a toast seen below is one this turn raised.
    await expect(truncationToast()).toHaveCount(0, { timeout: 10_000 })

    mock.underReportNextUsage()
    await send('E2E-USAGE-U3 I turn toward the town.', 'E2E-USAGE-R3 smoke rises over the roofs.')
    const replyId = await pollEntryId(page, branchId, 'E2E-USAGE-R3')

    // The ratio fell under 0.5 again, so only the once-per-model rule keeps the toast down.
    expect(await promptTotal(page, replyId)).toBeLessThan(fullPrompt / 2)
    // Counted at once, not awaited: the sink fires at the stream's finish, before the reply
    // commits, and a toast it raised would still be up.
    expect(await truncationToast().count()).toBe(0)
    await waitForTurnTerminal(page)
    expect(await truncationToast().count()).toBe(0)
  })
})
