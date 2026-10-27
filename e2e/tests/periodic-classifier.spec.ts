import { expect, test, type Locator, type Page } from '@playwright/test'

import { goToWorld, openStory } from '../flows/navigation'
import { takeTurn } from '../flows/turn'
import { currentBranchId, queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { EXAMPLES, promptOf, startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  enableDiagnostics,
  parkClassifierWatermarkAtLastReply,
  removeUserDataDir,
  retireSeededCharacter,
  seedClassifierBacklog,
  seedUnplacedPlace,
  setClassifierCadence,
  setClassifierMentionedPlaces,
  setProviderEndpoint,
  unassignClassifierAgent,
} from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { memoryBanner } from '../locators/memory-banner'
import { reader, worldStateCountOf } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { storyLeave } from '../locators/story-leave'
import { toast } from '../locators/toast'
import { world } from '../locators/world'

// Unit tests drive a turn's commit chaining its pass; only a running app runs the real pass, so
// read its writes back through the DB bridge (docs/testing.md -> Selector strategy, tier 1).
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

    const branchId = await currentBranchId(app.window, 'story_hero')

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

    // Provenance landed on the pass's own delta (the seed already logs anchored periodic rows),
    // and the watermark advanced.
    const anchored = await queryApp(
      app.window,
      `SELECT COUNT(*) FROM deltas
       WHERE branch_id = ? AND source = 'periodic_classifier' AND entry_id IS NOT NULL
         AND target_table = 'happenings' AND target_id IN
           (SELECT id FROM happenings WHERE branch_id = ? AND title LIKE '%ford%')`,
      [branchId, branchId],
    )
    expect(anchored[0][0]).toBe(1)

    const status = await queryApp(
      app.window,
      `SELECT json_extract(classifier_status, '$.processedThrough') FROM branches WHERE id = ?`,
      [branchId],
    )
    expect(status[0][0]).toBeGreaterThan(0)
  })
})

// classifier.md → Mentioned places: only a running app takes the stored setting's schema pick to
// the commit. The matcher is unit-tested (plan.test.ts).
test.describe('periodic classifier — mentioned places', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative('E2E-PLACES the fleet is said to sail from Varn.')
    mock.setStructured('periodic-classifier-places', {
      happenings: [
        {
          title: 'The fleet sails from Varn',
          sourceTurn: 't1',
          involvements: [{ ref: 'new:dock', role: 'site' }],
          awareness: [],
        },
      ],
      relationships: [],
      statusFlips: [],
      newCharacters: [],
      newPlaces: [
        {
          handle: 'new:varn',
          name: 'Varn',
          description: 'A salt town on the far coast.',
          keywords: ['the salt town'],
          sourceTurn: 't1',
        },
        {
          handle: 'new:dock',
          name: 'the East Dock',
          description: 'Where the fleet ties up.',
          sourceTurn: 't1',
          parent: 'new:varn',
        },
      ],
    })
    setProviderEndpoint(seeded.dbPath, mock.url)
    setClassifierCadence(seeded.dbPath, 'story_hero', 1)
    setClassifierMentionedPlaces(seeded.dbPath, 'story_hero', true)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('a pass creates the places it names, nested, and ties its happening to the dock', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-PLACES I ask where the fleet sails from.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-PLACES the fleet', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    await expect
      .poll(() => mock.requests.some((r) => r.agent === 'periodic-classifier-places'), {
        timeout: 20_000,
      })
      .toBe(true)
    expect(mock.requests.some((r) => r.agent === 'periodic-classifier')).toBe(false)

    const branchId = await currentBranchId(app.window, 'story_hero')
    const placeRow = async (name: string) =>
      (
        await queryApp(
          app.window,
          `SELECT id, status, injection_mode, json_extract(state, '$.parent_location_id'),
                  keywords, description
           FROM entities WHERE branch_id = ? AND kind = 'location' AND name = ?`,
          [branchId, name],
        )
      )[0]

    // The involvement is the burst's last write, and each write commits on its own.
    const site = async () =>
      queryApp(
        app.window,
        `SELECT entity_id FROM happening_involvements
         WHERE branch_id = ? AND happening_id IN
           (SELECT id FROM happenings WHERE branch_id = ? AND title = 'The fleet sails from Varn')`,
        [branchId, branchId],
      )
    await expect.poll(async () => (await site()).length, { timeout: 20_000 }).toBe(1)
    const varn = await placeRow('Varn')
    const dock = await placeRow('the East Dock')
    expect(varn.slice(1, 4)).toEqual(['active', 'auto', null])
    expect(JSON.parse(varn[4] as string)).toEqual(['the salt town'])
    expect(varn[5]).toBe('A salt town on the far coast.')
    expect(dock[3]).toBe(varn[0])
    expect(await site()).toEqual([[dock[0]]])

    // Both creates are the pass's, on an entry anchor; plan.test.ts pins which entry.
    const anchored = await queryApp(
      app.window,
      `SELECT COUNT(*) FROM deltas
       WHERE branch_id = ? AND source = 'periodic_classifier' AND entry_id IS NOT NULL
         AND target_table = 'entities' AND target_id IN (?, ?)`,
      [branchId, varn[0], dock[0]],
    )
    expect(anchored[0][0]).toBe(2)
  })
})

