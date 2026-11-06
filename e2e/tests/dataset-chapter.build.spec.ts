import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, test, type Page } from '@playwright/test'

import { modelProfileSchema, providerInstanceSchema } from '@/lib/db'

import { scrubProviderKeys } from '../../scripts/dataset-chapter/export'
import {
  DATASET_TOKEN_BAND,
  datasetTokens,
  loadShapedDataset,
  type ShapedDataset,
} from '../../scripts/dataset-chapter/shape'
import { createAdventureStory } from '../flows/create-story'
import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { storySettings } from '../locators/story-settings'
import { wizard } from '../locators/wizard'

// Builds the dataset chapter (docs/testing.md → Real-provider checks): a played story to measure a
// close on. The harness mock narrates the committed replies; a real model classifies. Opt-in:
//   DATASET_CHAPTER_OUT=<file> SMOKE_LLM_URL=http://host:port/v1 SMOKE_LLM_MODEL=<id> pnpm dataset:chapter
// SMOKE_LLM_KEY sets the real server's API key, for a hosted one; none by default. The export blanks it.
const OUT = process.env.DATASET_CHAPTER_OUT
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL
const LLM_KEY = process.env.SMOKE_LLM_KEY ?? ''

const DATASET_DIR = join(__dirname, '..', '..', 'scripts', 'dataset-chapter')
const TITLE = 'Treasure Island'
const LEAD = 'Jim Hawkins'
const MOCK_MODEL = 'dataset/mock'
const PER_TURN = 'per-turn'
const PERIODIC = 'periodic-classifier'

// A pass's call expires at the classifier's default bound, ten minutes (no profile timeout here),
// which a spec can't import from lib; the extra minute covers reconcile's embeds and writes.
const PASS_WAIT_MS = 600_000 + 60_000
const TURN_SETTLE_MS = 240_000
// A Send can run an owed pass before its turn (classifier.md → Failure policy).
const SEND_SETTLE_MS = PASS_WAIT_MS + TURN_SETTLE_MS
const EDITABLE_WAIT_MS = 120_000
// A run's row lands right after its trigger: a Send's click, a turn's commit.
const ROW_WAIT_MS = 15_000
const STATUS_SETTLE_MS = 10_000
// A refused Send's text back in the composer, after its entry's write and reload.
const DRAFT_RETURN_MS = 30_000
// The first Send and up to three resends.
const SENDS_PER_TURN = 4
// A ceiling, not an estimate: about 66 turns, a third of them chaining a pass on the real model.
const BUILD_TIMEOUT_MS = 5 * 60 * 60 * 1000

type Env = { out: string; url: string; model: string }
type Drive = { page: Page; storyId: string; branchId: string }
type RunRow = { rowid: number; kind: string; outcome: string | null }
type ClassifierStatus = { state: string; processedThrough: number | null; lastError: string | null }
type SystemEntry = { id: string; pass: 'held' | 'failed' | null; content: string }

const log = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

function readEnv(): Env {
  if (!OUT || !LLM_URL || !LLM_MODEL)
    throw new Error('set DATASET_CHAPTER_OUT, SMOKE_LLM_URL and SMOKE_LLM_MODEL')
  return { out: OUT, url: LLM_URL, model: LLM_MODEL }
}

// Narrative, wizard and suggestions on the mock; classifier and lore-mgmt on the real model.
// Runs before launch.
function writeProviders(dbPath: string, mockUrl: string, env: Env): void {
  const providers = [
    providerInstanceSchema.parse({
      id: 'prov_local',
      type: 'openai-compatible',
      displayName: 'Dataset mock',
      apiKey: '',
      endpoint: mockUrl,
      favoriteModelIds: [MOCK_MODEL],
      cachedModels: [{ id: MOCK_MODEL, capabilities: {} }],
    }),
    providerInstanceSchema.parse({
      id: 'prov_dev',
      type: 'openai-compatible',
      displayName: 'Dataset model',
      apiKey: LLM_KEY,
      endpoint: env.url,
      favoriteModelIds: [env.model],
      cachedModels: [{ id: env.model, capabilities: {} }],
    }),
  ]
  const profiles = [
    modelProfileSchema.parse({
      id: 'prof_narrative',
      kind: 'narrative',
      name: 'Dataset narrative (mock)',
      modelRef: { providerId: 'prov_local', modelId: MOCK_MODEL },
      temperature: 0.8,
    }),
    modelProfileSchema.parse({
      id: 'prof_classifier',
      kind: 'agent',
      name: 'Dataset classifier',
      modelRef: { providerId: 'prov_dev', modelId: env.model },
    }),
    modelProfileSchema.parse({
      id: 'prof_assist',
      kind: 'agent',
      name: 'Dataset assist (mock)',
      modelRef: { providerId: 'prov_local', modelId: MOCK_MODEL },
    }),
  ]
  const assignments = {
    narrative: 'prof_narrative',
    classifier: 'prof_classifier',
    'lore-mgmt': 'prof_classifier',
    suggestion: 'prof_assist',
    'wizard-assist': 'prof_assist',
  }
  const db = new DatabaseSync(dbPath)
  try {
    const { changes } = db
      .prepare(
        `UPDATE app_settings SET providers = ?, profiles = ?, assignments = ?, diagnostics = ?
         WHERE id = 'singleton'`,
      )
      .run(
        JSON.stringify(providers),
        JSON.stringify(profiles),
        JSON.stringify(assignments),
        JSON.stringify({ enabled: true, debug_level_enabled: false }),
      )
    if (Number(changes) !== 1) throw new Error(`app_settings: updated ${changes} rows, not 1`)
  } finally {
    db.close()
  }
}

