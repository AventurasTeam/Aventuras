import { expect, test } from '@playwright/test'

import { passProbe } from '../flows/classifier-pass'
import { goToWorld, openStory } from '../flows/navigation'
import { takeTurn } from '../flows/turn'
import { currentBranchId, queryApp, queryScalar } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { promptOf, startMockLlm, type MockLlm } from '../harness/mock-llm'
import {
  createSeededUserDataDir,
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
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { world } from '../locators/world'

// Unit tests drive a turn's commit chaining its pass; only a running app runs the real pass, so
// read its writes back through the DB bridge (docs/testing.md -> Selector strategy, tier 1).
test.describe('periodic classifier — graph population', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    // Retrieval blocks ahead of narrative, so a turn without an installed
    // embedder never reaches the reply.
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
    // embedder never reaches the reply.
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
    // embedder never reaches the reply.
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
    const turnRuns = () =>
      queryScalar(page, `SELECT COUNT(*) FROM pipeline_runs WHERE kind = 'per-turn'`)
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
      await queryScalar(
        page,
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
  // In the open region, and only Kael and Vorne know of it (seed-dataset.ts).
  const PACT = 'Vorne’s pact'

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
    const pact = await idOf('happenings', 'title', PACT)
    const outOfReach = {
      'The alley ambush': await idOf('happenings', 'title', 'The alley ambush'),
      'The market fire': await idOf('happenings', 'title', 'The market fire'),
      'The old betrayal': await idOf('happenings', 'title', 'The old betrayal'),
    }

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

    // classifier.md → What the classifier reads → Known happenings: the pact occurred in the open
    // region; the ambush and the fire in closed chapters past the reach-back, and the betrayal has
    // no position, so each of those is listed only when a turn was given it.
    const recorded = new Set(
      (
        await queryApp(
          page,
          `SELECT DISTINCT j.value FROM story_entries e, json_each(e.metadata, '$.injectedHappenings') j
           WHERE e.branch_id = ? AND e.content LIKE 'E2E-WRITER-R%'`,
          [HERO_BRANCH],
        )
      ).map(([id]) => id as string),
    )
    const listed = (title: string) => {
      try {
        placeholderIn(prompt, title)
        return true
      } catch {
        return false
      }
    }
    expect(listed(PACT), 'a happening in the open region is listed').toBe(true)
    for (const [title, id] of Object.entries(outOfReach))
      expect(listed(title), `${title} is listed iff a turn was given it`).toBe(recorded.has(id))
    expect(
      Object.values(outOfReach).some((id) => !recorded.has(id)),
      'the turns left one out, so the bound is exercised',
    ).toBe(true)

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
          happening: ph(PACT),
          ref: ph('The Ashen Sage'),
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
      [HERO_BRANCH, sage, pact],
    )
    expect(awareness?.[0]).toBe('told by Kael')
    expect(awareness?.[1]).toBeCloseTo(0.7)
    expect(awareness?.[2]).toBe(turn2Reply)
  })
})