// classifier.md → Factions: a pass's faction create and the membership naming it, through the
// real schema, parse and burst. Reconciliation and the planner's rules are unit-tested
// (reconcile.test.ts, plan.test.ts).
test.describe('periodic classifier — factions', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setNarrative('E2E-FACTIONS Ilsabet swears herself to the Salt Wardens.')
    mock.setStructured('periodic-classifier', {
      happenings: [],
      relationships: [],
      statusFlips: [],
      newCharacters: [
        {
          handle: 'new:ilsabet',
          name: 'Ilsabet Varr',
          description: 'A tide-reader with a broken oar.',
          sourceTurn: 't1',
        },
      ],
      newFactions: [
        {
          handle: 'new:wardens',
          name: 'The Salt Wardens',
          description: 'Keepers of the drowned coast.',
          keywords: ['the Wardens'],
          sourceTurn: 't1',
        },
      ],
      memberships: [{ character: 'new:ilsabet', faction: 'new:wardens', sourceTurn: 't1' }],
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

  test('a pass creates the faction it names and puts the new character in it', async () => {
    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    const branchId = await currentBranchId(app.window, 'story_hero')
    // Read before the turn moves it; t1 is the first prose row above it: this turn's user_action.
    const [[watermark]] = await queryApp(
      app.window,
      `SELECT json_extract(classifier_status, '$.processedThrough') FROM branches WHERE id = ?`,
      [branchId],
    )
    await reader.composer(app.window).fill('E2E-FACTIONS I watch Ilsabet take the oath.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-FACTIONS Ilsabet', { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    // The user_action commits before the turn's run starts, so it is in place once the reply shows.
    const [[firstTurn]] = await queryApp(
      app.window,
      `SELECT id FROM story_entries
       WHERE branch_id = ? AND kind <> 'system' AND position > ? ORDER BY position LIMIT 1`,
      [branchId, watermark],
    )

    // The membership is the burst's last write, and each write commits on its own.
    const memberFaction = async () =>
      (
        await queryApp(
          app.window,
          `SELECT json_extract(state, '$.faction_id') FROM entities
           WHERE branch_id = ? AND kind = 'character' AND name = 'Ilsabet Varr'`,
          [branchId],
        )
      )[0]?.[0] ?? null
    await expect.poll(memberFaction, { timeout: 20_000 }).not.toBeNull()

    const [faction] = await queryApp(
      app.window,
      `SELECT id, status, injection_mode, description, keywords FROM entities
       WHERE branch_id = ? AND kind = 'faction' AND name = 'The Salt Wardens'`,
      [branchId],
    )
    expect(faction.slice(1, 4)).toEqual(['active', 'auto', 'Keepers of the drowned coast.'])
    expect(JSON.parse(faction[4] as string)).toEqual(['the Wardens'])
    expect(await memberFaction()).toBe(faction[0])

    // The membership is its own field write, anchored on the turn its sourceTurn names.
    const memberships = await queryApp(
      app.window,
      `SELECT undo_payload, entry_id FROM deltas
       WHERE branch_id = ? AND source = 'periodic_classifier' AND op = 'update'
         AND target_table = 'entities'
         AND json_type(undo_payload, '$.state.faction_id') IS NOT NULL
         AND target_id IN
           (SELECT id FROM entities WHERE branch_id = ? AND name = 'Ilsabet Varr')
       ORDER BY log_position`,
      [branchId, branchId],
    )
    expect(memberships).toHaveLength(1)
    expect(JSON.parse(memberships[0][0] as string)).toEqual({ state: { faction_id: null } })
    expect(memberships[0][1]).toBe(firstTurn)
  })
})

// configureClassifierEmbedder wiring: only a launch shows boot handing reconcileNewEntity the real
// embedder (docs/testing.md -> Embedder in E2E). The paraphrase below scores ~0.87 against the
// fixture's staged "The Ashen Sage" (br_hero_main) on real MiniLM, above TAU_HIGH (0.75).
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

    const branchId = await currentBranchId(app.window, 'story_hero')

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
    const branchId = await currentBranchId(app.window, 'story_hero')
    const watermark = async () =>
      (
        await queryApp(
          app.window,
          `SELECT json_extract(classifier_status, '$.processedThrough') FROM branches WHERE id = ?`,
          [branchId],
        )
      )[0][0]

    // The backlog is owed at Send: its pass runs before the turn (classifier.md → Failure policy).
    // Held at the narrative call, nothing is chained: the watermark there is that pass's alone.
    mock.holdNextNarrative()
    await reader.composer(app.window).fill('E2E-BACKLOG I keep riding.')
    await reader.send(app.window).click()
    await expect.poll(() => mock.requests.some((r) => r.streamed), { timeout: 30_000 }).toBe(true)

    const first = mock.requests.findIndex((r) => r.agent === 'periodic-classifier')
    expect(first, 'a pass ran ahead of the narrative call').toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(mock.requests.findIndex((r) => r.streamed))
    const prompt = JSON.stringify(mock.requests[first].body)
    // Position 2 is fixture prose, far below both the fillers and the reader's
    // loaded tail — reachable only by a window read from SQLite.
    expect(prompt).toContain('I follow the figure into the alley')
    expect(prompt).not.toContain('FILLER-')
    // classifierWindowMaxEntries defaults to 20, so one pass claims 2..21, already committed when
    // the turn's narrative call went out.
    expect(await watermark()).toBe(21)

    mock.releaseNarrative()
    await expect(app.window.getByText('E2E-BACKLOG the road', { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    // The turn's commit chains the next twenty, from the watermark the first pass left.
    await expect.poll(watermark, { timeout: 20_000 }).toBe(41)
    const passes = mock.requests.filter((r) => r.agent === 'periodic-classifier')
    expect(passes).toHaveLength(2)
    expect(JSON.stringify(passes[1].body)).not.toContain('FILLER-')
  })
})

// classifier.md → Failure policy: a pre-flight halt skips the phase, so only the pipeline's hook
// records it; unrecorded, the status reads idle over a failed pass. Send owes it by the watermark.
test.describe('periodic classifier — unassigned agent', () => {
  test.describe.configure({ mode: 'serial' })

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

  const { passOutcomes, classifierStatus } = passProbe(
    () => app.window,
    () => mock,
  )

  const REFUSED = 'E2E-NOAGENT I trim the wick.'

  test('records the pre-flight failure as failed, and the next Send fails on it before its turn', async () => {
    const page = app.window
    await home.openStory(page, 'The Veilstone Courier').click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    const branchId = await currentBranchId(page, 'story_hero')
    const status = () => classifierStatus(branchId)
    const scalar = async (sql: string, params: unknown[] = []): Promise<unknown> =>
      (await queryApp(page, sql, params))[0][0]
    const turnRuns = () => scalar(`SELECT COUNT(*) FROM pipeline_runs WHERE kind = 'per-turn'`)
    const [, , parked] = await status()

    // The watermark is parked at the last prose row, so this Send owes nothing and takes its turn.
    await reader.composer(page).fill('E2E-NOAGENT I light the lantern.')
    await reader.send(page).click()
    await expect(page.getByText('E2E-NOAGENT the lantern', { exact: false })).toBeVisible({
      timeout: 30_000,
    })
    // Its commit chains the pass, which halts pre-flight: failed, the watermark where it stood.
    await expect.poll(async () => (await status())[0], { timeout: 20_000 }).toBe('failed')
    expect(await status()).toEqual(['failed', 'classifier: no-profile-assigned', parked])

    // Now owed, the pass runs first at the next Send and fails it: no user_action, no turn.
    const turnsBefore = await turnRuns()
    await reader.composer(page).fill(REFUSED)
    await reader.send(page).click()
    await expect(reader.systemEntryFailure(page, 'memoryNoProfileAssigned')).toBeVisible({
      timeout: 20_000,
    })
    await expect(reader.assignProfileFix(page)).toBeVisible()
    await expect(reader.composer(page)).toHaveValue(REFUSED)
    expect(
      await scalar(
        `SELECT COUNT(*) FROM story_entries WHERE branch_id = ? AND content LIKE '%E2E-NOAGENT I trim%'`,
        [branchId],
      ),
    ).toBe(0)
    expect(await turnRuns()).toBe(turnsBefore)
    // The entry keeps what its Retry runs (the pass alone) and the fix it offers, across a restart.
    expect(
      await queryApp(
        page,
        `SELECT json_extract(metadata, '$.systemFailure.pass'),
                json_extract(metadata, '$.systemFailure.failure')
         FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
        [branchId],
      ),
    ).toEqual([['failed', 'no-profile-assigned']])
    expect(await passOutcomes()).toEqual(['failed', 'failed'])
    expect(await status()).toEqual(['failed', 'classifier: no-profile-assigned', parked])
    // Neither pass reached the provider, and the refused Send never reached its narrative call.
    expect(mock.requests.some((r) => r.agent === 'periodic-classifier')).toBe(false)
    expect(mock.requests.filter((r) => r.streamed)).toHaveLength(1)
  })

  // reader-composer.md → Custody of the turn's text: the held entry advises a restart, which the
  // draft wouldn't survive. A hold takes an undo that didn't commit, which no UI reaches, so the
  // test writes the status that failure leaves.
  test("a Retry that finds the branch held moves the composer's draft onto the entry", async () => {
    const page = app.window
    const branchId = await currentBranchId(page, 'story_hero')
    await queryApp(
      page,
      `UPDATE branches SET classifier_status = json_set(classifier_status, '$.state', 'running')
       WHERE id = ?`,
      [branchId],
    )

    await reader.retrySystemEntry(page).click()
    await expect(reader.systemEntryFailure(page, 'memoryHeld')).toBeVisible({ timeout: 20_000 })
    await expect(reader.retrySystemEntry(page)).toHaveCount(0)
    await expect(reader.composer(page)).toHaveValue('')
    expect(
      await queryApp(
        page,
        `SELECT json_extract(metadata, '$.systemFailure.pass'),
                json_extract(metadata, '$.systemFailure.submission.content')
         FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
        [branchId],
      ),
    ).toEqual([['held', REFUSED]])

    await reader.dismissSystemEntry(page).click()
    await expect(reader.composer(page)).toHaveValue(REFUSED)
  })
})

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

// A pass that writes one happening, so its run leaves deltas to find by action_id.
function gatedPassReply(title: string) {
  return {
    happenings: [{ title, description: 'E2E gated pass.', sourceTurn: 't1' }],
    relationships: [],
    statusFlips: [],
    newCharacters: [],
    newFactions: [],
    memberships: [],
  }
}

// Valid JSON the pass's schema rejects, so both parse attempts fail and the pass fails.
const UNPARSEABLE_PASS_REPLY = { happenings: 'not a list' }

// The inert reply cut after its sixth list: jsonrepair would close it into a reply the schema
// accepts, so only the strict parse a 'length' stop gets refuses it.
const CUT_PASS_REPLY =
  '{"happenings":[],"relationships":[],"statusFlips":[],"newCharacters":[],"newFactions":[],"memberships":[]'

// The run, status and entry reads the pass describes share. Getters, since each describe's
// beforeAll assigns its app and mock after this runs.
function passProbe(page: () => Page, mockLlm: () => MockLlm) {
  function branchId(): Promise<string> {
    return currentBranchId(page(), 'story_hero')
  }

  // A reply streams into the DOM before its row commits, so callers poll the row; more than one
  // row for a marker would be a duplicated write.
  async function entryIdByContent(branch: string, marker: string): Promise<string | undefined> {
    const rows = await queryApp(
      page(),
      `SELECT id FROM story_entries WHERE branch_id = ? AND content LIKE ?`,
      [branch, `%${marker}%`],
    )
    expect(rows.length, `${marker} row count`).toBeLessThanOrEqual(1)
    return rows[0]?.[0] as string | undefined
  }

  async function pollEntryId(branch: string, marker: string): Promise<string> {
    await expect.poll(() => entryIdByContent(branch, marker), { timeout: 30_000 }).toBeDefined()
    const id = await entryIdByContent(branch, marker)
    if (id === undefined) throw new Error(`${marker}: present at the poll, gone on read-back`)
    return id
  }

  async function createDelta(
    branch: string,
    entryId: string,
  ): Promise<{ actionId: string; logPosition: number }> {
    const rows = await queryApp(
      page(),
      `SELECT action_id, log_position FROM deltas WHERE branch_id = ? AND target_table = 'story_entries'
         AND op = 'create' AND target_id = ?`,
      [branch, entryId],
    )
    expect(rows.length, `create delta for entry ${entryId}`).toBe(1)
    return { actionId: rows[0][0] as string, logPosition: rows[0][1] as number }
  }

  // pipeline_runs has no branch column; only this story's passes run in this app.
  async function passOutcomes(): Promise<(string | null)[]> {
    const rows = await queryApp(
      page(),
      `SELECT outcome FROM pipeline_runs WHERE kind = 'periodic-classifier' AND story_id = 'story_hero'
       ORDER BY started_at, rowid`,
    )
    return rows.map((r) => r[0] as string | null)
  }

  async function runOutcome(actionId: string): Promise<string | null> {
    const rows = await queryApp(page(), `SELECT outcome FROM pipeline_runs WHERE action_id = ?`, [
      actionId,
    ])
    return rows[0][0] as string | null
  }

  async function passDeltas(actionId: string): Promise<{ count: number; last: number | null }> {
    const rows = await queryApp(
      page(),
      `SELECT COUNT(*), MAX(log_position) FROM deltas WHERE action_id = ?`,
      [actionId],
    )
    return { count: rows[0][0] as number, last: rows[0][1] as number | null }
  }

  async function classifierStatus(branch: string): Promise<unknown[]> {
    return (
      await queryApp(
        page(),
        `SELECT json_extract(classifier_status, '$.state'),
                json_extract(classifier_status, '$.lastError'),
                json_extract(classifier_status, '$.processedThrough')
         FROM branches WHERE id = ?`,
        [branch],
      )
    )[0]
  }

  const passCalls = (): number =>
    mockLlm().requests.filter((r) => r.agent === 'periodic-classifier').length

  // The held pass's action id, once its call reached the mock past `callsBefore`.
  async function heldPass(callsBefore: number): Promise<string> {
    await expect.poll(passCalls, { timeout: 30_000 }).toBeGreaterThan(callsBefore)
    const rows = await queryApp(
      page(),
      `SELECT action_id FROM pipeline_runs
       WHERE kind = 'periodic-classifier' AND story_id = 'story_hero' AND finished_at IS NULL`,
    )
    expect(rows, 'one pass in flight').toHaveLength(1)
    return rows[0][0] as string
  }

  async function send(action: string, reply: string): Promise<void> {
    mockLlm().setNarrative(reply)
    await reader.composer(page()).fill(action)
    await reader.send(page()).click()
  }

  const deferralToast = (): Locator => toast.withText(page(), t('chrome.deferredWork.pass'))

  return {
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
  }
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

// The pass's prompt lists rows as `- [<placeholder>] <name>`, nested places indented
// (lib/prompts/bundled/periodic-classifier.ts), so a reply can name them once the call is held.
function placeholderIn(prompt: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The name ends at a kind or status, a description, or the line's end, so a longer name it
  // prefixes isn't matched.
  const match = new RegExp(`^\\s*- \\[([a-z]+\\d+)\\] ${escaped}(?= \\(| —|$)`, 'm').exec(prompt)
  if (match === null) throw new Error(`the pass's prompt lists no "${name}"`)
  return match[1]
}

// classifier.md → What the classifier writes: pins that every write lands through the real
// schema, planner and actions (rules: plan.test.ts), and that a user edit after the prose a write
// rests on stands (cadence.md → User edits and classifier writes).
test.describe('periodic classifier — the writer map', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  const HERO_BRANCH = 'br_hero_main'
  const SALTMERE = 'E2E Saltmere'
  const FAR_SHORE = 'E2E Far Shore'
  const REVEAL = 'E2E The broker gives his own name'
  const NEW_THREAD = 'E2E Learn who Corvin Vale answers to'
  const USER_STANDING = 'E2E-USER uneasy allies'
  const OLD_PROSE_STANDING = 'E2E-PASS sworn to the Syndicate'
  const SYNDICATE_STANDING = 'E2E-PASS outlawed by the Watch'

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    // The fixture has no unplaced place and no retired character.
    seedUnplacedPlace(seeded.dbPath, HERO_BRANCH, SALTMERE)
    seedUnplacedPlace(seeded.dbPath, HERO_BRANCH, FAR_SHORE)
    retireSeededCharacter(seeded.dbPath, HERO_BRANCH, 'Mira', 'left the Hollow')
    await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    setProviderEndpoint(seeded.dbPath, mock.url)
    // Two turns' four entries bring the pass due, so a user edit can fall between its turns.
    setClassifierCadence(seeded.dbPath, 'story_hero', 4)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  const { branchId, pollEntryId, passOutcomes, runOutcome, passCalls, heldPass } = passProbe(
    () => app.window,
    () => mock,
  )

  async function idOf(table: 'entities' | 'threads' | 'happenings', column: string, value: string) {
    const rows = await queryApp(
      app.window,
      `SELECT id FROM ${table} WHERE branch_id = ? AND ${column} = ?`,
      [HERO_BRANCH, value],
    )
    expect(rows, `${table} ${value}`).toHaveLength(1)
    return rows[0][0] as string
  }

  async function entityOf(id: string) {
    const [[name, keywords, status, retiredReason, state, flag, partner, reason]] = await queryApp(
      app.window,
      `SELECT name, keywords, status, retired_reason, state, name_collision_flag,
              name_collision_partner_id, name_collision_reason
       FROM entities WHERE id = ?`,
      [id],
    )
    return {
      name,
      keywords: JSON.parse(keywords as string) as string[],
      status,
      retiredReason,
      state: JSON.parse(state as string) as Record<string, unknown>,
      flag,
      partner,
      reason,
    }
  }

  test('a pass makes each write the contract gives it, and a later user edit stands', async () => {
    test.setTimeout(150_000)
    const page = app.window
    await openStory(page, 'The Veilstone Courier')
    expect(await branchId()).toBe(HERO_BRANCH)
    const vorne = await idOf('entities', 'name', 'Vorne')
    const sage = await idOf('entities', 'name', 'The Ashen Sage')
    const kael = await idOf('entities', 'name', 'Kael')
    const mira = await idOf('entities', 'name', 'Mira')
    const hollow = await idOf('entities', 'name', 'Veil’s Hollow')
    const saltmere = await idOf('entities', 'name', SALTMERE)
    const farShore = await idOf('entities', 'name', FAR_SHORE)
    const watch = await idOf('entities', 'name', 'The City Watch')
    const syndicate = await idOf('entities', 'name', 'The Veil Syndicate')
    const amulet = await idOf('threads', 'title', 'What the amulet wants')
    const betrayal = await idOf('happenings', 'title', 'The old betrayal')

    mock.setNarrative('E2E-WRITER-R1 The broker waits out the rain under the Watch-house eaves.')
    await takeTurn(page, 'E2E-WRITER-U1 I watch the broker.', 'E2E-WRITER-R1')
    // Below the cadence: no pass has read turn 1 when the user edits after it.
    expect(await passOutcomes()).toEqual([])

    await goToWorld(page)
    await world.categoryTrigger(page).click()
    await world.categoryOption(page, 'faction').click()
    await world.row(page, 'The City Watch').click()
    await world.tab(page, 'identity').click()
    await world.standingField(page).fill(USER_STANDING)
    await saveSession.saveBarSave(page).click()
    await expect(saveSession.saveBarSave(page)).toHaveCount(0)
    expect((await entityOf(watch)).state.standing).toBe(USER_STANDING)
    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)

    // Turn 2 brings the pass due. Its call is held until the reply can name the prompt's ids.
    mock.holdNextStructured('periodic-classifier')
    const calls = passCalls()
    mock.setNarrative('E2E-WRITER-R2 Mira walks back in from the rain as the broker names himself.')
    await takeTurn(page, 'E2E-WRITER-U2 I ask the broker his real name.', 'E2E-WRITER-R2')
    const pass = await heldPass(calls)
    const turn2Reply = await pollEntryId(HERO_BRANCH, 'E2E-WRITER-R2')
    const held = mock.requests.filter((r) => r.agent === 'periodic-classifier').at(-1)
    if (held === undefined) throw new Error('the held pass call was not recorded')
    const prompt = promptOf(held)
    const ph = (name: string) => placeholderIn(prompt, name)

    // t1..t4: turn 1's action and reply, then turn 2's.
    mock.setStructured('periodic-classifier', {
      happenings: [
        {
          title: REVEAL,
          description: 'Vorne admits he was born Corvin Vale.',
          category: 'revelation',
          icon: 'mask',
          sourceTurn: 't4',
          involvements: [{ ref: ph('Vorne'), role: 'actor' }],
          awareness: [],
        },
      ],
      relationships: [],
      newCharacters: [],
      newFactions: [],
      memberships: [],
      aliases: [],
      statusFlips: [{ ref: ph('Mira'), to: 'active', sourceTurn: 't4' }],
      renames: [
        { ref: ph('Vorne'), name: 'Corvin Vale', sourceTurn: 't4' },
        // Kael holds that name: a clash, so a keyword and a flag instead of a rename.
        { ref: ph('The Ashen Sage'), name: 'Kael', sourceTurn: 't4' },
      ],
      placements: [
        { ref: ph(SALTMERE), parent: ph('Veil’s Hollow'), sourceTurn: 't4' },
        { ref: ph(FAR_SHORE), parent: 'top-level', sourceTurn: 't4' },
      ],
      standings: [
        // Turn 1's reply: older than the user's edit, so the edit stands.
        { ref: ph('The City Watch'), standing: OLD_PROSE_STANDING, sourceTurn: 't2' },
        { ref: ph('The Veil Syndicate'), standing: SYNDICATE_STANDING, sourceTurn: 't4' },
      ],
      newThreads: [
        {
          title: NEW_THREAD,
          description: 'Someone above Vorne holds his leash.',
          category: 'mystery',
          icon: 'key',
          status: 'active',
          sourceTurn: 't4',
        },
      ],
      threadStatuses: [
        { thread: ph('What the amulet wants'), status: 'resolved', sourceTurn: 't4' },
      ],
      knownAwareness: [
        {
          happening: ph('The old betrayal'),
          ref: ph('Vorne'),
          source: 'told by Kael',
          severity: 0.7,
          learnedAtTurn: 't4',
        },
      ],
    })
    mock.releaseStructured()
    await expect.poll(() => runOutcome(pass), { timeout: 30_000 }).toBe('completed')

    // Names: a reveal renames, keeping the old name; a taken name is a keyword and a flag.
    expect(await entityOf(vorne)).toMatchObject({
      name: 'Corvin Vale',
      keywords: ['the broker', 'Vorne'],
    })
    expect(await entityOf(sage)).toMatchObject({
      name: 'The Ashen Sage',
      keywords: ['the mentor', 'Kael'],
      flag: 1,
      partner: kael,
      reason: 'name-taken',
    })
    // Where a place sits: placed under a parent, and marked top-level.
    expect((await entityOf(saltmere)).state).toEqual({ parent_location_id: hollow })
    expect((await entityOf(farShore)).state).toEqual({ parent_location_id: null })
    // A standing on newer prose lands; the user's edit after older prose stands.
    expect((await entityOf(syndicate)).state.standing).toBe(SYNDICATE_STANDING)
    expect((await entityOf(watch)).state.standing).toBe(USER_STANDING)
    expect(
      await queryApp(page, `SELECT COUNT(*) FROM deltas WHERE action_id = ? AND target_id = ?`, [
        pass,
        watch,
      ]),
    ).toEqual([[0]])
    // A return in the scene now.
    expect(await entityOf(mira)).toMatchObject({ status: 'active', retiredReason: null })
    // Threads: a new one triggered on its turn, a listed one resolved there.
    expect(
      await queryApp(
        page,
        `SELECT status, category, icon, injection_mode, triggered_at_entry_id, resolved_at_entry_id
         FROM threads WHERE branch_id = ? AND title = ?`,
        [HERO_BRANCH, NEW_THREAD],
      ),
    ).toEqual([['active', 'mystery', 'key', 'auto', turn2Reply, null]])
    expect(
      await queryApp(page, `SELECT status, resolved_at_entry_id FROM threads WHERE id = ?`, [
        amulet,
      ]),
    ).toEqual([['resolved', turn2Reply]])
    expect(
      await queryApp(
        page,
        `SELECT category, icon FROM happenings WHERE branch_id = ? AND title = ?`,
        [HERO_BRANCH, REVEAL],
      ),
    ).toEqual([['revelation', 'mask']])
    const [awareness] = await queryApp(
      page,
      `SELECT source, decay_resistance, learned_at_entry_id FROM happening_awareness
       WHERE branch_id = ? AND character_id = ? AND happening_id = ?`,
      [HERO_BRANCH, vorne, betrayal],
    )
    expect(awareness?.[0]).toBe('told by Kael')
    expect(awareness?.[1]).toBeCloseTo(0.7)
    expect(awareness?.[2]).toBe(turn2Reply)
  })
})
