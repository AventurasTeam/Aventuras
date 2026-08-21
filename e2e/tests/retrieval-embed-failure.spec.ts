import { expect, test } from '@playwright/test'

import { branchStaleTotal, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'

const HERO_TITLE = 'The Veilstone Courier'
const HERO_BRANCH = 'br_hero_main'

const USER_MARKER = 'E2E-EMBEDFAIL-USER'
const REPLY_MARKER = 'E2E-EMBEDFAIL-REPLY'
const REPLY = `${REPLY_MARKER} the amulet answers, memory restored.`
const ACTION = `${USER_MARKER} I reach for the amulet.`

const MARKER_ENTRY_SQL = `SELECT count(*) FROM story_entries WHERE branch_id = ? AND content LIKE '%${USER_MARKER}%'`

// The blocking half of the retrieval seam: with no embedder on disk the sync
// stage fails, and model-management.md → Embed failure is blocking says the turn
// must be refused whole rather than generated against a stale index. The fault
// injection is the absent model — the same shape wizard-embedder-gate.spec.ts
// uses, and no product change. See docs/memory/model-management.md.
//
// Serial, not a plain describe: the second test retries the first one's failed
// turn, so a retry has to replay the pair from the start — Playwright's default
// would re-run beforeAll into a fresh app and then only the second test, which
// has no system entry to retry.
test.describe.serial('retrieval — a failed embed blocks the turn', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    // Deliberately NOT installEmbedderModel — the inverse of every other spec
    // that submits a turn. The model arrives mid-describe, in the second test.
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

  async function scalar(sql: string, params: unknown[] = []): Promise<number> {
    const [[value]] = await queryApp(app.window, sql, params)
    return Number(value)
  }

  async function systemFailureMeta(): Promise<{
    kind: string
    detail?: string
    submission?: { content: string; composerMode: string }
  }> {
    const rows = await queryApp(
      app.window,
      `SELECT metadata FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
      [HERO_BRANCH],
    )
    expect(rows.length, 'exactly one system entry on the branch').toBe(1)
    const metadata = JSON.parse(String(rows[0][0])) as {
      systemFailure?: {
        kind: string
        detail?: string
        submission?: { content: string; composerMode: string }
      }
    }
    expect(metadata.systemFailure, 'the entry carries its failure meta').toBeDefined()
    return metadata.systemFailure!
  }

  test('refuses the turn, reverses the action, and offers Switch embedder', async () => {
    test.setTimeout(120_000)

    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    // This sum IS the detail's staleCount only because no embedder is installed —
    // staleCount is counted AFTER revalidation, which drops rows whose vector still
    // matches. Read live through the harness so seed drift or a new table can't be missed.
    const staleBefore = await branchStaleTotal(app.window, HERO_BRANCH)
    // Without dirty rows runSyncStage short-circuits before the embedder and the
    // magnitude below has nothing to report.
    expect(staleBefore, 'the seed leaves the branch with rows to embed').toBeGreaterThan(0)
    expect(await scalar(MARKER_ENTRY_SQL, [HERO_BRANCH]), 'the marker is ours alone').toBe(0)

    await reader.composer(app.window).fill(ACTION)
    await reader.send(app.window).click()

    // The embedder-specific copy, which only describeTurnFailure's `embedder`
    // arm produces — a failure that reached the generic arm renders the string
    // asserted absent below instead.
    await expect(
      app.window.getByText(t('reader:systemEntry.failure.embed'), { exact: false }),
      'the embedder-specific system entry',
    ).toBeVisible({ timeout: 90_000 })
    await expect(
      app.window.getByText(t('reader:systemEntry.failureMessage'), { exact: false }),
      'not the generic failure copy',
    ).toHaveCount(0)

    // The turn is reversed whole: the user_action shares the run's actionId, so
    // abortRun's reverse-replay takes it with the rest. Nothing narrative-side
    // reached the mock either — retrieval blocks ahead of it.
    expect(
      await scalar(MARKER_ENTRY_SQL, [HERO_BRANCH]),
      'the user action left no row on the branch',
    ).toBe(0)
    expect(
      mock.requests.filter((r) => r.streamed).length,
      'the narrative call was never opened behind the refusal',
    ).toBe(0)

    // The text survives only on the system entry, which is what makes the retry
    // in the next test possible at all — reversed from the timeline, retained
    // for recovery.
    const failure = await systemFailureMeta()
    expect(failure.kind, 'the persisted discriminant drives the fix action').toBe('embedder')
    expect(failure.submission?.content, 'the reversed action is retained for retry').toBe(ACTION)

    // A real staleCount from a real sync failure reaches the rendered detail:
    // reason prefix, cause, and the magnitude in rows. `(null rows)` — the shape
    // this template has to avoid — is unit-pinned in system-entry-actions.test.tsx;
    // what only a run can show is that the number is the branch's actual dirty
    // set rather than a post-drain zero.
    expect(failure.detail, 'the detail carries reason and magnitude').toMatch(
      new RegExp(`^(init|call): .+ \\(${staleBefore} rows\\)$`, 's'),
    )
    await expect(
      app.window.getByText(failure.detail!, { exact: false }),
      'the detail line renders under the copy',
    ).toBeVisible()

    // The fix action exists only because the reader hands the open story's id to
    // useSystemEntryActions; a null there drops the button silently, and no unit
    // test can reach app/**. The id in the URL pins that it is the RIGHT story.
    const [[storyId]] = await queryApp(app.window, `SELECT story_id FROM branches WHERE id = ?`, [
      HERO_BRANCH,
    ])
    // Locator, not an inline selector (testing.md → Selector strategy). Also the positive
    // control for embedder-cancel's toHaveCount(0): a renamed i18n key leaves it green.
    await reader.switchEmbedderFix(app.window).click({ timeout: 15_000 })

    await expect(app.window, 'lands on this story’s memory tab').toHaveURL(
      new RegExp(`/story-settings/${String(storyId)}\\?tab=memory$`),
      { timeout: 20_000 },
    )
    await expect(storySettings.memoryPanel(app.window), 'the memory panel is mounted').toBeVisible()
    // The action's second half: the panel is the swap dialog's only mount host,
    // so routing without opening it would strand the user one click short.
    await expect(
      storySettings.swapDialogTitle(app.window),
      'the swap dialog opened on top of it',
    ).toBeVisible({ timeout: 15_000 })
  })

  test('retries against a model installed after the failure', async () => {
    test.setTimeout(180_000)
    expect(userDataDir, 'the running app’s userData').toBeDefined()

    // Into the SAME userData the app is running against. Init is lazy and a
    // failed pipeline build is evicted rather than cached (electron/embedder/service.ts),
    // so the next call has to pick the files up with no restart.
    await installEmbedderModel(userDataDir!)

    await app.window.goBack()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })

    await reader.retrySystemEntry(app.window).click()
    await expect(app.window.getByText(REPLY_MARKER, { exact: false })).toBeVisible({
      timeout: 120_000,
    })

    // The reversed action is back on the branch, so Retry resubmitted the whole
    // turn rather than resuming a half-committed one.
    expect(await scalar(MARKER_ENTRY_SQL, [HERO_BRANCH]), 'the action recommitted').toBe(1)
    expect(
      await scalar(
        `SELECT count(*) FROM story_entries WHERE branch_id = ? AND content LIKE '%${REPLY_MARKER}%'`,
        [HERO_BRANCH],
      ),
      'the reply committed',
    ).toBe(1)
    // The reply cannot commit unless the blocking stage cleared every flag it
    // found, so a non-zero count here means retrieval stopped blocking on them.
    // (The opportunistic drain can reach the same rows, so this pins the state,
    // not which writer got there first.)
    expect(
      await branchStaleTotal(app.window, HERO_BRANCH),
      'the branch it refused to generate on is embedded',
    ).toBe(0)
    await expect
      .poll(
        async () =>
          scalar(`SELECT count(*) FROM story_entries WHERE branch_id = ? AND kind = 'system'`, [
            HERO_BRANCH,
          ]),
        { timeout: 15_000 },
      )
      .toBe(0)

    // Everything above is also true of a Retry that generated without
    // retrieving: the counts prove the NARRATIVE ran, and the drain clears the
    // stale rows either way. Only the prompt distinguishes a re-run pass from a
    // skipped one, so a short-circuit — a memoised "branch is synced", an
    // intermediate carried across the retried run — would generate against a
    // stale index with an empty bundle and every assertion above would hold.
    // The chapters block is the marker because it is the only one with no
    // structural path: entities, lore and threads all render from the floor too,
    // so their headers appear whether or not the ranker ran. A chapter is ranked
    // or absent. (Happenings are equally exclusive but this fixture seats none.)
    const retried = mock.requests.findLast((r) => r.streamed)
    expect(retried, 'the retry reached the provider').toBeDefined()
    expect(
      JSON.stringify(retried!.body),
      'the retry composed a memory bundle rather than skipping retrieval',
    ).toContain('# Earlier chapters')
  })
})