async function scalar(page: Page, sql: string, params: unknown[] = []): Promise<number> {
  return Number((await queryApp(page, sql, params))[0]?.[0])
}

// expect.poll throws at its timeout; here a timeout is an answer.
async function becomes(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

async function runsAfter(d: Drive, rowid: number): Promise<RunRow[]> {
  const rows = (await queryApp(
    d.page,
    `SELECT rowid, kind, outcome FROM pipeline_runs WHERE rowid > ? AND story_id = ? ORDER BY rowid`,
    [rowid, d.storyId],
  )) as [number, string, string | null][]
  return rows.map(([id, kind, outcome]) => ({ rowid: id, kind, outcome }))
}

async function classifierStatus(d: Drive): Promise<ClassifierStatus> {
  const raw = (
    await queryApp(d.page, `SELECT classifier_status FROM branches WHERE id = ?`, [d.branchId])
  )[0]?.[0]
  return typeof raw === 'string'
    ? (JSON.parse(raw) as ClassifierStatus)
    : { state: 'idle', processedThrough: null, lastError: null }
}

// memory-chain.ts's cadence rule, read from the database.
async function passDue(d: Drive): Promise<boolean> {
  const status = await classifierStatus(d)
  if (status.state === 'running') return false
  const cadence = await scalar(
    d.page,
    `SELECT json_extract(settings, '$.classifierCadence') FROM stories WHERE id = ?`,
    [d.storyId],
  )
  const unprocessed = await scalar(
    d.page,
    `SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND kind <> 'system' AND position > ?`,
    [d.branchId, status.processedThrough ?? 0],
  )
  return unprocessed >= Math.max(1, cadence)
}

async function systemEntry(d: Drive): Promise<SystemEntry | null> {
  const row = (
    await queryApp(
      d.page,
      `SELECT id, json_extract(metadata, '$.systemFailure.pass'), content
       FROM story_entries WHERE branch_id = ? AND kind = 'system' ORDER BY position DESC LIMIT 1`,
      [d.branchId],
    )
  )[0] as [string, SystemEntry['pass'], string] | undefined
  return row ? { id: row[0], pass: row[1], content: row[2] } : null
}

const replyCount = (d: Drive): Promise<number> =>
  scalar(d.page, `SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'`, [
    d.branchId,
  ])

// A committed turn chains a pass when one is due (memory-chain.ts → nextMemoryRun); one deferred
// chains nothing and runs before the next Send instead.
async function settleChainedPass(d: Drive, turnRow: number): Promise<string> {
  const pass = async () => (await runsAfter(d, turnRow)).find((run) => run.kind === PERIODIC)
  // In this order: a pass inserts its row before it writes `running`, so a pass starting
  // between the reads is caught by the later one.
  const noneDue = async () =>
    !(await passDue(d)) &&
    (await classifierStatus(d)).state !== 'running' &&
    (await pass()) === undefined
  if (await noneDue()) return 'none due'
  if (!(await becomes(async () => (await pass()) !== undefined, ROW_WAIT_MS)))
    return 'none chained (owed at the next Send)'
  await expect
    .poll(async () => (await pass())?.outcome ?? null, {
      timeout: PASS_WAIT_MS,
      intervals: [3000],
      message: 'the chained pass did not settle within one call bound',
    })
    .not.toBeNull()
  // A failed pass commits its failed marker before writing `failed` to the branch status.
  await expect
    .poll(async () => (await classifierStatus(d)).state, { timeout: STATUS_SETTLE_MS })
    .not.toBe('running')
  return (await pass())?.outcome ?? 'unknown'
}

async function landTurn(
  d: Drive,
  mock: MockLlm,
  index: number,
  total: number,
  turn: { action: string; reply: string },
): Promise<void> {
  const label = `turn ${index + 1}/${total}`
  mock.setNarrative(turn.reply)
  for (let send = 1; send <= SENDS_PER_TURN; send++) {
    await expect(reader.composer(d.page)).toBeEditable({ timeout: EDITABLE_WAIT_MS })
    const since = await scalar(d.page, `SELECT COALESCE(MAX(rowid), 0) FROM pipeline_runs`)
    const repliesBefore = await replyCount(d)
    const priorSystemId = (await systemEntry(d))?.id ?? null
    await reader.composer(d.page).fill(turn.action)
    await reader.send(d.page).click()
    const turnRun = async () => (await runsAfter(d, since)).find((run) => run.kind === PER_TURN)
    // classifier.md → Failure policy: a failed owed pass fails its Send, with no turn.
    const refusal = async (): Promise<SystemEntry | null> => {
      if ((await turnRun()) !== undefined) return null
      const entry = await systemEntry(d)
      return entry !== null && entry.id !== priorSystemId ? entry : null
    }
    await expect
      .poll(async () => (await runsAfter(d, since)).length > 0 || (await refusal()) !== null, {
        timeout: ROW_WAIT_MS,
        message: `${label}: the Send started nothing`,
      })
      .toBe(true)
    await expect
      .poll(async () => (await turnRun())?.outcome != null || (await refusal()) !== null, {
        timeout: SEND_SETTLE_MS,
        intervals: [2000],
        message: `${label}: the Send settled no turn and no refusal`,
      })
      .toBe(true)
    const run = await turnRun()
    if (run === undefined) {
      const entry = (await refusal())!
      if (entry.pass !== 'failed')
        throw new Error(`${label}: the Send failed, not by a failed pass: ${entry.content}`)
      log(`${label}: send ${send} refused by its owed pass`)
      // reader-composer.md → Custody of the turn's text: it goes back to the empty composer.
      await expect(reader.composer(d.page)).toHaveValue(turn.action, { timeout: DRAFT_RETURN_MS })
      continue
    }
    if (run.outcome !== 'completed') {
      log(`${label}: send ${send} ended ${run.outcome}`)
      continue
    }
    expect(await replyCount(d), `${label}: one reply landed`).toBe(repliesBefore + 1)
    const [reply, action] = (await queryApp(
      d.page,
      `SELECT kind, content FROM story_entries
       WHERE branch_id = ? AND kind IN ('user_action', 'ai_reply') ORDER BY position DESC LIMIT 2`,
      [d.branchId],
    )) as [string, string][]
    expect(reply, `${label}: the committed reply`).toEqual(['ai_reply', turn.reply])
    expect(action, `${label}: the committed action`).toEqual(['user_action', turn.action])
    log(`${label}: landed on send ${send}, chained pass ${await settleChainedPass(d, run.rowid)}`)
    return
  }
  throw new Error(`${label}: no reply landed in ${SENDS_PER_TURN} Sends`)
}

async function setClassifierCadenceToOne(d: Drive): Promise<void> {
  await storySettings.openFromReader(d.page).click()
  await storySettings.memoryTab(d.page).click()
  await expect(storySettings.memoryKnobsPanel(d.page)).toBeVisible()
  await storySettings.classifierCadence(d.page).fill('1')
  await storySettings.save(d.page).click()
  await expect(storySettings.save(d.page)).toBeHidden()
  await expect
    .poll(() =>
      scalar(
        d.page,
        `SELECT json_extract(settings, '$.classifierCadence') FROM stories WHERE id = ?`,
        [d.storyId],
      ),
    )
    .toBe(1)
  await chrome.back(d.page).click()
  await expect(reader.composer(d.page)).toBeVisible({ timeout: 20_000 })
}

// Auto-close defaults on (story-settings-defaults.ts:23) and does nothing until Slice 5.6; after
// that, a rebuild would close a chapter at the 24k crossing, mid-drive. Off before the first turn.
async function turnAutoCloseOff(d: Drive): Promise<void> {
  await storySettings.openFromReader(d.page).click()
  await storySettings.memoryTab(d.page).click()
  await expect(storySettings.memoryKnobsPanel(d.page)).toBeVisible()
  await storySettings.chapterAutoClose(d.page).click()
  await storySettings.save(d.page).click()
  await expect(storySettings.save(d.page)).toBeHidden()
  await expect
    .poll(() =>
      scalar(
        d.page,
        `SELECT json_extract(settings, '$.chapterAutoClose') FROM stories WHERE id = ?`,
        [d.storyId],
      ),
    )
    .toBe(0)
  await chrome.back(d.page).click()
  await expect(reader.composer(d.page)).toBeVisible({ timeout: 20_000 })
}

// Criterion 26: what a close at the last reply needs, read once the last pass settled.
async function assertDatasetBranch(d: Drive, dataset: ShapedDataset): Promise<string> {
  const { page, branchId } = d
  const [[entries, tokens]] = (await queryApp(
    page,
    `SELECT COUNT(*), COALESCE(SUM(content_tokens), 0) FROM story_entries
     WHERE branch_id = ? AND kind <> 'system' AND chapter_id IS NULL`,
    [branchId],
  )) as [number, number][]
  expect(entries, 'the open region holds every shaped entry').toBe(1 + 2 * dataset.turns.length)
  expect(
    await scalar(
      page,
      `SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND chapter_id IS NOT NULL`,
      [branchId],
    ),
    'no entry sits in a chapter yet',
  ).toBe(0)
  expect(tokens, 'content_tokens as the shaper counts them').toBe(datasetTokens(dataset))
  expect(tokens).toBeGreaterThanOrEqual(DATASET_TOKEN_BAND.min)
  expect(tokens).toBeLessThanOrEqual(DATASET_TOKEN_BAND.max)

  const [[lastKind, tail]] = (await queryApp(
    page,
    `SELECT kind, position FROM story_entries
     WHERE branch_id = ? AND kind <> 'system' ORDER BY position DESC LIMIT 1`,
    [branchId],
  )) as [string, number][]
  expect(lastKind, 'the open region ends on a reply').toBe('ai_reply')
  const status = await classifierStatus(d)
  expect(status.state, `the last pass settled (lastError: ${status.lastError})`).toBe('idle')
  expect(
    status.processedThrough,
    'the watermark sits at the tail; rebuild if the last pass failed',
  ).toBe(tail)

  expect(
    await scalar(
      page,
      `SELECT COUNT(*) FROM story_entries e
       WHERE e.branch_id = ? AND e.kind IN ('user_action', 'ai_reply') AND NOT EXISTS (
         SELECT 1 FROM deltas d WHERE d.branch_id = e.branch_id AND d.target_table = 'story_entries'
           AND d.target_id = e.id AND d.op = 'create')`,
      [branchId],
    ),
    'entries past the opening with no create delta',
  ).toBe(0)

  // A floor, not a target: under half means the per-turn classifier mostly failed. Read from the
  // turn's own report; `sceneEntities` is inherited, so a failed call keeps the previous scene.
  const scened = await scalar(
    page,
    `SELECT COUNT(*) FROM story_entries
     WHERE branch_id = ? AND kind = 'ai_reply'
       AND COALESCE(json_array_length(metadata, '$.stateReport.sceneEntities'), 0) > 0`,
    [branchId],
  )
  expect(scened, 'replies the per-turn classifier gave a scene').toBeGreaterThanOrEqual(
    Math.ceil(dataset.turns.length / 2),
  )

  const written: string[] = []
  for (const table of ['entities', 'happenings', 'threads'] as const) {
    const count = await scalar(
      page,
      `SELECT COUNT(*) FROM ${table} t WHERE t.branch_id = ? AND EXISTS (
         SELECT 1 FROM deltas d WHERE d.branch_id = t.branch_id AND d.target_table = '${table}'
           AND d.target_id = t.id AND d.op = 'create'
           AND d.source IN ('per_turn_classifier', 'periodic_classifier'))`,
      [branchId],
    )
    expect(count, `${table} the classifiers wrote`).toBeGreaterThan(0)
    written.push(`${table} ${count}`)
  }
  return `entries: ${entries}\ntokens: ${tokens}\nreplies with a reported scene: ${scened}\nclassifier-written: ${written.join(', ')}`
}

// A stale sidecar beside the copy would replay over it on its next open. Checked before the drive
// too, so a bad path fails in seconds rather than after it.
function assertExportTarget(out: string): void {
  expect(existsSync(dirname(out)), `${dirname(out)} exists`).toBe(true)
  for (const suffix of ['-wal', '-shm', '-journal'])
    expect(existsSync(`${out}${suffix}`), `${out}${suffix} would replay over the copy`).toBe(false)
}

// device:push-db refuses a database with a WAL or journal beside it. The desktop DB runs a
// rollback journal, where a read rolls back a hot journal a forced exit left; under WAL the
// checkpoint folds the log in. Each is a no-op in the other mode.
function exportDatabase(dbPath: string, out: string): void {
  const sqlite = new DatabaseSync(dbPath)
  try {
    sqlite.prepare('SELECT COUNT(*) FROM sqlite_schema').get()
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    sqlite.close()
  }
  for (const suffix of ['-wal', '-journal'])
    expect(existsSync(`${dbPath}${suffix}`), `${dbPath}${suffix} after recovery`).toBe(false)
  assertExportTarget(out)
  copyFileSync(dbPath, out)
  scrubProviderKeys(out)
  assertExportTarget(out)
  if (LLM_KEY !== '')
    expect(readFileSync(out).includes(LLM_KEY), 'the export holds no provider key').toBe(false)
}

test.describe('dataset chapter — build', () => {
  // A model failure must fail the build, not pass as flaky on a retry that doubles its length.
  test.describe.configure({ retries: 0 })
  test.skip(
    !OUT || !LLM_URL || !LLM_MODEL,
    'set DATASET_CHAPTER_OUT, SMOKE_LLM_URL and SMOKE_LLM_MODEL to run',
  )

  let app: LaunchedApp | undefined
  let mock: MockLlm | undefined
  let userDataDir: string | undefined
  let dbPath = ''
  let built = false
  const problems: string[] = []

  test.beforeAll(async () => {
    // A cold embedder cache downloads ~24 MB before launch.
    test.setTimeout(300_000)
    const env = readEnv()
    assertExportTarget(env.out)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    dbPath = seeded.dbPath
    mock = await startMockLlm()
    writeProviders(dbPath, mock.url, env)
    await installEmbedderModel(userDataDir)
    app = await launchApp({ userDataDir, cleanupUserData: false })
    app.window.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error')
        problems.push(`[${msg.type()}] ${msg.text()}`)
    })
    app.window.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`))
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    if (built) {
      removeUserDataDir(userDataDir)
      return
    }
    // On a failure the log and the kept database are the only record of what the model did.
    process.stdout.write(
      `\n### warnings and errors (last 200)\n${problems.slice(-200).join('\n')}\n` +
        `### userData kept at: ${userDataDir}\n`,
    )
  })

  test('drives the shaped turns into a branch a close can run on', async () => {
    test.setTimeout(BUILD_TIMEOUT_MS)
    const env = readEnv()
    const dataset = loadShapedDataset(DATASET_DIR)
    const page = app!.window

    await home.newStory(page).click()
    await expect(wizard.modeOption(page, 'adventure')).toBeVisible({ timeout: 15_000 })
    await createAdventureStory(page, { lead: LEAD, title: TITLE, opening: dataset.opening })
    const stories = (await queryApp(
      page,
      `SELECT id, current_branch_id FROM stories WHERE title = ?`,
      [TITLE],
    )) as [string, string][]
    expect(stories, 'exactly one dataset story').toHaveLength(1)
    const [storyId, branchId] = stories[0]!
    const drive: Drive = { page, storyId, branchId }
    await expect(reader.composer(page)).toBeVisible({ timeout: 30_000 })

    const [[opening]] = await queryApp(
      page,
      `SELECT content FROM story_entries WHERE branch_id = ? AND kind = 'opening'`,
      [branchId],
    )
    expect(opening, 'the opening as shaped').toBe(dataset.opening)
    const [[piggyback]] = await queryApp(
      page,
      `SELECT json_extract(settings, '$.piggybackMode') FROM stories WHERE id = ?`,
      [storyId],
    )
    expect(piggyback, 'the per-turn classifier runs as its own call').toBe('off')

    await turnAutoCloseOff(drive)

    log(`\n### turns (${dataset.turns.length})`)
    for (const [index, turn] of dataset.turns.entries()) {
      // The last turn's chained pass then takes the watermark to the tail.
      if (index === dataset.turns.length - 1) await setClassifierCadenceToOne(drive)
      await landTurn(drive, mock!, index, dataset.turns.length, turn)
    }

    const summary = await assertDatasetBranch(drive, dataset)

    const closing = app!
    app = undefined
    await closing.close()
    exportDatabase(dbPath, env.out)
    log(
      `\n### dataset chapter\nbranch: ${branchId}\nstory: ${storyId}\nmodel: ${env.model}\n` +
        `${summary}\nout: ${env.out}`,
    )
    built = true
  })
})
