import type { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  isVecFamilyTable,
  pipelineRuns,
  STORY_SETTINGS_DEFAULTS,
  stories,
  storyDefinitionSchema,
  type DbCtx,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { cloneBranch, seedCopyFixture, type TestDb } from '@/lib/db/__tests__/two-branch'
import { isStorySwapPending } from '@/lib/embedder-swap'
import { currentStoryStore, generationStore, resetAllStores, type RunState } from '@/lib/stores'

import {
  checkStoryDuplicate,
  DUPLICATE_REFUSAL,
  type DuplicateBranch,
  type DuplicateRefusalCode,
} from './duplicate-story'

// An in-flight swap holds the embedder's in-process lock, which only a running swap takes; the
// read's own in-flight case is in lib/embedder-swap/app-deps.test.ts.
const swap = vi.hoisted(() => ({ inFlight: new Set<string>() }))

vi.mock('@/lib/embedder-swap', async (importOriginal) => {
  const actual = await importOriginal<{
    readStorySwapPending: (db: DbCtx['db'], storyId: string) => Promise<boolean>
  }>()
  return {
    ...actual,
    readStorySwapPending: async (db: DbCtx['db'], storyId: string) =>
      swap.inFlight.has(storyId) || actual.readStorySwapPending(db, storyId),
  }
})

const STORY = 's_two'
const A = 'br_a'
const B = 'br_b'
const OTHER_STORY = 's_other'
const OTHER_BRANCH = 'br_other'
const AT = 1_767_300_000_000

const DEFINITION = storyDefinitionSchema.parse({
  mode: 'creative',
  narration: 'third',
  genre: { label: 'Western', promptBody: '' },
  tone: { label: 'Spare', promptBody: '' },
  setting: '',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

let t: TestDb

beforeEach(async () => {
  resetAllStores()
  swap.inFlight.clear()
  t = await createTestDb()
  await seedTwoStories()
})

afterEach(() => {
  resetAllStores()
  vi.restoreAllMocks()
})

/**
 * `s_two`, active: A (`br_a`, current) and B (`br_b`), A's copy and child, every id shared; A
 * holds the fixture's finished re-run row. `s_other` holds one empty branch.
 */
async function seedTwoStories(): Promise<void> {
  await seedCopyFixture(t)
  cloneBranch(t.sqlite, A, B)
  t.sqlite
    .prepare("UPDATE stories SET status = 'active', current_branch_id = ? WHERE id = ?")
    .run(A, STORY)
  await t.db.insert(stories).values({
    id: OTHER_STORY,
    title: 'Elsewhere',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
    currentBranchId: OTHER_BRANCH,
  })
  await t.db
    .insert(branches)
    .values({ id: OTHER_BRANCH, storyId: OTHER_STORY, name: 'main', createdAt: AT })
}

const check = (branch: DuplicateBranch, storyId: string = STORY) =>
  checkStoryDuplicate(storyId, branch, { db: t.db })

/** Every table's rows as stored; vec0's shadow tables left out, its family tables read whole. */
function everyRow(sqlite: DatabaseSync): Record<string, unknown[]> {
  const names = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  const rows: Record<string, unknown[]> = {}
  for (const { name } of names) {
    if (isVecFamilyTable(name))
      rows[name] = sqlite
        .prepare(
          `SELECT pk, branch_id, model_id, id, source_hash, hex(embedding) AS embedding FROM ${name} ORDER BY pk`,
        )
        .all()
    else if (!name.includes('_vec_') && !name.startsWith('sqlite_'))
      rows[name] = sqlite.prepare(`SELECT * FROM "${name}"`).all()
  }
  return rows
}

async function expectRefused(
  branch: DuplicateBranch,
  code: DuplicateRefusalCode,
  storyId: string = STORY,
): Promise<void> {
  const before = everyRow(t.sqlite)
  expect(await check(branch, storyId)).toEqual({ status: 'rejected', code })
  expect(everyRow(t.sqlite)).toEqual(before)
}

// No-gate, like a pass: canon refuses any registered run, not only one holding the gate.
function registerRun(run: { storyId: string | null; branchId: string }): void {
  generationStore.startRun({
    runId: 'run_dup_test',
    kind: 'periodic-classifier',
    gateBehavior: 'no-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_dup_test',
    ...run,
    abortController: new AbortController(),
    currentPhase: 'classify',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  } satisfies RunState)
}

function setClassifierState(branchId: string, state: 'idle' | 'running'): void {
  t.sqlite
    .prepare('UPDATE branches SET classifier_status = ? WHERE id = ?')
    .run(
      JSON.stringify({ state, lastSuccessAt: null, lastError: null, processedThrough: 3 }),
      branchId,
    )
}

async function openRunRow(branchId: string): Promise<void> {
  await t.db.insert(pipelineRuns).values({
    runId: `run_open_${branchId}`,
    kind: 'per-turn',
    actionId: `act_open_${branchId}`,
    storyId: STORY,
    branchId,
    startedAt: AT,
  })
}

// The engine's marker, as markSwapPending writes it for E2E.
function markSwap(storyId: string): void {
  t.sqlite
    .prepare('UPDATE stories SET settings = ? WHERE id = ?')
    .run(JSON.stringify({ embedding_swap_target: 'other-embedder' }), storyId)
}

function openStory(storyId: string, branchId: string): void {
  currentStoryStore.set({
    storyId,
    branchId,
    definition: DEFINITION,
    settings: STORY_SETTINGS_DEFAULTS,
  })
}

describe('checkStoryDuplicate', () => {
  it.each<DuplicateBranch>([{ branchId: A }, { branchId: B }, 'all'])(
    'passes a live story copying %j',
    async (branch) => {
      expect(await check(branch)).toEqual({ status: 'ok' })
    },
  )

  it('passes an archived story', async () => {
    t.sqlite.prepare("UPDATE stories SET status = 'archived' WHERE id = ?").run(STORY)
    expect(await check('all')).toEqual({ status: 'ok' })
  })

  it('refuses missing for a story with no row', async () => {
    await expectRefused('all', DUPLICATE_REFUSAL.missing, 's_nowhere')
  })

  it.each<DuplicateBranch>([{ branchId: OTHER_BRANCH }, { branchId: 'br_nowhere' }])(
    'refuses missing for %j, a branch not on the story',
    async (branch) => {
      await expectRefused(branch, DUPLICATE_REFUSAL.missing)
    },
  )

  it('refuses missing for all branches of a story holding none', async () => {
    await t.db
      .insert(stories)
      .values({ id: 's_bare', title: 'Bare', status: 'active', createdAt: AT, updatedAt: AT })
    await expectRefused('all', DUPLICATE_REFUSAL.missing, 's_bare')
  })

  it('refuses a draft', async () => {
    t.sqlite.prepare("UPDATE stories SET status = 'draft' WHERE id = ?").run(STORY)
    await expectRefused('all', DUPLICATE_REFUSAL.draft)
  })

  it.each([
    ['another story open', () => openStory(OTHER_STORY, OTHER_BRANCH)],
    ['no story open', () => {}],
  ] as const)('refuses a swap marker stored on the story, with %s', async (_, open) => {
    markSwap(STORY)
    open()
    // Not vacuous: the open story's check can't see this story's marker.
    expect(isStorySwapPending(STORY)).toBe(false)
    await expectRefused({ branchId: A }, DUPLICATE_REFUSAL.swapPending)
  })

  it('refuses a swap in flight before any marker is stored', async () => {
    swap.inFlight.add(STORY)
    await expectRefused({ branchId: A }, DUPLICATE_REFUSAL.swapPending)
  })

  it("passes while another story's swap is pending", async () => {
    markSwap(OTHER_STORY)
    swap.inFlight.add(OTHER_STORY)
    expect(await check('all')).toEqual({ status: 'ok' })
  })

  it.each([
    ['its story', { storyId: STORY, branchId: 'br_gone' }, { branchId: B }],
    ['its branch alone', { storyId: null, branchId: B }, { branchId: A }],
  ] as const)(
    'refuses a run registered on any branch of the story, matched by %s',
    async (_, run, branch) => {
      registerRun(run)
      await expectRefused(branch, DUPLICATE_REFUSAL.runRegistered)
    },
  )

  it("passes while another story's run is registered", async () => {
    registerRun({ storyId: OTHER_STORY, branchId: OTHER_BRANCH })
    expect(await check('all')).toEqual({ status: 'ok' })
  })

  it('refuses a copied branch whose classifier is running, judging only the copied ones', async () => {
    setClassifierState(B, 'running')
    await expectRefused({ branchId: B }, DUPLICATE_REFUSAL.branchHeld)
    await expectRefused('all', DUPLICATE_REFUSAL.branchHeld)
    expect(await check({ branchId: A })).toEqual({ status: 'ok' })
  })

  it('refuses a copied branch with an unfinished run row, judging only the copied ones', async () => {
    // Not vacuous: A's finished row is a run row too, and must not refuse.
    const finished = t.sqlite
      .prepare(
        'SELECT count(*) AS n FROM pipeline_runs WHERE branch_id = ? AND finished_at IS NOT NULL',
      )
      .get(A) as { n: number }
    expect(finished.n).toBe(1)
    await openRunRow(B)
    await expectRefused({ branchId: B }, DUPLICATE_REFUSAL.unfinishedRun)
    await expectRefused('all', DUPLICATE_REFUSAL.unfinishedRun)
    expect(await check({ branchId: A })).toEqual({ status: 'ok' })
  })

  it('reports the first refusal in canon order', async () => {
    t.sqlite.prepare("UPDATE stories SET status = 'draft' WHERE id = ?").run(STORY)
    markSwap(STORY)
    registerRun({ storyId: STORY, branchId: A })
    setClassifierState(B, 'running')
    await openRunRow(B)
    const first = async () => {
      const checked = await check({ branchId: B })
      return checked.status === 'rejected' ? checked.code : checked.status
    }

    expect(await first()).toBe(DUPLICATE_REFUSAL.draft)
    t.sqlite.prepare("UPDATE stories SET status = 'active' WHERE id = ?").run(STORY)
    expect(await first()).toBe(DUPLICATE_REFUSAL.swapPending)
    t.sqlite.prepare('UPDATE stories SET settings = NULL WHERE id = ?').run(STORY)
    expect(await first()).toBe(DUPLICATE_REFUSAL.runRegistered)
    generationStore.__reset()
    expect(await first()).toBe(DUPLICATE_REFUSAL.branchHeld)
    setClassifierState(B, 'idle')
    expect(await first()).toBe(DUPLICATE_REFUSAL.unfinishedRun)
  })
})
