import { expect, test } from '@playwright/test'

import type { CloseReport } from '@/lib/db'

import { runOutcomes } from '../flows/classifier-pass'
import { openStory } from '../flows/navigation'
import { takeTurn } from '../flows/turn'
import {
  branchStaleTotal,
  chapterByTitle,
  currentBranchId,
  FixtureDb,
  OPEN_REGION_FROM,
  pollEntryIdOf,
  queryApp,
  queryScalar,
} from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { escapeRegExp } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import {
  promptOf,
  startMockLlm,
  toolLaneKey,
  type MockLlm,
  type MockRequest,
} from '../harness/mock-llm'
import {
  createSeededUserDataDir,
  removeUserDataDir,
  seedCloseTaskStarts,
  setChapterAutoClose,
  setChapterTokenThreshold,
  setProviderEndpoint,
  type SeededCloseStarts,
} from '../harness/seed'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// The hero story's current branch in the fixture, read from the file before launch.
const HERO_BRANCH = 'br_hero_main'
const CHAPTER = {
  title: 'The Ledger in the Bell Tower',
  summary: 'Odile hides the Syndicate ledger in the bell tower while the Watch walks in pairs.',
  theme: 'what is hidden in plain sight',
  keywords: ['ledger', 'bell tower', 'Odile'],
}
const ACTION = 'E2E-AUTO-U1 I ask the watchman who rang the bell last night.'
const REPLY_MARKER = 'E2E-AUTO-R1'
const REPLY = `${REPLY_MARKER} the watchman shrugs and points at the dark tower.`

// memory/chapter-close.md → Run order: each task's tools; their sorted names key its mock lane.
const TOOLS = {
  happenings: ['read_row', 'read_turns', 'merge_happenings'],
  lore: ['read_row', 'create_lore', 'update_lore'],
  identity: ['search_world', 'read_row', 'update_character', 'update_faction'],
  threads: ['read_row', 'update_thread', 'merge_threads'],
  upkeep: [
    'search_world',
    'read_row',
    'update_place',
    'update_item',
    'set_keywords',
    'mark_common_knowledge',
  ],
  lifecycle: ['search_world', 'read_row', 'retire_entity', 'flag_duplicate'],
  awareness: ['read_turns', 'set_pin'],
} as const
const TASK_ORDER = [
  'happenings',
  'lore',
  'identity',
  'threads',
  'upkeep',
  'lifecycle',
  'awareness',
] as const
// The pass phase 0 runs, the boundary call, the metadata call, then each task's lane in run order.
const EXPECTED_ORDER = [
  'periodic-classifier',
  'chapter-boundary',
  'chapter-metadata',
  ...TASK_ORDER.map((task) => toolLaneKey(TOOLS[task])),
]

// What each task's one scripted write sets.
const LORE = {
  title: 'The Bell-Tower Ledgers',
  body: 'Couriers of the Hollow hide their ledgers behind the loose stones of the bell tower, where the Watch never climbs.',
}
const TRAITS = ['watchful']
// A seeded open thread, which gives Threads its start.
const THREAD = 'Expose the Syndicate broker'
const THREAD_DESCRIPTION = 'The ledger hidden in the bell tower names who Vorne answers to.'
const KEYWORD = 'bell tower'
const RETIRED = 'She leaves the Hollow for good once the ledger is hidden.'
const PIN = 0.6

// The seeded reply each task's write cites: the first open reply (her scene) or the second (bell).
const CITED = {
  happenings: ['scene', 'item'],
  lore: ['item'],
  identity: ['scene'],
  threads: ['scene'],
  upkeep: ['item'],
  lifecycle: ['scene'],
  awareness: ['scene'],
} as const satisfies Record<(typeof TASK_ORDER)[number], readonly ('scene' | 'item')[]>

// The boundary call's handle the scripted reply names, t1…tN over the candidates oldest first: a
// middle one, so neither the oldest nor the latest (the unusable reply's end) passes for the pick.
const PICKED_CANDIDATE = 2

type RegionRow = { id: string; position: number; kind: string; tokens: number }

