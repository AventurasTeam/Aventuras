import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
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

// The cadence tick -> runPipeline -> delta-commit chain only exists in a running
// app: the scheduler rides the real pipeline event bus. Drive the UI, assert the
// graph through the DB bridge (docs/testing.md -> Selector strategy, tier 1).
test.describe('periodic classifier — graph population', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
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

    // Nothing embeds on the write path.
    const stale = await queryApp(
      app.window,
      `SELECT embedding_stale FROM happenings WHERE branch_id = ? AND title LIKE '%ford%'`,
      [branchId],
    )
    expect(stale[0][0]).toBe(1)

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

// Regression coverage for a defect this slice actually shipped: through Tasks
// 7-12, configureClassifierEmbedder (lib/pipeline/definitions/periodic-classifier.ts)
// had no caller, so disambiguation always ran with an embedder returning empty
// vectors — every namesake collision degraded to create-flagged 'no-signal'.
// Unit tests stayed green throughout: reconcileNewCharacter is unit-tested with
// an *injected* embedder, and the boot wiring is unit-tested only for
// subscription/teardown. Each half passes while the composition is broken —
// "nobody calls the setter" is invisible to unit tests by construction. The
// happy-path spec above can't catch it either: its reply names a character no
// entity shares, so the name index short-circuits before the embedder is ever
// called. This test needs a REAL name collision resolved by a REAL embedding
// (docs/testing.md -> Embedder in E2E), so only E2E can reach it.
//
// The fixture's staged "The Ashen Sage" (char, br_hero_main) is the collision
// target. The paraphrase below was checked against the real MiniLM model:
// cosine similarity ~0.87 against the seeded description, comfortably above
// TAU_HIGH (0.75).
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
    // A collision resolved with real signal promotes the existing staged row —
    // no second row, no flag. An unwired embedder (no-signal) instead creates a
    // second 'The Ashen Sage' row with name_collision_flag = 1, which is the
    // regression this test exists to catch — don't "simplify" this into the
    // happy-path test above, its reply never triggers the name-index branch.
    expect(sageRows).toHaveLength(1)
    expect(sageRows[0][1]).toBe(0)
  })
})
