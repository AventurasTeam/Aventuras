import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  storyDefinitionSchema,
  storyEntries,
  storySettingsSchema,
  type StoryEntry,
} from '@/lib/db'
import { definePipeline, getPipeline, PER_TURN_KIND, type PhaseResult } from '@/lib/pipeline'
import { currentStoryStore, entriesStore, hydrateAppSettings, undoRedoStore } from '@/lib/stores'

import { submitTurn } from './submit-turn'
import { expectRan, makeHarness, resetSingletons } from '../../pipeline/__tests__/harness'

// The phase streams via the real openai-compatible provider path; stub global
// fetch (a call-time seam, unlike a module mock which the setup-file's eager
// load of this module graph would defeat) with a canned OpenAI SSE stream so the
// happy path gets deterministic streamed tokens without a network round-trip.
function sseFetch(tokens: readonly string[]): typeof fetch {
  const chunks = tokens.map(
    (content) =>
      `data: ${JSON.stringify({
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`,
  )
  chunks.push(
    `data: ${JSON.stringify({
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
    'data: [DONE]\n\n',
  )
  return vi.fn(
    async () =>
      new Response(chunks.join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  ) as unknown as typeof fetch
}

const WORKING_CONFIG = {
  providers: [
    {
      id: 'prov-1',
      type: 'openai-compatible',
      displayName: 'Local',
      apiKey: 'k',
      endpoint: 'http://x/v1',
      favoriteModelIds: [],
    },
  ],
  profiles: [
    {
      id: 'np',
      kind: 'narrative',
      name: 'Narrative',
      modelRef: { providerId: 'prov-1', modelId: 'm' },
    },
  ],
  assignments: {},
  defaultProviderId: 'prov-1',
  diagnostics: { enabled: false, debug_level_enabled: false },
}

const STORY_DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})
const STORY_SETTINGS = storySettingsSchema.parse({
  classifierCadence: 8,
  piggybackMode: 'off',
  embeddingBackend: 'local',
  embedding_model_id: 'm',
  retrievalBudgets: { entities: 1, lore: 1, happenings: 1, threads: 1, chapters: 1 },
  composerModesEnabled: true,
  composerWrapPov: 'first',
  suggestionsEnabled: false,
  suggestionCategories: [],
  translation: {
    enabled: false,
    targetLanguage: null,
    granularToggles: {
      narrative: false,
      entityNames: false,
      entityDescriptions: false,
      lore: false,
      threads: false,
      happenings: false,
      chapterMeta: false,
    },
  },
  models: {},
  activePackId: 'pack_bundled_default',
  packVariables: {},
})

// narrativePhase (pipeline.ts) reads the open story from currentStoryStore, not
// from the run's own storyId/branchId — mirrors the real app opening a story
// before the composer can submit a turn.
function openStory(storyId: string, branchId: string) {
  currentStoryStore.set({
    storyId,
    branchId,
    definition: STORY_DEFINITION,
    settings: STORY_SETTINGS,
  })
}

function branchEntries(branchId: string) {
  return [...entriesStore.getEntries().values()].filter((e) => e.branchId === branchId)
}

describe('submitTurn', () => {
  beforeEach(() => {
    resetSingletons()
    vi.stubGlobal('fetch', sseFetch(['A reply.']))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetSingletons()
  })

  it('registers a two-phase pill-and-banner hard-gate per-turn pipeline', async () => {
    const { ctx } = await makeHarness()
    openStory('s1', 'b1')
    entriesStore.hydrate('b1', [])
    await hydrateAppSettings(async () => WORKING_CONFIG)

    await submitTurn({ storyId: 's1', branchId: 'b1' }, { content: 'x', composerMode: 'do' }, ctx)

    const pipeline = getPipeline(PER_TURN_KIND)
    expect(pipeline.kind).toBe(PER_TURN_KIND)
    expect(pipeline.phases).toHaveLength(2)
    expect(pipeline.affordance).toBe('pill-and-banner')
    expect(pipeline.gateBehavior).toBe('hard-gate')
    expect(pipeline.concurrencyPolicy.blockedBy).toEqual([PER_TURN_KIND, 'chapter-close'])
  })

  it('completes a turn: persists the user action and the streamed AI reply', async () => {
    const { ctx } = await makeHarness()
    openStory('s1', 'b1')
    entriesStore.hydrate('b1', [])
    await hydrateAppSettings(async () => WORKING_CONFIG)

    const result = expectRan(
      await submitTurn(
        { storyId: 's1', branchId: 'b1' },
        { content: 'Hello there', composerMode: 'say' },
        ctx,
      ),
    )

    expect(result.outcome).toBe('completed')
    const rows = branchEntries('b1').sort((a, b) => a.position - b.position)
    expect(rows.map((r) => ({ kind: r.kind, content: r.content, position: r.position }))).toEqual([
      { kind: 'user_action', content: 'Hello there', position: 1 },
      { kind: 'ai_reply', content: 'A reply.', position: 2 },
    ])

    const [reply] = await ctx.db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.kind, 'ai_reply')))
    expect(reply?.metadata?.sceneEntities).toEqual([])
    expect(reply?.metadata?.currentLocationId).toBeNull()
    expect(typeof reply?.metadata?.model).toBe('string')
  })

  it('inherits scene state from the tail entry onto the user_action, and the ai_reply inherits it too', async () => {
    const { ctx } = await makeHarness()
    const opening: StoryEntry = {
      id: 'seed-opening',
      branchId: 'b1',
      position: 1,
      kind: 'opening',
      content: 'The keep looms over the valley.',
      chapterId: null,
      metadata: {
        sceneEntities: ['char_00000000-0000-4000-8000-000000000001'],
        currentLocationId: 'loc_00000000-0000-4000-8000-000000000002',
        worldTime: 5,
      },
      createdAt: 1,
    }
    await ctx.db.insert(storyEntries).values(opening)
    openStory('s1', 'b1')
    entriesStore.hydrate('b1', [opening])
    await hydrateAppSettings(async () => WORKING_CONFIG)

    await submitTurn(
      { storyId: 's1', branchId: 'b1' },
      { content: 'I look around.', composerMode: 'do' },
      ctx,
    )

    const [ua] = await ctx.db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.kind, 'user_action')))
    expect(ua?.metadata?.worldTime).toBe(5)
    expect(ua?.metadata?.sceneEntities).toEqual(['char_00000000-0000-4000-8000-000000000001'])
    expect(ua?.metadata?.currentLocationId).toBe('loc_00000000-0000-4000-8000-000000000002')

    const [reply] = await ctx.db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.kind, 'ai_reply')))
    expect(reply?.metadata?.worldTime).toBe(5)
    expect(reply?.metadata?.sceneEntities).toEqual(['char_00000000-0000-4000-8000-000000000001'])
    expect(reply?.metadata?.currentLocationId).toBe('loc_00000000-0000-4000-8000-000000000002')
  })

  it('inherits worldTime from the last non-system entry when a system tail lingers', async () => {
    const { ctx } = await makeHarness()
    const opening: StoryEntry = {
      id: 'seed-opening',
      branchId: 'b1',
      position: 1,
      kind: 'opening',
      content: 'The keep looms over the valley.',
      chapterId: null,
      metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
      createdAt: 1,
    }
    // An un-cleared failure singleton (metadata null) sitting at the tail —
    // only reachable via a submitTurn caller that skips the reader's
    // clear-system-tail step; worldTime must not reset to 0 from it.
    const systemTail: StoryEntry = {
      id: 'seed-system',
      branchId: 'b1',
      position: 2,
      kind: 'system',
      content: 'Generation failed.',
      chapterId: null,
      metadata: null,
      createdAt: 2,
    }
    await ctx.db.insert(storyEntries).values([opening, systemTail])
    openStory('s1', 'b1')
    entriesStore.hydrate('b1', [opening, systemTail])
    await hydrateAppSettings(async () => WORKING_CONFIG)

    await submitTurn(
      { storyId: 's1', branchId: 'b1' },
      { content: 'I look around.', composerMode: 'do' },
      ctx,
    )

    const [ua] = await ctx.db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.kind, 'user_action')))
    expect(ua?.metadata?.worldTime).toBe(5)
    expect(ua?.position).toBe(3)
  })

  it('positions the new user action at MAX(position)+1, not the store row count', async () => {
    const { ctx } = await makeHarness()
    // Non-contiguous tail: gaps mean the store's row count (4) is LOWER than the
    // real MAX(position) (5), so a count-based position would collide at 5.
    const seeded: StoryEntry[] = [1, 2, 3, 5].map((position) => ({
      id: `seed-${position}`,
      branchId: 'b1',
      position,
      kind: position === 1 ? 'opening' : 'ai_reply',
      content: `seed ${position}`,
      chapterId: null,
      metadata: null,
      createdAt: position,
    }))
    for (const row of seeded) await ctx.db.insert(storyEntries).values(row)
    openStory('s1', 'b1')
    entriesStore.hydrate('b1', seeded)
    await hydrateAppSettings(async () => WORKING_CONFIG)

    await submitTurn(
      { storyId: 's1', branchId: 'b1' },
      { content: 'next', composerMode: 'do' },
      ctx,
    )

    const userAction = branchEntries('b1').find((e) => e.kind === 'user_action')
    expect(userAction?.position).toBe(6)
    const aiReply = branchEntries('b1').find(
      (e) => e.kind === 'ai_reply' && !e.id.startsWith('seed-'),
    )
    expect(aiReply?.position).toBe(7)
  })

  it('assigns distinct positions to two turns submitted concurrently on the same branch', async () => {
    const { ctx } = await makeHarness()
    openStory('s1', 'b1')
    entriesStore.hydrate('b1', [])
    await hydrateAppSettings(async () => WORKING_CONFIG)

    const [a, b] = await Promise.all([
      submitTurn({ storyId: 's1', branchId: 'b1' }, { content: 'first', composerMode: 'do' }, ctx),
      submitTurn({ storyId: 's1', branchId: 'b1' }, { content: 'second', composerMode: 'do' }, ctx),
    ])
    expectRan(a)
    expectRan(b)

    const userActions = branchEntries('b1').filter((e) => e.kind === 'user_action')
    expect(userActions).toHaveLength(2)
    // Every entry in the branch must land at a unique position — a race on the
    // MAX(position)+1 read would otherwise collide both turns on the same slot.
    const positions = branchEntries('b1').map((e) => e.position)
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('reverses the user_action and leaves no orphan when pipeline admission is rejected', async () => {
    const { ctx, db } = await makeHarness()
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'm2', createdAt: 1 })
    entriesStore.hydrate('b1', [])
    entriesStore.hydrate('b2', [])
    await hydrateAppSettings(async () => WORKING_CONFIG)

    // Self-blocking policy + a gated phase: the first submit's run stays
    // reserved and in-flight, so the second submit's admission is rejected —
    // exercising the path runPipeline can take before any run reserves,
    // which abortRun's usual delta-reversal never sees.
    let phaseStarted!: () => void
    const started = new Promise<void>((r) => {
      phaseStarted = r
    })
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    definePipeline({
      kind: PER_TURN_KIND,
      phases: [
        {
          name: 'p',
          run: async function* (): AsyncGenerator<never, PhaseResult> {
            phaseStarted()
            await gate
            return { status: 'completed' }
          },
        },
      ],
      concurrencyPolicy: { blockedBy: [PER_TURN_KIND] },
      affordance: 'pill-only',
      gateBehavior: 'hard-gate',
    })

    const first = submitTurn(
      { storyId: 's1', branchId: 'b1' },
      { content: 'first', composerMode: 'do' },
      ctx,
    )
    await started

    const second = await submitTurn(
      { storyId: 's1', branchId: 'b2' },
      { content: 'second', composerMode: 'do' },
      ctx,
    )
    expect(second.outcome).toBe('rejected')
    if (second.outcome === 'rejected') expect(second.blockedBy).toBe(PER_TURN_KIND)
    expect(branchEntries('b2')).toHaveLength(0)

    release()
    expectRan(await first)
  })

  it('clears the redo stack on success (a new turn is a new unrelated action)', async () => {
    const { ctx } = await makeHarness()
    openStory('s1', 'b1')
    entriesStore.hydrate('b1', [])
    await hydrateAppSettings(async () => WORKING_CONFIG)
    undoRedoStore.pushRedoGroup([])
    expect(undoRedoStore.hasRedo()).toBe(true)

    await submitTurn({ storyId: 's1', branchId: 'b1' }, { content: 'x', composerMode: 'do' }, ctx)

    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('fails the turn and writes no ai_reply when the provider stream errors', async () => {
    const { ctx } = await makeHarness()
    openStory('s1', 'b1')
    entriesStore.hydrate('b1', [])
    await hydrateAppSettings(async () => WORKING_CONFIG)
    // Matches the live "TypeError: Failed to fetch" — a network reject, not an
    // HTTP error status.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const result = expectRan(
      await submitTurn(
        { storyId: 's1', branchId: 'b1' },
        { content: 'Hello', composerMode: 'say' },
        ctx,
      ),
    )

    expect(result.outcome).toBe('failed')
    expect(result.error).toEqual(expect.objectContaining({ kind: 'provider', reason: 'network' }))
    // No empty ai_reply lands (the bug), and the whole turn reverses on failure:
    // the user_action shares the turn's actionId (C6), so abortRun's
    // reverse-replay drops it too — same clean-rollback path as preflight
    // failure. The composer preserves the text for retry, not a persisted row.
    expect(branchEntries('b1')).toHaveLength(0)
  })

  it('halts at preflight when no narrative profile resolves, reversing the user action too', async () => {
    const { ctx } = await makeHarness()
    entriesStore.hydrate('b1', [])
    await hydrateAppSettings(async () => ({ ...WORKING_CONFIG, profiles: [] }))

    const result = expectRan(
      await submitTurn(
        { storyId: 's1', branchId: 'b1' },
        { content: 'Hello there', composerMode: 'say' },
        ctx,
      ),
    )

    expect(result.outcome).toBe('failed')
    expect(result.error?.kind).toBe('config-resolver')
    // The user_action's delta shares the turn's actionId (C6), so abortRun's
    // actionId-scoped reverseReplayDeltas reverses it along with the run's own
    // partial writes. This is provisional for M2.5: C6 mandates the shared
    // actionId, but whether abort-before-stream should keep or reverse the
    // user's text is explicitly open (07-wiring.md -> Open questions) and
    // owned by Slice 2.7 — only mid-stream cancel is settled as "reverse".
    expect(branchEntries('b1')).toHaveLength(0)
  })
})
