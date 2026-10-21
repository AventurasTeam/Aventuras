import { expect, test, type Locator } from '@playwright/test'

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
  seedClassifierBacklog,
  setClassifierCadence,
  setClassifierMentionedPlaces,
  setProviderEndpoint,
  unassignClassifierAgent,
} from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { memoryBanner } from '../locators/memory-banner'
import { reader } from '../locators/reader'
import { storyLeave } from '../locators/story-leave'
import { toast } from '../locators/toast'

// A turn's commit chaining its pass only happens in a running app; assert the graph through the
// DB bridge (docs/testing.md -> Selector strategy, tier 1).
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

    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
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
    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    // Read before the turn: t1 is the first prose turn above the watermark the pass starts from.
    const [[firstTurn]] = await queryApp(
      app.window,
      `SELECT id FROM story_entries
       WHERE branch_id = ? AND kind <> 'system' AND position > COALESCE(
         (SELECT json_extract(classifier_status, '$.processedThrough') FROM branches WHERE id = ?), 0)
       ORDER BY position LIMIT 1`,
      [branchId, branchId],
    )
    await reader.composer(app.window).fill('E2E-FACTIONS I watch Ilsabet take the oath.')
    await reader.send(app.window).click()
    await expect(app.window.getByText('E2E-FACTIONS Ilsabet', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

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

// A pre-flight halt never reaches the phase, so nothing records the failure: status would stay
// idle, never counting toward failed-persistent, and every commit would chain the doomed run again.
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

// The reader's distance from the bottom once its geometry has held for 10 frames: an end
// state, not the first sample that happens to pass.
function settledDistanceFromBottom(scroller: Locator): Promise<number> {
  return scroller.evaluate(
    (el) =>
      new Promise<number>((resolve) => {
        let stableFrames = 0
        let last = ''
        const tick = () => {
          const key = `${el.scrollHeight}|${el.clientHeight}|${el.scrollTop}`
          stableFrames = key === last ? stableFrames + 1 : 0
          last = key
          if (stableFrames >= 10) resolve(el.scrollHeight - el.scrollTop - el.clientHeight)
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

// classifier.md → Pipeline framing. The mock holds the pass's call open, so every step acts on a
// pass provably in flight. Serial: the tests build on one another (see reader-regenerate.spec.ts).
test.describe('periodic classifier — the gated pass', () => {
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
    setProviderEndpoint(seeded.dbPath, mock.url)
    // A turn writes two entries: with the watermark at the last reply, each
    // committed turn brings exactly one pass due.
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

  async function branchId(): Promise<string> {
    return (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
  }

  // A reply streams into the DOM before its row commits, so callers poll the row; more than one
  // row for a marker would be a duplicated write.
  async function entryIdByContent(branch: string, marker: string): Promise<string | undefined> {
    const rows = await queryApp(
      app.window,
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
      app.window,
      `SELECT action_id, log_position FROM deltas WHERE branch_id = ? AND target_table = 'story_entries'
         AND op = 'create' AND target_id = ?`,
      [branch, entryId],
    )
    expect(rows.length, `create delta for entry ${entryId}`).toBe(1)
    return { actionId: rows[0][0] as string, logPosition: rows[0][1] as number }
  }

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

  // The count on the open rollback confirm's world-state line (probed up to 50), else null.
  async function shownWorldStateCount(): Promise<number | null> {
    for (let count = 0; count <= 50; count++) {
      if ((await reader.rollbackWorldStateLine(app.window, count).count()) > 0) return count
    }
    return null
  }

  // pipeline_runs has no branch column; only this story's passes run in this app.
  async function passOutcomes(): Promise<(string | null)[]> {
    const rows = await queryApp(
      app.window,
      `SELECT outcome FROM pipeline_runs WHERE kind = 'periodic-classifier' AND story_id = 'story_hero'
       ORDER BY started_at, rowid`,
    )
    return rows.map((r) => r[0] as string | null)
  }

  async function runOutcome(actionId: string): Promise<string | null> {
    const rows = await queryApp(
      app.window,
      `SELECT outcome FROM pipeline_runs WHERE action_id = ?`,
      [actionId],
    )
    return rows[0][0] as string | null
  }

  async function passDeltas(actionId: string): Promise<{ count: number; last: number | null }> {
    const rows = await queryApp(
      app.window,
      `SELECT COUNT(*), MAX(log_position) FROM deltas WHERE action_id = ?`,
      [actionId],
    )
    return { count: rows[0][0] as number, last: rows[0][1] as number | null }
  }

  async function classifierStatus(branch: string): Promise<unknown[]> {
    return (
      await queryApp(
        app.window,
        `SELECT json_extract(classifier_status, '$.state'),
                json_extract(classifier_status, '$.retryCount'),
                json_extract(classifier_status, '$.processedThrough')
         FROM branches WHERE id = ?`,
        [branch],
      )
    )[0]
  }

  const passCalls = () => mock.requests.filter((r) => r.agent === 'periodic-classifier').length

  // The held pass's action id, once its call reached the mock past `callsBefore`.
  async function heldPass(callsBefore: number): Promise<string> {
    await expect.poll(passCalls, { timeout: 30_000 }).toBeGreaterThan(callsBefore)
    const rows = await queryApp(
      app.window,
      `SELECT action_id FROM pipeline_runs
       WHERE kind = 'periodic-classifier' AND story_id = 'story_hero' AND finished_at IS NULL`,
    )
    expect(rows, 'one pass in flight').toHaveLength(1)
    return rows[0][0] as string
  }

  async function send(action: string, reply: string): Promise<void> {
    mock.setNarrative(reply)
    await reader.composer(app.window).fill(action)
    await reader.send(app.window).click()
  }

  const deferralToast = () => toast.withText(app.window, t('chrome.deferredWork.pass'))

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
    await expect(reader.editEntry(page, offHead)).toBeDisabled()
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
    if (before === null) throw new Error('the rollback confirm shows no world-state count ≤ 50')

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
    // Its pre-run status back: no retry spent, the watermark where it stood.
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
