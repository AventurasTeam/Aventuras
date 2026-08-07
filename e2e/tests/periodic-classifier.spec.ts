import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  removeUserDataDir,
  seedClassifierBacklog,
  setClassifierCadence,
  setProviderEndpoint,
  unassignClassifierAgent,
} from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// The cadence tick -> runPipeline -> delta-commit chain only exists in a running
// app: the scheduler rides the real pipeline event bus. Drive the UI, assert the
// graph through the DB bridge (docs/testing.md -> Selector strategy, tier 1).
test.describe('periodic classifier — graph population', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn without an installed
    // embedder never reaches the reply. Cold cache downloads ~24 MB.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative('E2E-CLASSIFIER the courier reaches the ford.')
    // A new character with a temp handle keeps the reply independent of the
    // idMap's allocation order, and exercises new-entity emission end to end.
    mock.setStructured('periodic-classifier', {
      happenings: [
        {
          title: 'The courier is ambushed at the ford',
          description: 'Bandits take the satchel.',
          sourceTurn: 't1',
          occurredAtTurn: 't1',
          involvements: [{ ref: 'newbie', role: 'attacker' }],
          awareness: [
            { ref: 'newbie', source: 'witnessed firsthand', severity: 0.9, learnedAtTurn: 't1' },
          ],
        },
      ],
      relationships: [],
      statusFlips: [],
      newCharacters: [
        {
          handle: 'newbie',
          name: 'Bandit captain',
          description: 'A scarred rider.',
          sourceTurn: 't1',
        },
      ],
    })
    setProviderEndpoint(seeded.dbPath, mock.url)
    setClassifierCadence(seeded.dbPath, 'story_hero', 1)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('a committed turn triggers a pass that populates happenings, awareness and the watermark', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-CLASSIFIER I ride for the ford.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-CLASSIFIER the courier', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    await expect
      .poll(() => mock.requests.some((r) => r.agent === 'periodic-classifier'), { timeout: 20_000 })
      .toBe(true)

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string

    await expect
      .poll(
        async () =>
          (
            await queryApp(
              app.window,
              `SELECT COUNT(*) FROM happenings WHERE branch_id = ? AND title LIKE '%ford%'`,
              [branchId],
            )
          )[0][0],
        { timeout: 20_000 },
      )
      .toBe(1)

    // The drain resets embedding_stale moments after the write, so the flag is
    // not observable from here (lessons-learned/staleness-flags-are-cleared-by-the-drain.md).
    // plan.test.ts owns the write-path contract; assert the settled state.
    await expect
      .poll(
        async () =>
          (
            await queryApp(
              app.window,
              `SELECT COUNT(*) FROM happenings
               WHERE branch_id = ? AND title LIKE '%ford%' AND embedding_stale = 1`,
              [branchId],
            )
          )[0][0],
        { timeout: 20_000 },
      )
      .toBe(0)

    // Scoped to the happening this run created — the fixture already seeds
    // unrelated happening_awareness / happening_involvements rows on this branch.
    const awareness = await queryApp(
      app.window,
      `SELECT decay_resistance, learned_at_entry_id, source FROM happening_awareness
       WHERE branch_id = ? AND happening_id IN
         (SELECT id FROM happenings WHERE branch_id = ? AND title LIKE '%ford%')`,
      [branchId, branchId],
    )
    expect(awareness).toHaveLength(1)
    expect(awareness[0][0]).toBeCloseTo(0.9)
    expect(awareness[0][1]).not.toBeNull()

    const involvements = await queryApp(
      app.window,
      `SELECT COUNT(*) FROM happening_involvements
       WHERE branch_id = ? AND happening_id IN
         (SELECT id FROM happenings WHERE branch_id = ? AND title LIKE '%ford%')`,
      [branchId, branchId],
    )
    expect(involvements[0][0]).toBe(1)

    // Provenance landed on the delta, and the watermark advanced.
    const anchored = await queryApp(
      app.window,
      `SELECT COUNT(*) FROM deltas WHERE branch_id = ? AND source = 'periodic_classifier' AND entry_id IS NOT NULL`,
      [branchId],
    )
    expect(anchored[0][0]).toBeGreaterThan(0)

    const status = await queryApp(
      app.window,
      `SELECT json_extract(classifier_status, '$.processedThrough') FROM branches WHERE id = ?`,
      [branchId],
    )
    expect(status[0][0]).toBeGreaterThan(0)
  })
})