type ClosePlan = {
  threshold: number
  region: readonly RegionRow[]
  /** The candidate the scripted reply names, between the oldest and the latest. */
  end: RegionRow
  /** fallbackChapterEnd's entry, and the latest candidate: where an unusable reply ends. */
  latestReply: RegionRow
  /** A chapter turn's handle, t1…tN by position over the range (close-agent/ids.ts). */
  turnOf: (entryId: string) => string
}

function readRegion(dbPath: string): RegionRow[] {
  const db = new FixtureDb(dbPath)
  try {
    const rows = db.all<{ id: string; position: number; kind: string; tokens: number | null }>(
      `SELECT id, position, kind, content_tokens AS tokens ${OPEN_REGION_FROM} ORDER BY position`,
      HERO_BRANCH,
    )
    // openRegionSeries reads the stored count; a row with none would move the window under us.
    if (rows.some((row) => row.tokens === null)) {
      throw new Error(`${HERO_BRANCH}'s open region holds a row with no stored token count`)
    }
    return rows.map((row) => ({
      id: row.id,
      position: Number(row.position),
      kind: row.kind,
      tokens: Number(row.tokens),
    }))
  } finally {
    db.close()
  }
}

// chapter-close.md → Phase 1: a reply whose running total sits within half a threshold either side
// of one, never the newest. The crossing turn's reply is the newest, so each seeded reply is one.
function candidatesOf(region: readonly RegionRow[], threshold: number): RegionRow[] {
  const kept: RegionRow[] = []
  let total = 0
  for (const row of region) {
    total += row.tokens
    if (row.kind === 'ai_reply' && total >= threshold / 2 && total <= threshold * 1.5) {
      kept.push(row)
    }
  }
  return kept
}

function planClose(region: readonly RegionRow[], starts: SeededCloseStarts): ClosePlan {
  // One token over the region: nothing is owed at launch, and any turn crosses.
  const threshold = region.reduce((sum, row) => sum + row.tokens, 0) + 1
  const candidates = candidatesOf(region, threshold)
  const end = candidates[PICKED_CANDIDATE - 1]
  const latestReply = region.filter((row) => row.kind === 'ai_reply').at(-1)
  if (end === undefined || latestReply === undefined || candidates.length <= PICKED_CANDIDATE) {
    throw new Error(
      `the region gives ${candidates.length} candidates at ${threshold}: the pick must differ from the oldest and the latest`,
    )
  }
  const itemAt = region.find((row) => row.id === starts.itemEntryId)
  if (itemAt === undefined || end.position < itemAt.position) {
    throw new Error(
      `the pick at ${end.position} ends before the second anchor: the starts fall out`,
    )
  }
  const index = new Map(region.map((row, i) => [row.id, i] as const))
  return {
    threshold,
    region,
    end,
    latestReply,
    turnOf: (entryId) => {
      const at = index.get(entryId)
      if (at === undefined) throw new Error(`${entryId} is not in the open region`)
      return `t${at + 1}`
    },
  }
}

// A row's handle as its task's prompt shows it; a throw fails the call, and close() reports it.
function handleIn(request: MockRequest, pattern: RegExp): string {
  const handle = pattern.exec(promptOf(request))?.[1]
  if (handle === undefined)
    throw new Error(`${request.agent}: its prompt shows no ${pattern.source}`)
  return handle
}

const call = (name: string, args: Record<string, unknown>) => ({ toolCalls: [{ name, args }] })

function citedEntries(starts: SeededCloseStarts, task: keyof typeof CITED): string[] {
  return CITED[task].map((reply) => (reply === 'scene' ? starts.sceneEntryId : starts.itemEntryId))
}

