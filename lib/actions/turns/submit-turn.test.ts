import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { storyEntries, type StoryEntry } from '@/lib/db'
import { getPipeline } from '@/lib/pipeline'
import { entriesStore, hydrateAppSettings } from '@/lib/stores'

import { PER_TURN_KIND } from './pipeline'
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

  it('registers a single-phase pill-only hard-gate per-turn pipeline', async () => {
    const { ctx } = await makeHarness()
    entriesStore.hydrate('b1', [])
    await hydrateAppSettings(async () => WORKING_CONFIG)

    await submitTurn({ storyId: 's1', branchId: 'b1' }, { content: 'x', composerMode: 'do' }, ctx)

    const pipeline = getPipeline(PER_TURN_KIND)
    expect(pipeline.kind).toBe(PER_TURN_KIND)
    expect(pipeline.phases).toHaveLength(1)
    expect(pipeline.affordance).toBe('pill-only')
    expect(pipeline.gateBehavior).toBe('hard-gate')
  })

  it('completes a turn: persists the user action and the streamed AI reply', async () => {
    const { ctx } = await makeHarness()
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

  it('fails the turn and writes no ai_reply when the provider stream errors', async () => {
    const { ctx } = await makeHarness()
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