// Covers the configureClassifierEmbedder wiring, which unit tests cannot reach:
// reconcileNewCharacter is tested with an injected embedder and the boot wiring
// only for subscription/teardown, so an unwired setter passes both halves. Needs
// a real name collision resolved by a real embedding (docs/testing.md -> Embedder
// in E2E).
//
// Collision target: the fixture's staged "The Ashen Sage" (br_hero_main). The
// paraphrase below scores ~0.87 against the seeded description on the real MiniLM
// model, above TAU_HIGH (0.75).
test.describe('periodic classifier — disambiguation seam', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Cold cache downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative('E2E-DISAMBIG the sage steps from the fog.')
    mock.setStructured('periodic-classifier', {
      happenings: [],
      relationships: [],
      statusFlips: [],
      newCharacters: [
        {
          handle: 'sageHandle',
          name: 'The Ashen Sage',
          description:
            'An old, half-remembered mentor whom the Watch claims has been dead for years.',
          sourceTurn: 't1',
        },
      ],
    })
    setProviderEndpoint(seeded.dbPath, mock.url)
    setClassifierCadence(seeded.dbPath, 'story_hero', 1)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('a real-embedder name collision promotes the staged namesake instead of creating a flagged duplicate', async () => {
    test.setTimeout(60_000)
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-DISAMBIG I press on through the fog.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-DISAMBIG the sage', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    await expect
      .poll(() => mock.requests.some((r) => r.agent === 'periodic-classifier'), { timeout: 20_000 })
      .toBe(true)

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string

    // A real embed pass runs the reconcile decision; poll rather than assume it
    // has landed by the time the request fired.
    await expect
      .poll(
        async () =>
          (
            await queryApp(
              app.window,
              `SELECT status FROM entities WHERE branch_id = ? AND name = 'The Ashen Sage'`,
              [branchId],
            )
          )[0]?.[0],
        { timeout: 30_000 },
      )
      .toBe('active')

    const sageRows = await queryApp(
      app.window,
      `SELECT status, name_collision_flag FROM entities WHERE branch_id = ? AND name = 'The Ashen Sage'`,
      [branchId],
    )
    // Real signal promotes the staged row; a no-signal decision would instead
    // leave a second 'The Ashen Sage' with name_collision_flag = 1.
    expect(sageRows).toHaveLength(1)
    expect(sageRows[0][1]).toBe(0)
  })
})

// entriesStore holds only the last ENTRIES_WINDOW_SIZE entries, so a pass fed
// from it would start at the reader's oldest loaded row and then advance the
// watermark past everything below — prose silently never classified. Only a real
// launch hydrates that store for real, so only E2E proves the phase reads SQLite.
test.describe('periodic classifier — backlog deeper than the reader window', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn without an installed
    // embedder never reaches the reply. Cold cache downloads ~24 MB.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative('E2E-BACKLOG the road goes on.')
    setProviderEndpoint(seeded.dbPath, mock.url)
    setClassifierCadence(seeded.dbPath, 'story_hero', 1)
    // 80 filler turns past a watermark of 1: the tail 50 the reader loads cannot
    // reach position 2, so a store-fed window would skip it.
    seedClassifierBacklog(seeded.dbPath, 'br_hero_main', 80, 1)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('classifies from the watermark, not from the oldest entry the reader holds', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-BACKLOG I keep riding.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-BACKLOG the road', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    await expect
      .poll(() => mock.requests.some((r) => r.agent === 'periodic-classifier'), { timeout: 20_000 })
      .toBe(true)

    const pass = mock.requests.find((r) => r.agent === 'periodic-classifier')!
    const prompt = JSON.stringify(pass.body)
    // Position 2 is fixture prose, far below both the fillers and the reader's
    // loaded tail — reachable only by a window read from SQLite.
    expect(prompt).toContain('I follow the figure into the alley')
    expect(prompt).not.toContain('FILLER-')

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    const watermark = await queryApp(
      app.window,
      `SELECT json_extract(classifier_status, '$.processedThrough') FROM branches WHERE id = ?`,
      [branchId],
    )
    // classifierWindowMaxEntries defaults to 20, so one pass claims 2..21.
    expect(watermark[0][0]).toBe(21)
  })
})

// A pre-flight halt never reaches the phase, so nothing records the failure: the
// status would stay idle, the backoff would never arm, and the cadence would
// re-fire the doomed run on every committed turn.
test.describe('periodic classifier — unassigned agent', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn without an installed
    // embedder never reaches the reply. Cold cache downloads ~24 MB.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative('E2E-NOAGENT the lantern gutters.')
    setProviderEndpoint(seeded.dbPath, mock.url)
    setClassifierCadence(seeded.dbPath, 'story_hero', 1)
    unassignClassifierAgent(seeded.dbPath)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('records the pre-flight failure into the retry lifecycle instead of staying idle', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-NOAGENT I light the lantern.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-NOAGENT the lantern', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string

    await expect
      .poll(
        async () =>
          (
            await queryApp(
              app.window,
              `SELECT json_extract(classifier_status, '$.state') FROM branches WHERE id = ?`,
              [branchId],
            )
          )[0][0],
        { timeout: 20_000 },
      )
      .toBe('retrying')

    const status = await queryApp(
      app.window,
      `SELECT json_extract(classifier_status, '$.retryCount'),
              json_extract(classifier_status, '$.lastError'),
              json_extract(classifier_status, '$.processedThrough')
       FROM branches WHERE id = ?`,
      [branchId],
    )
    expect(status[0][0]).toBe(1)
    expect(status[0][1]).not.toBeNull()
    // A run that never reached the phase must not claim any prose.
    expect(status[0][2] ?? 0).toBe(0)
    expect(mock.requests.some((r) => r.agent === 'periodic-classifier')).toBe(false)
  })
})