// One write per task, each on a row its start shows, so none needs a read_row first (C11). Each
// lane's next call gets the empty step, which ends the task.
function scriptTasks(mock: MockLlm, starts: SeededCloseStarts, plan: ClosePlan): void {
  const [kept, absorbed] = starts.happenings
  const turns = (task: keyof typeof CITED) =>
    citedEntries(starts, task).map((entryId) => plan.turnOf(entryId))
  const character = escapeRegExp(starts.character.name)
  mock.setToolSteps(TOOLS.happenings, [
    (request) =>
      call('merge_happenings', {
        keep: handleIn(request, new RegExp(`### (hp\\d+): ${escapeRegExp(kept.title)}`)),
        absorb: [handleIn(request, new RegExp(`### (hp\\d+): ${escapeRegExp(absorbed.title)}`))],
        turns: turns('happenings'),
        why: 'Both record Odile hiding the one ledger in the bell tower.',
      }),
  ])
  mock.setToolSteps(TOOLS.lore, [
    call('create_lore', {
      title: LORE.title,
      body: LORE.body,
      turns: turns('lore'),
      why: 'The turns show where the Hollow’s couriers keep their ledgers.',
    }),
  ])
  mock.setToolSteps(TOOLS.identity, [
    (request) =>
      call('update_character', {
        id: handleIn(request, new RegExp(`^## (c\\d+): ${character}$`, 'm')),
        traits: TRAITS,
        turns: turns('identity'),
        why: 'She watches the street before she moves.',
      }),
  ])
  mock.setToolSteps(TOOLS.threads, [
    (request) =>
      call('update_thread', {
        id: handleIn(request, new RegExp(`## (th\\d+): ${escapeRegExp(THREAD)} \\(`)),
        description: THREAD_DESCRIPTION,
        turns: turns('threads'),
        why: 'The hidden ledger moves the hunt for the broker on.',
      }),
  ])
  mock.setToolSteps(TOOLS.upkeep, [
    (request) =>
      call('set_keywords', {
        id: handleIn(
          request,
          new RegExp(`## (i\\d+): ${escapeRegExp(starts.item.name)} \\(item, off the scene\\)`),
        ),
        add: [KEYWORD],
        turns: turns('upkeep'),
        why: 'The turn places the bell in its tower.',
      }),
  ])
  mock.setToolSteps(TOOLS.lifecycle, [
    (request) =>
      call('retire_entity', {
        id: handleIn(request, new RegExp(`## (c\\d+): ${character} \\(character\\)`)),
        turns: turns('lifecycle'),
        why: RETIRED,
      }),
  ])
  mock.setToolSteps(TOOLS.awareness, [
    (request) =>
      call('set_pin', {
        id: handleIn(
          request,
          new RegExp(
            `- (aw\\d+): ${character} \\(c\\d+\\), pin ${escapeRegExp(String(starts.awareness.pin))}`,
          ),
        ),
        value: PIN,
        turns: turns('awareness'),
        why: 'The hidden ledger is what her part of the story now turns on.',
      }),
  ])
}

