import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyDeltaAction, settleUserWrites } from '@/lib/actions/delta/apply-delta-action'
import {
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '@/lib/actions/delta/branch-write-lock'
import { describeDeltaReplayError, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { openStory, WORKING_CONFIG } from '@/lib/actions/turns/__tests__/fixtures'
import { regenerateTurn } from '@/lib/actions/turns/regenerate-turn'
import { submitTurn } from '@/lib/actions/turns/submit-turn'
import { generateStructured } from '@/lib/ai'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { deltas, entities, storyEntries, type ClassifierStatus, type Entity } from '@/lib/db'
import {
  configureDeltaActionPort,
  definePipeline,
  PER_TURN_KIND,
  runPipeline,
  type DeltaActionPort,
  type PhaseResult,
  type RunCtx,
} from '@/lib/pipeline'
import { ensurePeriodicClassifierPipelineRegistered } from '@/lib/pipeline/definitions/periodic-classifier'
import {
  awaitRunTerminal,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  generationStore,
  hydrateAppSettings,
} from '@/lib/stores'

import { makeHarness, resetSingletons } from './harness'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: vi.fn(),
}))

// generation-pipeline.md → No-gate write phase.

type Gate = { opened: Promise<void>; open: () => void }
function gate(): Gate {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function within<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const happening = (title: string) => ({ title, sourceTurn: 't1', involvements: [], awareness: [] })
const reply = (over: Record<string, unknown> = {}) => ({
  happenings: [],
  relationships: [],
  statusFlips: [],
  newCharacters: [],
  aliases: [],
  ...over,
})

function configurePort(overrides: Partial<DeltaActionPort>): void {
  configureDeltaActionPort({
    applyDeltaAction,
    reverseReplayDeltas,
    describeReplayError: describeDeltaReplayError,
    settleUserWrites,
    holdWritePhase: holdBranchWriteExclusive,
    releaseWritePhase: releaseBranchWriteExclusive,
    ...overrides,
  })
}

/** Stands in for the turn: its phase is where a real turn first reads the entities. */
function defineTurn(opts: { phase?: () => Promise<void>; chainsTo?: string } = {}) {
  definePipeline({
    kind: PER_TURN_KIND,
    phases: [
      {
        name: 'turn',
        run: async function* (): AsyncGenerator<never, PhaseResult> {
          await opts.phase?.()
          return { status: 'completed' }
        },
      },
    ],
    ...(opts.chainsTo ? { chainsTo: () => opts.chainsTo ?? null } : {}),
    concurrencyPolicy: { blockedBy: [PER_TURN_KIND, 'chapter-close'] },
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
  })
}

/** A chapter close whose phase 0 drains the pass with 'finish', as the real one does. */
function defineDrainingClose(): { drained: () => boolean } {
  let drained = false
  definePipeline({
    kind: 'chapter-close',
    phases: [
      {
        name: 'phase-0',
        run: async function* (): AsyncGenerator<never, PhaseResult> {
          await awaitRunTerminal(PERIODIC_CLASSIFIER_KIND, 'b1', 'finish')
          drained = true
          return { status: 'completed' }
        },
      },
    ],
    concurrencyPolicy: { blockedBy: [PER_TURN_KIND, 'chapter-close'] },
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
  })
  return { drained: () => drained }
}

async function sourcesInLogOrder(db: RunCtx['db']): Promise<string[]> {
  const rows = await db
    .select({ source: deltas.source })
    .from(deltas)
    .orderBy(asc(deltas.logPosition))
  return rows.map((row) => row.source)
}

describe('a periodic pass and a turn on one branch', () => {
  let ctx: RunCtx

  beforeEach(async () => {
    resetSingletons()
    vi.mocked(generateStructured).mockReset()
    const harness = await makeHarness()
    ctx = harness.ctx
    await openStory(harness.db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)
    await harness.db.insert(storyEntries).values({
      id: 'entry_1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'The fleet sails from Varn.',
      chapterId: null,
      metadata: {},
      createdAt: 1,
    } as never)
    ensurePeriodicClassifierPipelineRegistered()
  })

  afterEach(() => resetSingletons())

  const pass = () => runPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
  const send = (content = 'I follow the fleet.', turnCtx: RunCtx = ctx) =>
    submitTurn({ storyId: 's1', branchId: 'b1' }, { content, composerMode: 'do' }, turnCtx)

  it('never writes while a turn is in flight, holding nothing while it waits', async () => {
    const turnGate = gate()
    defineTurn({ phase: () => turnGate.opened })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: reply({ happenings: [happening('The fleet sails')] }),
    })
    const turn = send()
    await flush()
    const run = pass()
    await flush()

    expect(await sourcesInLogOrder(ctx.db)).toEqual(['user_edit'])
    // The lock is free: an edit from outside the run commits at once.
    const probe = await within(
      applyDeltaAction(
        {
          action: {
            kind: 'createHappening',
            source: 'user_edit',
            payload: {
              entry: { id: 'hap_probe', branchId: 'b1', title: 'p', createdAt: 1, updatedAt: 1 },
            },
          },
          actionId: 'act_probe',
          branchId: 'b1',
        },
        ctx,
      ),
    )
    expect(probe.status).toBe('ok')

    turnGate.open()
    await within(turn)
    expect(await within(run)).toMatchObject({ outcome: 'completed' })
    expect(await sourcesInLogOrder(ctx.db)).toEqual([
      'user_edit',
      'user_edit',
      'periodic_classifier',
    ])
  })

  it('lets a Send made during its burst start after it, never refused', async () => {
    const firstWrite = gate()
    const burstHeld = gate()
    configurePort({
      applyDeltaAction: async (args, applyCtx) => {
        if (args.action.source === 'periodic_classifier') {
          firstWrite.open()
          await burstHeld.opened
        }
        return applyDeltaAction(args, applyCtx)
      },
    })
    let turnStarted = false
    defineTurn({
      phase: async () => {
        turnStarted = true
      },
    })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: reply({ happenings: [happening('A'), happening('B')] }),
    })
    const run = pass()
    await within(firstWrite.opened)

    const turn = send()
    await flush()
    expect(turnStarted).toBe(false)
    expect(await sourcesInLogOrder(ctx.db)).toEqual([])

    burstHeld.open()
    expect(await within(run)).toMatchObject({ outcome: 'completed' })
    expect(await within(turn)).toMatchObject({ outcome: 'completed' })
    expect(turnStarted).toBe(true)
    expect(await sourcesInLogOrder(ctx.db)).toEqual([
      'periodic_classifier',
      'periodic_classifier',
      'user_edit',
    ])
  })

  // The pending mark's window: the turn's user_action committed, its run not yet in txState. A
  // pass that saw no turn there would plan, and the turn would read its entities mid-burst.
  it("doesn't plan while a turn is between its user_action and its run", async () => {
    const order: string[] = []
    const writeStarted = gate()
    const releaseWrite = gate()
    const turnRead = gate()
    let gated = false
    const turnCtx: RunCtx = {
      ...ctx,
      runInTransaction: async (ops) => {
        if (!gated) {
          gated = true
          writeStarted.open()
          await releaseWrite.opened
        }
        return ctx.runInTransaction(ops)
      },
    }
    defineTurn({
      phase: async () => {
        order.push('turn reads entities')
        turnRead.open()
      },
    })
    configurePort({
      applyDeltaAction: async (args, applyCtx) => {
        if (args.action.source === 'periodic_classifier') {
          order.push('pass writes')
          // Fails rather than hangs when the pass gets in first.
          await Promise.race([turnRead.opened, flush(20)])
        }
        return applyDeltaAction(args, applyCtx)
      },
    })
    vi.mocked(generateStructured).mockImplementation(async () => {
      await writeStarted.opened
      return { status: 'ok', value: reply({ happenings: [happening('The fleet sails')] }) }
    })

    const run = pass()
    const turn = send('I board.', turnCtx)
    await within(writeStarted.opened)
    // Let the pass reach its write phase while the user_action is still committing.
    await flush(10)
    releaseWrite.open()

    await within(turn)
    await within(run)
    expect(order).toEqual(['turn reads entities', 'pass writes'])
  })

  // A chained close drains the pass with 'finish': were the pass to wait on it, or on a Send
  // queued behind the turn, neither could finish.
  it('waits on per-turn runs only, so a chained close that drains it completes', async () => {
    const turnGate = gate()
    defineTurn({ phase: () => turnGate.opened, chainsTo: 'chapter-close' })
    const close = defineDrainingClose()
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: reply({ happenings: [happening('The fleet sails')] }),
    })
    const first = send('first')
    await flush()
    const run = pass()
    const second = send('second')
    await flush()
    expect(generationStore.getTxState().pendingTurns.size).toBe(0)

    turnGate.open()
    expect(await within(run)).toMatchObject({ outcome: 'completed' })
    await within(first)
    await within(second)
    expect(close.drained()).toBe(true)
  })

  // Its mark must end when the run registers, not when regenerateTurn returns after the chain.
  it("ends a regenerate's mark at its run, so a chained close that drains the pass completes", async () => {
    const turn = [
      { id: 'entry_u', position: 2, kind: 'user_action', content: 'I board.' },
      { id: 'entry_r', position: 3, kind: 'ai_reply', content: 'The deck rolls.' },
    ].map((row) => ({ ...row, branchId: 'b1', chapterId: null, metadata: {}, createdAt: 2 }))
    await ctx.db.insert(storyEntries).values(turn as never)
    // The sweep finds the reply by its create delta.
    await ctx.db.insert(deltas).values(
      turn.map((row, i) => ({
        id: `d_${row.id}`,
        branchId: 'b1',
        actionId: 'act_turn',
        op: 'create' as const,
        targetTable: 'story_entries',
        targetId: row.id,
        entryId: null,
        source: i === 0 ? ('user_edit' as const) : ('ai_classifier' as const),
        undoPayload: null,
        logPosition: i + 1,
        encodingVersion: 1,
        createdAt: 2,
      })),
    )
    entriesStore.hydrate('b1', await ctx.db.select().from(storyEntries))
    const runStarted = gate()
    const turnGate = gate()
    defineTurn({
      phase: async () => {
        runStarted.open()
        await turnGate.opened
      },
      chainsTo: 'chapter-close',
    })
    const close = defineDrainingClose()
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: reply({ happenings: [happening('The fleet sails')] }),
    })

    const regen = regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'entry_r', ctx)
    await within(runStarted.opened)
    expect(generationStore.getTxState().pendingTurns.size).toBe(0)
    const run = pass()
    await flush()

    turnGate.open()
    expect(await within(run)).toMatchObject({ outcome: 'completed' })
    expect(await within(regen)).toMatchObject({ status: 'ran', result: { outcome: 'completed' } })
    expect(close.drained()).toBe(true)
  })

  // classifier.md → Mentioned places: the create handler's backstop fails the whole pass.
  it('fails and reverses the whole pass when a place lands under a parent retired meanwhile', async () => {
    const VARN = 'loc_11111111-1111-1111-1111-111111111111'
    const varn = {
      id: VARN,
      branchId: 'b1',
      kind: 'location',
      name: 'Varn',
      description: null,
      status: 'active',
      retiredReason: null,
      injectionMode: 'auto',
      nameCollisionFlag: 0,
      nameCollisionPartnerId: null,
      nameCollisionReason: null,
      state: { parent_location_id: null },
      tags: [],
      keywords: [],
      priority: 0,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    } as Entity
    await ctx.db.insert(entities).values({ ...varn, status: 'retired' })
    // The store still shows it active: the planner's check passes and the handler must refuse.
    entitiesStore.hydrate('b1', [varn])
    const open = currentStoryStore.getCurrentStory()
    if (open == null) throw new Error('story not open')
    currentStoryStore.set({
      ...open,
      settings: { ...open.settings, classifierMentionedPlaces: true },
    })
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      value: reply({
        newCharacters: [
          { handle: 'new:jory', name: 'Jory', description: 'A deckhand.', keywords: [] },
        ],
        newPlaces: [
          {
            handle: 'new:dock',
            name: 'the East Dock',
            description: 'A pier.',
            keywords: [],
            sourceTurn: 't1',
            parent: 'l1',
          },
        ],
      }),
    })

    expect(await within(pass())).toMatchObject({ outcome: 'failed' })
    const rows = await ctx.db.select({ id: entities.id }).from(entities)
    expect(rows.map((row) => row.id)).toEqual([VARN])
    const [branch] = await ctx.db.query.branches.findMany({ where: (b) => eq(b.id, 'b1') })
    expect((branch.classifierStatus as ClassifierStatus).retryCount).toBe(1)
  })
})