// milestone.md → Definition of done, Auto close: the first close through scripted tool steps.
test.describe('the whole auto close', () => {
  let app: LaunchedApp | undefined
  let mock: MockLlm | undefined
  let userDataDir: string | undefined
  let starts: SeededCloseStarts
  let plan: ClosePlan

  test.beforeAll(async () => {
    // Retrieval blocks narrative, and the range embed clusters: both need the real embedder.
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    await installEmbedderModel(userDataDir)
    starts = seedCloseTaskStarts(seeded.dbPath, HERO_BRANCH)
    plan = planClose(readRegion(seeded.dbPath), starts)
    setChapterTokenThreshold(seeded.dbPath, HERO_STORY, plan.threshold)
    setChapterAutoClose(seeded.dbPath, HERO_STORY, true)
    mock = await startMockLlm()
    mock.setNarrative(REPLY)
    mock.setStructured('chapter-boundary', {
      end_entry_id: `t${PICKED_CANDIDATE}`,
      rationale: 'The scene turns once the ledger is hidden.',
    })
    mock.setStructured('chapter-metadata', CHAPTER)
    scriptTasks(mock, starts, plan)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('a turn over the threshold runs every task in canon’s order, on the boundary the model picked', async () => {
    test.setTimeout(300_000)
    if (!app || !mock) throw new Error('the hero app has not launched')
    const page = app.window
    await openStory(page, HERO_TITLE)
    const branchId = await currentBranchId(page, HERO_STORY)
    expect(branchId, 'the branch the plan read').toBe(HERO_BRANCH)
    expect(plan.end.id, 'the scripted pick isn’t where a fallback would end').not.toBe(
      plan.latestReply.id,
    )
    // The range embed and the open-time drain share the embedder; let the drain finish first.
    await expect
      .poll(() => branchStaleTotal(page, branchId), {
        timeout: 120_000,
        message: 'the open-time drain never went quiet',
      })
      .toBe(0)
    const chaptersBefore = await queryScalar(
      page,
      `SELECT COUNT(*) FROM chapters WHERE branch_id = ?`,
      [branchId],
    )
    const head = await queryScalar(
      page,
      `SELECT COALESCE(MAX(log_position), 0) FROM deltas WHERE branch_id = ?`,
      [branchId],
    )
    const requestsBefore = mock.requests.length

    await takeTurn(page, ACTION, REPLY_MARKER)

    await expect
      .poll(() => runOutcomes(page, 'chapter-close', HERO_STORY), {
        timeout: 120_000,
        message: 'the chained close never finished',
      })
      .toEqual([expect.any(String)])
    const [outcome] = await runOutcomes(page, 'chapter-close', HERO_STORY)
    if (outcome !== 'completed') {
      // A scripted step that threw fails its task; the mock keeps the error for close().
      const closing = mock
      mock = undefined
      const said = await closing.close().then(
        () => 'nothing',
        (error: unknown) => String(error),
      )
      throw new Error(`the close ended ${outcome}; the mock reports ${said}`)
    }
    const [[actionId]] = (await queryApp(
      page,
      `SELECT action_id FROM pipeline_runs WHERE kind = 'chapter-close' AND story_id = ?`,
      [HERO_STORY],
    )) as [string][]

    await test.step('the pass, the boundary, the metadata and the seven lanes, in order', async () => {
      const watched = new Set(EXPECTED_ORDER)
      const seen = mock!.requests
        .slice(requestsBefore)
        .map((request) => request.agent)
        .filter((agent): agent is string => agent !== null && watched.has(agent))
      expect(seen.filter((agent, i) => agent !== seen[i - 1])).toEqual(EXPECTED_ORDER)
      // Phase 0: the turn left its two entries unprocessed under the cadence.
      expect(await runOutcomes(page, 'periodic-classifier', HERO_STORY)).toEqual(['completed'])
    })

    const chapter = await test.step('the chapter ends on the model’s pick', async () => {
      const row = await chapterByTitle(page, branchId, CHAPTER.title)
      expect({
        sequence: row.sequenceNumber,
        start: row.startEntryId,
        end: row.endEntryId,
      }).toEqual({ sequence: chaptersBefore + 1, start: plan.region[0].id, end: plan.end.id })
      const stamps = await queryApp(
        page,
        `SELECT id, chapter_id FROM story_entries
         WHERE branch_id = ? AND id IN (${plan.region.map(() => '?').join(', ')}) ORDER BY position`,
        [branchId, ...plan.region.map((entry) => entry.id)],
      )
      expect(stamps, 'every entry through the pick stamped, those past it open').toEqual(
        plan.region.map((entry) => [entry.id, entry.position <= plan.end.position ? row.id : null]),
      )
      const replyId = await pollEntryIdOf(page, branchId, REPLY_MARKER)
      expect(
        await queryApp(
          page,
          `SELECT chapter_id FROM story_entries WHERE branch_id = ? AND id = ?`,
          [branchId, replyId],
        ),
        'the crossing turn stays open',
      ).toEqual([[null]])
      return row
    })

    await test.step('each task’s scripted write landed', async () => {
      const [kept, absorbed] = starts.happenings
      expect(
        await queryApp(page, `SELECT id FROM happenings WHERE branch_id = ? AND id IN (?, ?)`, [
          branchId,
          kept.id,
          absorbed.id,
        ]),
        'Happenings merged the pair into the first',
      ).toEqual([[kept.id]])
      expect(
        await queryScalar(
          page,
          `SELECT COUNT(*) FROM lore WHERE branch_id = ? AND title = ? AND body = ?`,
          [branchId, LORE.title, LORE.body],
        ),
        'Lore created its row',
      ).toBe(1)
      expect(
        await queryApp(
          page,
          `SELECT json_extract(state, '$.traits'), status, retired_reason
             FROM entities WHERE branch_id = ? AND id = ?`,
          [branchId, starts.character.id],
        ),
        'Identity wrote her traits, then Lifecycle retired her',
      ).toEqual([[JSON.stringify(TRAITS), 'retired', RETIRED]])
      expect(
        await queryApp(page, `SELECT description FROM threads WHERE branch_id = ? AND title = ?`, [
          branchId,
          THREAD,
        ]),
        'Threads moved the thread on',
      ).toEqual([[THREAD_DESCRIPTION]])
      expect(
        await queryApp(page, `SELECT keywords FROM entities WHERE branch_id = ? AND id = ?`, [
          branchId,
          starts.item.id,
        ]),
        'Upkeep gave the item its first keyword',
      ).toEqual([[JSON.stringify([KEYWORD])]])
      expect(
        await queryApp(
          page,
          `SELECT decay_resistance FROM happening_awareness WHERE branch_id = ? AND id = ?`,
          [branchId, starts.awareness.id],
        ),
        'Awareness raised her pin',
      ).toEqual([[PIN]])
    })

    await test.step('every delta of the close is one action’s, anchored on the end (C1)', async () => {
      const closeDeltas = (await queryApp(
        page,
        `SELECT action_id, target_table, op FROM deltas
          WHERE branch_id = ? AND source = 'chapter_close' AND log_position > ? ORDER BY log_position`,
        [branchId, head],
      )) as [string, string, string][]
      expect(new Set(closeDeltas.map(([action]) => action)), 'one action_id').toEqual(
        new Set([actionId]),
      )
      expect(
        await queryApp(
          page,
          `SELECT DISTINCT source, entry_id FROM deltas WHERE branch_id = ? AND action_id = ?`,
          [branchId, actionId],
        ),
      ).toEqual([['chapter_close', plan.end.id]])
      expect(closeDeltas[0]?.slice(1), 'the chapter create comes first').toEqual([
        'chapters',
        'create',
      ])
      expect(closeDeltas.at(-1)?.slice(1), 'the report update comes last').toEqual([
        'chapters',
        'update',
      ])
    })

    await test.step('close_report holds the writes in run order (C4)', async () => {
      const [[json]] = await queryApp(
        page,
        `SELECT close_report FROM chapters WHERE branch_id = ? AND id = ?`,
        [branchId, chapter.id],
      )
      if (typeof json !== 'string') throw new Error(`chapter ${chapter.id} holds no close report`)
      const report = JSON.parse(json) as CloseReport
      expect(report.actionId).toBe(actionId)
      expect(
        report.calls.map(({ task, part, tool, turns, result, reason, skippedFields }) => [
          task,
          part,
          tool,
          turns,
          result,
          reason ?? null,
          skippedFields ?? [],
        ]),
        'each call’s part (0 chapter-wide, the one part from 1) and its turns back as entry ids',
      ).toEqual([
        ['happenings', 0, 'merge_happenings', citedEntries(starts, 'happenings'), 'ok', null, []],
        ['lore', 1, 'create_lore', citedEntries(starts, 'lore'), 'ok', null, []],
        ['identity', 1, 'update_character', citedEntries(starts, 'identity'), 'ok', null, []],
        ['threads', 1, 'update_thread', citedEntries(starts, 'threads'), 'ok', null, []],
        ['upkeep', 1, 'set_keywords', citedEntries(starts, 'upkeep'), 'ok', null, []],
        ['lifecycle', 1, 'retire_entity', citedEntries(starts, 'lifecycle'), 'ok', null, []],
        ['awareness', 0, 'set_pin', citedEntries(starts, 'awareness'), 'ok', null, []],
      ])
      expect(report.stopped).toEqual([])
      expect(report.noToolCalls).toBe(false)
    })

    await test.step('every scripted step was taken', async () => {
      const closing = mock!
      mock = undefined
      await expect(closing.close()).resolves.toBeUndefined()
    })
  })
})
