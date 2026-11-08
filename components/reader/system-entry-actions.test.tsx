// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OwedCloseRun } from '@/lib/actions'
import { describeContextWindow, describeReplyCutOff } from '@/lib/ai'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { entryMetadataSchema, type SystemFailureMeta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  EMPTY_REPLY,
  type PipelineError,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { embedderSwapStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

import type { PassRefusal } from './send-run'
import {
  closeResolvedEntry,
  type CloseResolvedArm,
  describeCloseFailure,
  describePassFailure,
  describeTurnFailure,
  dismissSystemEntry,
  passResolvedEntry,
  retryCloseEntry,
  retryPassEntry,
  toCloseFailureMeta,
  toPassFailureMeta,
  toSystemFailureMeta,
  useConfigFixAction,
  useEmbedderFixAction,
  useProfileFixAction,
  useSystemEntryActions,
} from './system-entry-actions'

const router = vi.hoisted(() => ({
  navigate: vi.fn<(href: string) => void>(),
  push: vi.fn<(href: string) => void>(),
}))

vi.mock('expo-router', () => ({ useRouter: () => router }))

beforeEach(() => {
  embedderSwapStore.__reset()
  router.navigate.mockReset()
  router.push.mockReset()
})

afterEach(cleanup)

const leaveAtOnce = (proceed: () => void) => proceed()

const EMBEDDER_INIT: PipelineError = {
  kind: 'embedder',
  reason: 'init',
  detail: 'no model',
  staleCount: 3,
}

const CUT_FIELDS = {
  cause: 'max-output',
  outputTokens: 4100,
  reasoningTokens: 3900,
  maxOutput: 4096,
  window: null,
  providerId: 'prov_local',
  modelId: 'qwen3-32b',
} as const

// A narrative reply cut before any prose: the turn failed, and Retry resends the held input.
const TURN_CUT = {
  kind: 'reply-cut-off',
  target: 'narrative',
  ...CUT_FIELDS,
} satisfies PipelineError

// A pass reply cut on a server whose profile sets no limit: the server's own default stopped it.
const PASS_CUT = {
  kind: 'reply-cut-off',
  target: 'classifier',
  ...CUT_FIELDS,
  cause: 'unknown',
  reasoningTokens: null,
  maxOutput: null,
} satisfies PipelineError

const EMPTY_REPLY_FILTERED = {
  kind: 'phase-logic',
  subsystem: EMPTY_REPLY,
  detail: 'the model returned no text (finish reason: content-filter)',
} satisfies PipelineError

// A close's metadata call cut at the lore management profile's max output.
const CLOSE_CUT = {
  kind: 'reply-cut-off',
  target: 'lore-mgmt',
  ...CUT_FIELDS,
} satisfies PipelineError

const CLOSE_UNASSIGNED = {
  kind: 'config-resolver',
  failure: 'no-profile-assigned',
  target: 'lore-mgmt',
  phaseName: 'metadata',
} satisfies PipelineError

const CLOSE_HINTED = {
  kind: 'provider',
  reason: 'unknown',
  detail: "400: 'tool_choice' is not supported",
  possibleCapabilityMismatch: { capability: 'toolCalling', matched: 'tool_choice' },
} satisfies PipelineError

const OVERFLOW_MESSAGE =
  'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it'

const CLOSE_OVERFLOW = {
  kind: 'context-window',
  target: 'lore-mgmt',
  detectedBy: 'provider',
  estimate: 71_234,
  window: null,
  windowSource: 'unknown',
  providerId: 'prov_local',
  modelId: 'llama3.1:70b',
  detail: OVERFLOW_MESSAGE,
} satisfies PipelineError

const CLOSE_GENERIC = "Chapter close failed, so your turn didn't start. Retry it, or send again."

describe('describeTurnFailure', () => {
  it('renders embedder-specific copy with the stale row count', () => {
    const out = describeTurnFailure(EMBEDDER_INIT)
    expect(out.content).toBe(t('reader:systemEntry.failure.embed'))
    expect(out.detail).toBe('init: no model (3 rows)')
  })

  // Only a sync-stage failure past the dirty-set load carries a count; config
  // unresolved, dim unknown, a failed load and both query-embed branches all
  // report null. Rendering that absence as a number is the "(null rows)" bug.
  it('drops the magnitude when staleCount is null', () => {
    const out = describeTurnFailure({
      kind: 'embedder',
      reason: 'call',
      detail: 'provider 503',
      staleCount: null,
    })
    expect(out.content).toBe(t('reader:systemEntry.failure.embed'))
    expect(out.detail).toBe('call: provider 503')
  })

  // No path emits zero today (sync.ts short-circuits an empty dirty set to ok),
  // but the field is declared `number | null` — this pins the guard to that
  // contract, so a `staleCount &&` regression can't slip through reading 0 as absent.
  it('renders a zero count rather than treating it as absent', () => {
    const out = describeTurnFailure({
      kind: 'embedder',
      reason: 'call',
      detail: 'drained',
      staleCount: 0,
    })
    expect(out.detail).toBe('call: drained (0 rows)')
  })

  it('still renders provider copy for a provider failure', () => {
    const out = describeTurnFailure({ kind: 'provider', reason: 'auth', detail: '401' })
    expect(out.content).toBe(t('reader:systemEntry.failure.llmCall'))
    expect(out.detail).toBe('auth: 401')
  })

  it('still renders config-resolver copy for a resolver failure', () => {
    const out = describeTurnFailure({
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
      target: 'narrative',
      phaseName: 'narrative',
      detail: 'narrative',
    })
    expect(out.content).toBe(t('reader:systemEntry.failure.noProfileAssigned'))
  })

  it('falls back to the generic message for an unrecognised kind', () => {
    const out = describeTurnFailure({ kind: 'orchestrator', detail: 'blocked by per-turn' })
    expect(out.content).toBe(t('reader:systemEntry.failureMessage'))
  })

  // The app-default chain is healthy in this state; copy naming it sends the user
  // to App Settings to look for a fault that is on the story.
  it('names the story override, not the app default, when the override provider is gone', () => {
    const out = describeTurnFailure({
      kind: 'config-resolver',
      failure: 'override-provider-missing',
      target: 'narrative',
      phaseName: 'narrative',
      detail: 'narrative',
    })
    const key = 'reader:systemEntry.failure.overrideProviderMissing'
    expect(out.content).toBe(t(key))
    // `t` echoes a missing key, which would make the line above pass vacuously.
    expect(hasCopy(key)).toBe(true)
    expect(out.content).not.toBe(t('reader:systemEntry.failure.providerMissing'))
  })

  it('names the limit a reply was cut off at before any story text', () => {
    const out = describeTurnFailure(TURN_CUT)
    expect(out.content).toBe(
      "The reply was cut off at the narrative profile's 4,096-token max output before any story text; reasoning used 3,900 of them. Raise the max output, then Retry.",
    )
    expect(out.detail).toBe(describeReplyCutOff(TURN_CUT))
    expect(out.detail).toContain('max-output')
  })

  // A moderation stop likely repeats on Retry, so the finish reason must reach the entry.
  it('says the model returned no text for an empty reply, keeping the finish reason', () => {
    expect(describeTurnFailure(EMPTY_REPLY_FILTERED)).toEqual({
      content: 'The model returned no text. Nothing was committed; Retry resends your turn.',
      detail: 'the model returned no text (finish reason: content-filter)',
    })
  })

  it('keeps the generic copy for any other phase-logic failure', () => {
    expect(
      describeTurnFailure({
        kind: 'phase-logic',
        subsystem: 'narrative-parse',
        detail: 'bad block',
      }),
    ).toEqual({ content: t('reader:systemEntry.failureMessage'), detail: 'bad block' })
  })
})

describe('toSystemFailureMeta', () => {
  it("persists the embedder kind and the branch's detail line", () => {
    const meta = toSystemFailureMeta(EMBEDDER_INIT, undefined)
    expect(meta).toEqual({ kind: 'embedder', detail: 'init: no model (3 rows)' })
  })

  // SystemFailureMeta.kind is an open z.string(); the round trip is what proves
  // 'embedder' survives a restart without narrowing the schema.
  it('round-trips through the persisted metadata schema', () => {
    const meta = toSystemFailureMeta(EMBEDDER_INIT, {
      content: 'I open the door',
      composerMode: 'do',
    })
    const parsed = entryMetadataSchema.parse({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      systemFailure: meta,
    })
    expect(parsed.systemFailure).toEqual(meta)
  })

  it("persists a cut-off's cause and its diagnostic line", () => {
    const submission = { content: 'I open the door', composerMode: 'do' }
    const meta = toSystemFailureMeta(TURN_CUT, submission)
    expect(meta).toEqual({
      kind: 'reply-cut-off',
      failure: 'max-output',
      detail: describeReplyCutOff(TURN_CUT),
      submission,
    })
    const parsed = entryMetadataSchema.parse({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      systemFailure: meta,
    })
    expect(parsed.systemFailure).toEqual(meta)
  })

  it("persists an empty reply's finish reason as its detail", () => {
    const submission = { content: 'I open the door', composerMode: 'do' }
    expect(toSystemFailureMeta(EMPTY_REPLY_FILTERED, submission)).toEqual({
      kind: 'phase-logic',
      detail: 'the model returned no text (finish reason: content-filter)',
      submission,
    })
  })
})

describe('describePassFailure', () => {
  // The quote shows whether text is kept, so the held copy never mentions it.
  it('names the hold, with no detail line', () => {
    const key = 'reader:systemEntry.failure.memoryHeld'
    expect(hasCopy(key)).toBe(true)
    expect(describePassFailure({ held: true })).toEqual({ content: t(key) })
  })

  it.each([
    ['no-profile-assigned', 'reader:systemEntry.failure.memoryNoProfileAssigned'],
    ['profile-missing', 'reader:systemEntry.failure.memoryProfileMissing'],
    ['provider-missing', 'reader:systemEntry.failure.memoryProviderMissing'],
    ['override-provider-missing', 'reader:systemEntry.failure.memoryOverrideProviderMissing'],
  ] as const)('names the classifier for a %s resolver failure', (failure, key) => {
    const out = describePassFailure({
      held: false,
      error: {
        kind: 'config-resolver',
        failure,
        target: 'classifier',
        phaseName: 'classify',
      },
    })
    expect(hasCopy(key)).toBe(true)
    expect(out).toEqual({ content: t(key) })
  })

  it('gives a provider failure the pass copy with its reason and detail', () => {
    expect(hasCopy('reader:systemEntry.failure.memory')).toBe(true)
    expect(
      describePassFailure({
        held: false,
        error: {
          kind: 'provider',
          reason: 'timeout',
          detail: 'classifier: timeout after 600000ms',
        },
      }),
    ).toEqual({
      content: t('reader:systemEntry.failure.memory'),
      detail: 'timeout: classifier: timeout after 600000ms',
    })
  })

  it('falls back to the reason when a provider failure has no detail', () => {
    expect(
      describePassFailure({ held: false, error: { kind: 'provider', reason: 'network' } }).detail,
    ).toBe('network')
  })

  it('carries any other cause in the detail line', () => {
    expect(
      describePassFailure({ held: false, error: { kind: 'phase-logic', detail: 'window read' } }),
    ).toEqual({ content: t('reader:systemEntry.failure.memory'), detail: 'window read' })
  })

  it('takes a failed pass only with its error (checked by tsc)', () => {
    // @ts-expect-error a failed run always carries its PipelineError
    const loose: PassRefusal = { held: false, error: undefined }
    expect(loose.held).toBe(false)
  })

  // The turn copy names the narrative agent; a pass's failure must not send the user there.
  it('never borrows the turn failure copy', () => {
    const config = {
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
      target: 'classifier',
      phaseName: 'classify',
    } as const
    expect(describePassFailure({ held: false, error: config }).content).not.toBe(
      describeTurnFailure(config).content,
    )
    expect(
      describePassFailure({ held: false, error: { kind: 'provider', reason: 'auth' } }).content,
    ).not.toBe(t('reader:systemEntry.failure.llmCall'))
  })

  it("names the limit a cut pass reply hit, in the pass's own words", () => {
    expect(describePassFailure({ held: false, error: PASS_CUT })).toEqual({
      content:
        "Memory update failed, so your turn didn't start. The server stopped the update's reply at its own limit. Setting a max output on the classifier profile overrides it.",
      detail: describeReplyCutOff(PASS_CUT),
    })
  })
})

describe('toPassFailureMeta', () => {
  const SUBMISSION = { content: 'I wait.', composerMode: 'free' }

  it('marks a held refusal and keeps a carried submission', () => {
    expect(toPassFailureMeta({ held: true }, SUBMISSION)).toEqual({
      kind: 'orchestrator',
      submission: SUBMISSION,
      pass: 'held',
    })
  })

  it("keeps a resolver failure's kind and failure, which pick its fix row", () => {
    expect(
      toPassFailureMeta(
        {
          held: false,
          error: {
            kind: 'config-resolver',
            failure: 'no-profile-assigned',
            target: 'classifier',
            phaseName: 'classify',
          },
        },
        undefined,
      ),
    ).toEqual({ kind: 'config-resolver', failure: 'no-profile-assigned', pass: 'failed' })
  })

  it('persists a provider failure with its detail line, and no submission the composer took', () => {
    expect(
      toPassFailureMeta(
        {
          held: false,
          error: {
            kind: 'provider',
            reason: 'timeout',
            detail: 'classifier: timeout after 600000ms',
          },
        },
        undefined,
      ),
    ).toEqual({
      kind: 'provider',
      detail: 'timeout: classifier: timeout after 600000ms',
      pass: 'failed',
    })
  })

  it('round-trips through the persisted metadata schema, marker included', () => {
    const meta = toPassFailureMeta(
      {
        held: false,
        error: {
          kind: 'config-resolver',
          failure: 'profile-missing',
          target: 'classifier',
          phaseName: 'classify',
        },
      },
      SUBMISSION,
    )
    const parsed = entryMetadataSchema.parse({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      systemFailure: meta,
    })
    expect(parsed.systemFailure).toEqual(meta)
    expect(parsed.systemFailure?.pass).toBe('failed')
  })

  it("persists a cut pass's cause beside the failed marker", () => {
    expect(toPassFailureMeta({ held: false, error: PASS_CUT }, undefined)).toEqual({
      kind: 'reply-cut-off',
      failure: 'unknown',
      detail: describeReplyCutOff(PASS_CUT),
      pass: 'failed',
    })
  })
})

describe('passResolvedEntry', () => {
  const SUBMISSION = { content: 'I wait.', composerMode: 'free' }

  it('keeps the text under the resolved marker, through the persisted schema', () => {
    const { failure } = passResolvedEntry(SUBMISSION)
    const parsed = entryMetadataSchema.parse({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      systemFailure: failure,
    })
    expect(parsed.systemFailure).toEqual({
      kind: 'orchestrator',
      submission: SUBMISSION,
      pass: 'resolved',
    })
  })

  it('says why the text is kept here', () => {
    const key = 'reader:systemEntry.passResolvedTextKept'
    expect(hasCopy(key)).toBe(true)
    expect(passResolvedEntry(SUBMISSION).content).toBe(t(key))
  })
})

// reader-composer.md → Transient pipeline failures: the **Chapter close failed** row.
describe('describeCloseFailure', () => {
  it('gives a provider failure the close copy with its reason and detail', () => {
    expect(hasCopy('reader:systemEntry.failure.close')).toBe(true)
    expect(
      describeCloseFailure({
        kind: 'provider',
        reason: 'network',
        detail: 'lore-mgmt: connect ECONNREFUSED',
      }),
    ).toEqual({ content: CLOSE_GENERIC, detail: 'network: lore-mgmt: connect ECONNREFUSED' })
  })

  it("gives a rejection naming tool calling the close's hedged hint", () => {
    expect(describeCloseFailure(CLOSE_HINTED)).toEqual({
      content:
        "Chapter close failed, so your turn didn't start. The provider rejected the close's request. Its message mentions `tool_choice`. That can mean this model doesn't support tool calling. The provider may also have rejected the request for another reason.",
      detail: "unknown: 400: 'tool_choice' is not supported",
    })
  })

  it('names the lore management agent for a resolver failure, with its detail', () => {
    expect(
      describeCloseFailure({ ...CLOSE_UNASSIGNED, detail: 'lore-mgmt: no assignment' }),
    ).toEqual({
      content: 'Chapter close failed: the lore management agent has no profile assigned.',
      detail: 'lore-mgmt: no assignment',
    })
  })

  it("names the limit a cut close reply hit, in the close's own words", () => {
    expect(describeCloseFailure(CLOSE_CUT)).toEqual({
      content:
        "Chapter close failed, so your turn didn't start. The close's reply was cut off at the lore management profile's 4,096-token max output. Raise it, then Retry.",
      detail: describeReplyCutOff(CLOSE_CUT),
    })
  })

  it("gives a close prompt the provider rejected the close's window copy", () => {
    expect(describeCloseFailure(CLOSE_OVERFLOW)).toEqual({
      content: `Chapter close failed, so your turn didn't start. The provider rejected the close's prompt; its message suggests it exceeded the model's context window: “${OVERFLOW_MESSAGE}”. Our estimate: about 71,300 tokens. Raise the window if the model allows more, or switch the lore management agent to a model with a larger one.`,
      detail: describeContextWindow(CLOSE_OVERFLOW),
    })
  })

  it('carries any other cause in the detail line', () => {
    expect(
      describeCloseFailure({ kind: 'phase-logic', detail: 'chapter-close: no close range' }),
    ).toEqual({ content: CLOSE_GENERIC, detail: 'chapter-close: no close range' })
  })

  // The pass's copy names the classifier; a close's failure must not send the user there.
  it('never borrows the pass copy', () => {
    expect(describeCloseFailure(CLOSE_UNASSIGNED).content).not.toBe(
      describePassFailure({ held: false, error: CLOSE_UNASSIGNED }).content,
    )
    expect(describeCloseFailure({ kind: 'provider', reason: 'auth' }).content).not.toBe(
      t('reader:systemEntry.failure.memory'),
    )
  })
})

describe('toCloseFailureMeta', () => {
  const SUBMISSION = { content: 'I wait.', composerMode: 'free' }

  it("keeps a resolver failure's kind and failure beside the failed marker", () => {
    expect(toCloseFailureMeta(CLOSE_UNASSIGNED, undefined)).toEqual({
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
      close: 'failed',
    })
  })

  it("persists a hinted provider failure's capability and its detail line", () => {
    expect(toCloseFailureMeta(CLOSE_HINTED, undefined)).toEqual({
      kind: 'provider',
      failure: 'toolCalling',
      detail: "unknown: 400: 'tool_choice' is not supported",
      close: 'failed',
    })
  })

  it('round-trips through the persisted metadata schema, submission and marker included', () => {
    const meta = toCloseFailureMeta(CLOSE_CUT, SUBMISSION)
    expect(meta).toEqual({
      kind: 'reply-cut-off',
      failure: 'max-output',
      detail: describeReplyCutOff(CLOSE_CUT),
      submission: SUBMISSION,
      close: 'failed',
    })
    const parsed = entryMetadataSchema.parse({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      systemFailure: meta,
    })
    expect(parsed.systemFailure).toEqual(meta)
  })
})

describe('closeResolvedEntry', () => {
  const SUBMISSION = { content: 'I wait.', composerMode: 'free' }

  it('keeps the text under the resolved close marker, through the persisted schema', () => {
    const { failure } = closeResolvedEntry(SUBMISSION, 'closed')
    const parsed = entryMetadataSchema.parse({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      systemFailure: failure,
    })
    expect(parsed.systemFailure).toEqual({
      kind: 'orchestrator',
      submission: SUBMISSION,
      close: 'resolved',
    })
  })

  it('says the chapter closed, and why the text is kept here', () => {
    expect(hasCopy('reader:systemEntry.closeResolvedTextKept')).toBe(true)
    expect(closeResolvedEntry(SUBMISSION, 'closed').content).toBe(
      "Chapter closed. The composer couldn't take your text back, so it's kept here.",
    )
  })

  it('says nothing is left to close, and why the text is kept here', () => {
    expect(hasCopy('reader:systemEntry.closeNothingOwedTextKept')).toBe(true)
    expect(closeResolvedEntry(SUBMISSION, 'nothing-owed').content).toBe(
      "Nothing left to close. The composer couldn't take your text back, so it's kept here.",
    )
  })

  it.each(['closed', 'nothing-owed'] as const)(
    'marks the %s arm resolved, with no Retry',
    (arm) => {
      expect(closeResolvedEntry(SUBMISSION, arm).failure).toEqual({
        kind: 'orchestrator',
        submission: SUBMISSION,
        close: 'resolved',
      })
    },
  )
})

describe('retryPassEntry', () => {
  const ran = { runId: 'run_pass', actionId: 'act_pass' }

  function harness(result: TxResult | RejectedStart | Error, heldAfter = false) {
    const calls: string[] = []
    const rewrite = vi.fn(async (_refusal: PassRefusal) => {
      calls.push('rewrite')
    })
    const committed = vi.fn(async () => {
      calls.push('committed')
    })
    const notify = vi.fn((_message: string) => {
      calls.push('notify')
    })
    const runPass = vi.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    )
    const held = vi.fn(async () => heldAfter)
    return { calls, rewrite, notify, runPass, deps: { runPass, held, committed, rewrite, notify } }
  }

  it('settles the entry once the pass commits, sending nothing', async () => {
    const h = harness({ ...ran, outcome: 'completed' })
    await retryPassEntry(h.deps)
    expect(h.runPass).toHaveBeenCalledTimes(1)
    expect(h.calls).toEqual(['committed'])
  })

  it('rewrites the entry with the new cause when the pass fails again', async () => {
    const error: PipelineError = {
      kind: 'provider',
      reason: 'network',
      detail: 'classifier: ECONNREFUSED',
    }
    const h = harness({ ...ran, outcome: 'failed', error })
    await retryPassEntry(h.deps)
    expect(h.calls).toEqual(['rewrite'])
    expect(h.rewrite).toHaveBeenCalledWith({ held: false, error })
  })

  // A cancel during the pass's writes, or a failed write, whose reversal didn't commit.
  it('rewrites the entry as held when the failed pass left its branch held', async () => {
    const error: PipelineError = { kind: 'orchestrator', detail: 'reverse-replay failed: locked' }
    const h = harness({ ...ran, outcome: 'failed', error }, true)
    await retryPassEntry(h.deps)
    expect(h.calls).toEqual(['rewrite'])
    expect(h.rewrite).toHaveBeenCalledWith({ held: true })
  })

  it('rewrites the entry as held when the branch is held running', async () => {
    const h = harness({ outcome: 'rejected', blockedBy: CLASSIFIER_HELD })
    await retryPassEntry(h.deps)
    expect(h.calls).toEqual(['rewrite'])
    expect(h.rewrite).toHaveBeenCalledWith({ held: true })
  })

  it('leaves the entry and says to wait when another run refused the pass', async () => {
    const h = harness({ outcome: 'rejected', blockedBy: 'periodic-classifier' })
    await retryPassEntry(h.deps)
    expect(h.calls).toEqual(['notify'])
    expect(h.notify).toHaveBeenCalledWith('Unavailable while generating.')
  })

  it('names no refusal code when the pass could not start for another reason, but logs it', async () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    const h = harness({ outcome: 'rejected', blockedBy: 'branch-not-open' })
    await retryPassEntry(h.deps)
    expect(h.calls).toEqual(['notify'])
    expect(h.notify).toHaveBeenCalledWith("Memory update couldn't start.")
    expect(debug).toHaveBeenCalledWith('reader.pass_retry_rejected', {
      blockedBy: 'branch-not-open',
    })
    debug.mockRestore()
  })

  it('leaves the entry alone when the pass is cancelled', async () => {
    const h = harness({ ...ran, outcome: 'aborted' })
    await retryPassEntry(h.deps)
    expect(h.calls).toEqual([])
  })

  it('rewrites the entry as a failed pass when the pass throws', async () => {
    const h = harness(new Error('marker insert failed'))
    await retryPassEntry(h.deps)
    expect(h.calls).toEqual(['rewrite'])
    expect(h.rewrite).toHaveBeenCalledWith({
      held: false,
      error: { kind: 'orchestrator', detail: 'marker insert failed' },
    })
  })

  // The pass committed, so its failure copy would be wrong: the throw goes to the caller.
  it('lets a throw from the settle through without rewriting the entry', async () => {
    const h = harness({ ...ran, outcome: 'completed' })
    const committed = vi.fn(() => Promise.reject(new Error('reload failed')))
    await expect(retryPassEntry({ ...h.deps, committed })).rejects.toThrow('reload failed')
    expect(h.rewrite).not.toHaveBeenCalled()
  })
})

describe('retryCloseEntry', () => {
  const closeRan = { runId: 'run_close', actionId: 'act_close' }
  const passRan = { runId: 'run_pass', actionId: 'act_pass' }

  const ended = (kind: string, result: TxResult, cancelled = false): OwedCloseRun => ({
    outcome: 'ran',
    end: result.outcome === 'completed' ? { kind, result, cancelled } : { kind, result },
  })

  function harness(run: OwedCloseRun | Error, heldAfter = false) {
    const calls: string[] = []
    const rewriteClose = vi.fn(async (_error: PipelineError) => {
      calls.push('rewriteClose')
    })
    const rewritePass = vi.fn(async (_refusal: PassRefusal) => {
      calls.push('rewritePass')
    })
    const committed = vi.fn(async (_arm: CloseResolvedArm) => {
      calls.push('committed')
    })
    const notify = vi.fn((_message: string) => {
      calls.push('notify')
    })
    const runClose = vi.fn(() =>
      run instanceof Error ? Promise.reject(run) : Promise.resolve(run),
    )
    const held = vi.fn(async () => heldAfter)
    return {
      calls,
      rewriteClose,
      rewritePass,
      notify,
      runClose,
      held,
      committed,
      deps: { runClose, held, committed, rewriteClose, rewritePass, notify },
    }
  }

  it('settles the entry once the close commits', async () => {
    const h = harness(ended(CHAPTER_CLOSE_KIND, { ...closeRan, outcome: 'completed' }))
    await retryCloseEntry(h.deps)
    expect(h.runClose).toHaveBeenCalledTimes(1)
    expect(h.calls).toEqual(['committed'])
    expect(h.committed).toHaveBeenCalledWith('closed')
  })

  // The close committed before the Cancel landed, so its chapter stands.
  it('settles the entry when a late Cancel found the close committed', async () => {
    const h = harness(ended(CHAPTER_CLOSE_KIND, { ...closeRan, outcome: 'completed' }, true))
    await retryCloseEntry(h.deps)
    expect(h.calls).toEqual(['committed'])
    expect(h.committed).toHaveBeenCalledWith('closed')
  })

  it('settles the entry when no close is owed any more', async () => {
    const h = harness({ outcome: 'nothing-owed' })
    await retryCloseEntry(h.deps)
    expect(h.calls).toEqual(['committed'])
    expect(h.committed).toHaveBeenCalledWith('nothing-owed')
  })

  it("rewrites the close entry with the close's new cause", async () => {
    const error: PipelineError = {
      kind: 'provider',
      reason: 'network',
      detail: 'lore-mgmt: ECONNREFUSED',
    }
    const h = harness(ended(CHAPTER_CLOSE_KIND, { ...closeRan, outcome: 'failed', error }))
    await retryCloseEntry(h.deps)
    expect(h.calls).toEqual(['rewriteClose'])
    expect(h.rewriteClose).toHaveBeenCalledWith(error)
    expect(h.held).not.toHaveBeenCalled()
  })

  // The failed pass is what runs next (chapter-close.md → Failure modes), so the entry names it.
  it('rewrites a failed catch-up pass as a memory entry', async () => {
    const error: PipelineError = { kind: 'phase-logic', detail: 'window read' }
    const h = harness(ended(PERIODIC_CLASSIFIER_KIND, { ...passRan, outcome: 'failed', error }))
    await retryCloseEntry(h.deps)
    expect(h.calls).toEqual(['rewritePass'])
    expect(h.rewritePass).toHaveBeenCalledWith({ held: false, error })
  })

  it('rewrites a failed catch-up pass as held when it left its branch held', async () => {
    const error: PipelineError = { kind: 'orchestrator', detail: 'reverse-replay failed: locked' }
    const h = harness(
      ended(PERIODIC_CLASSIFIER_KIND, { ...passRan, outcome: 'failed', error }),
      true,
    )
    await retryCloseEntry(h.deps)
    expect(h.calls).toEqual(['rewritePass'])
    expect(h.rewritePass).toHaveBeenCalledWith({ held: true })
  })

  it.each([
    ['the close', CHAPTER_CLOSE_KIND, closeRan],
    ['a catch-up pass', PERIODIC_CLASSIFIER_KIND, passRan],
  ] as const)('leaves the entry alone when %s is cancelled', async (_label, kind, ran) => {
    const h = harness(ended(kind, { ...ran, outcome: 'aborted' }))
    await retryCloseEntry(h.deps)
    expect(h.calls).toEqual([])
  })

  // The pass committed and chained nothing, so the close never ran: a Cancel after its last phase,
  // or an open story that left the branch.
  it.each([
    ['a late Cancel', true],
    ['the story left the branch', false],
  ] as const)(
    'leaves the entry when the chain ended on a committed pass after %s',
    async (_label, cancelled) => {
      const h = harness(
        ended(PERIODIC_CLASSIFIER_KIND, { ...passRan, outcome: 'completed' }, cancelled),
      )
      await retryCloseEntry(h.deps)
      expect(h.calls).toEqual([])
    },
  )

  it('rewrites the entry as a held memory entry when the branch is held running', async () => {
    const h = harness({ outcome: 'rejected', blockedBy: CLASSIFIER_HELD })
    await retryCloseEntry(h.deps)
    expect(h.calls).toEqual(['rewritePass'])
    expect(h.rewritePass).toHaveBeenCalledWith({ held: true })
  })

  it.each([['story-busy'], ['per-turn'], ['chapter-close']])(
    'leaves the entry and says to wait when %s refused the close',
    async (blockedBy) => {
      const h = harness({ outcome: 'rejected', blockedBy })
      await retryCloseEntry(h.deps)
      expect(h.calls).toEqual(['notify'])
      expect(h.notify).toHaveBeenCalledWith('Unavailable while generating.')
    },
  )

  it('says to wait for the embedder switch when a pending swap refused the close', async () => {
    const h = harness({ outcome: 'rejected', blockedBy: 'embedder-swap' })
    await retryCloseEntry(h.deps)
    expect(h.calls).toEqual(['notify'])
    expect(h.notify).toHaveBeenCalledWith('Unavailable while the embedder switch finishes.')
  })

  it.each([['branch-not-open'], ['reversal']])(
    'names no refusal code, nor generation, when %s refused the close, but logs it',
    async (blockedBy) => {
      const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
      const h = harness({ outcome: 'rejected', blockedBy })
      await retryCloseEntry(h.deps)
      expect(h.calls).toEqual(['notify'])
      expect(h.notify).toHaveBeenCalledWith("Chapter close can't start yet.")
      expect(debug).toHaveBeenCalledWith('reader.close_retry_rejected', { blockedBy })
      debug.mockRestore()
    },
  )

  it('rewrites the close entry when the run throws', async () => {
    const h = harness(new Error('marker insert failed'))
    await retryCloseEntry(h.deps)
    expect(h.calls).toEqual(['rewriteClose'])
    expect(h.rewriteClose).toHaveBeenCalledWith({
      kind: 'orchestrator',
      detail: 'marker insert failed',
    })
  })

  // The close committed, so its failure copy would be wrong: the throw goes to the caller.
  it('lets a throw from the settle through without rewriting the entry', async () => {
    const h = harness(ended(CHAPTER_CLOSE_KIND, { ...closeRan, outcome: 'completed' }))
    const committed = vi.fn(() => Promise.reject(new Error('reload failed')))
    await expect(retryCloseEntry({ ...h.deps, committed })).rejects.toThrow('reload failed')
    expect(h.rewriteClose).not.toHaveBeenCalled()
    expect(h.rewritePass).not.toHaveBeenCalled()
  })
})

describe('dismissSystemEntry', () => {
  const SUBMISSION: SystemFailureMeta['submission'] = {
    content: 'the unsent turn',
    composerMode: 'free',
  }

  function harness(
    over: {
      beginDispatch?: () => boolean
      clear?: () => Promise<void>
      stillOnBranch?: () => boolean
    } = {},
  ) {
    const order: string[] = []
    const endDispatch = vi.fn(() => {
      order.push('endDispatch')
    })
    const handBack = vi.fn<(s: SystemFailureMeta['submission']) => void>(() => {
      order.push('handBack')
    })
    return {
      order,
      handBack,
      endDispatch,
      deps: {
        branchId: 'branch_a',
        submission: SUBMISSION,
        beginDispatch: over.beginDispatch ?? ((): boolean => true),
        endDispatch,
        clear:
          over.clear ??
          ((): Promise<void> => {
            order.push('clear')
            return Promise.resolve()
          }),
        stillOnBranch: over.stillOnBranch ?? ((): boolean => true),
        handBack,
      },
    }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the draft only once the entry holding it is gone', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const h = harness()

    await dismissSystemEntry(h.deps)

    expect(h.order).toEqual(['clear', 'handBack', 'endDispatch'])
    expect(h.handBack).toHaveBeenCalledWith(SUBMISSION)
    expect(warn).not.toHaveBeenCalled()
  })

  // Gated as a dispatch: a Retry or Send under the delete would run beside the hand-back.
  it('does nothing while another dispatch holds the gate', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const h = harness({ beginDispatch: () => false })

    await dismissSystemEntry(h.deps)

    expect(h.order).toEqual([])
    expect(warn).toHaveBeenCalledWith('reader.system_entry_dismiss_suppressed', {
      branchId: 'branch_a',
    })
  })

  // The notice and its Retry survive a rejected clear, so a copy in the composer
  // beside them is the same turn queued to send twice.
  it('leaves the draft with the entry when the clear rejects, and says so', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const toasted = vi.spyOn(toast, 'error').mockReturnValue('')
    const h = harness({
      clear: () => {
        h.order.push('clear')
        return Promise.reject(new Error('db gone'))
      },
    })

    await expect(dismissSystemEntry(h.deps)).resolves.toBeUndefined()

    expect(h.handBack).not.toHaveBeenCalled()
    expect(h.order).toEqual(['clear', 'endDispatch'])
    expect(toasted).toHaveBeenCalledExactlyOnceWith(t('reader:systemEntry.dismissFailed'))
    expect(logged).toHaveBeenCalledWith('reader.system_entry_dismiss_failed', {
      branchId: 'branch_a',
      error: 'db gone',
    })
  })

  it('toasts nothing when the dismiss lands', async () => {
    const toasted = vi.spyOn(toast, 'error').mockReturnValue('')

    await dismissSystemEntry(harness().deps)

    expect(toasted).not.toHaveBeenCalled()
  })

  // One composer serves every branch, so the text can't follow the user; the log records the loss.
  it('drops the hand-back with a warning when the branch changed under the awaits', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const h = harness({ stillOnBranch: () => false })

    await dismissSystemEntry(h.deps)

    expect(h.handBack).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('reader.handback_skipped_left_branch', {
      branchId: 'branch_a',
      source: 'dismiss',
    })
  })

  it('warns of nothing off-branch when the entry held no text', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const h = harness({ stillOnBranch: () => false })

    await dismissSystemEntry({ ...h.deps, submission: undefined })

    expect(warn).not.toHaveBeenCalled()
  })

  it('warns of nothing off-branch when the entry held blank text', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const h = harness({ stillOnBranch: () => false })

    await dismissSystemEntry({ ...h.deps, submission: { content: ' \n ', composerMode: 'free' } })

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('useEmbedderFixAction', () => {
  it('routes to the Memory panel and opens the swap dialog', () => {
    const { result } = renderHook(() => useEmbedderFixAction('story_1'))
    expect(result.current?.label).toBe(t('reader:systemEntry.switchEmbedder'))

    act(() => result.current?.onPress())

    expect(router.navigate).toHaveBeenCalledWith('/story-settings/story_1?tab=memory')
    expect(embedderSwapStore.getState().dialog).toEqual({ storyId: 'story_1' })
  })

  it('drops the action when no story is resolved', () => {
    const { result } = renderHook(() => useEmbedderFixAction(null))
    expect(result.current).toBeUndefined()
  })
})

describe('useConfigFixAction', () => {
  it("sends a broken override to that story's Models tab, where the row can be cleared", () => {
    const { result } = renderHook(() =>
      useConfigFixAction('override-provider-missing', 'story_1', leaveAtOnce),
    )
    expect(result.current?.label).toBe(t('reader:systemEntry.fixOverride'))

    act(() => result.current?.onPress())

    expect(router.navigate).toHaveBeenCalledWith('/story-settings/story_1?tab=models')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('still sends an app-chain provider failure to App Settings', () => {
    const { result } = renderHook(() =>
      useConfigFixAction('provider-missing', 'story_1', leaveAtOnce),
    )
    expect(result.current?.label).toBe(t('reader:systemEntry.fixDefault'))

    act(() => result.current?.onPress())

    expect(router.push).toHaveBeenCalledWith('/settings?tab=providers')
    expect(router.navigate).not.toHaveBeenCalled()
  })

  it('drops the override action when no story is resolved', () => {
    const { result } = renderHook(() =>
      useConfigFixAction('override-provider-missing', null, leaveAtOnce),
    )
    expect(result.current).toBeUndefined()
  })

  // The bubble reads a persisted open string, so a kind written by a newer build
  // must keep an affordance rather than lose one.
  it('lands an unrecognised persisted failure on the generic default fix', () => {
    const { result } = renderHook(() =>
      useConfigFixAction('from-a-newer-build', 'story_1', leaveAtOnce),
    )
    expect(result.current?.label).toBe(t('reader:systemEntry.fixDefault'))
  })

  // App Settings is outside the story, so the push waits on the story-leave guard.
  it('routes the App Settings fix through the story-leave guard', () => {
    const held: (() => void)[] = []
    const leaveStory = vi.fn((proceed: () => void) => {
      held.push(proceed)
    })
    const { result } = renderHook(() =>
      useConfigFixAction('provider-missing', 'story_1', leaveStory),
    )

    act(() => result.current?.onPress())
    expect(leaveStory).toHaveBeenCalledTimes(1)
    expect(router.push).not.toHaveBeenCalled()

    act(() => held.forEach((proceed) => proceed()))
    expect(router.push).toHaveBeenCalledWith('/settings?tab=providers')
  })

  it('keeps the in-story override fix off the story-leave guard', () => {
    const leaveStory = vi.fn()
    const { result } = renderHook(() =>
      useConfigFixAction('override-provider-missing', 'story_1', leaveStory),
    )
    act(() => result.current?.onPress())
    expect(router.navigate).toHaveBeenCalledWith('/story-settings/story_1?tab=models')
    expect(leaveStory).not.toHaveBeenCalled()
  })
})

describe('useProfileFixAction', () => {
  it('offers nothing when disabled', () => {
    const { result } = renderHook(() => useProfileFixAction(false, leaveAtOnce))
    expect(result.current).toBeUndefined()
  })

  it('sends the user to App Settings through the story-leave guard', () => {
    const held: (() => void)[] = []
    const leaveStory = vi.fn((proceed: () => void) => {
      held.push(proceed)
    })
    const { result } = renderHook(() => useProfileFixAction(true, leaveStory))
    expect(result.current?.label).toBe('Fix profile')

    act(() => result.current?.onPress())
    expect(leaveStory).toHaveBeenCalledTimes(1)
    expect(router.push).not.toHaveBeenCalled()

    act(() => held.forEach((proceed) => proceed()))
    expect(router.push).toHaveBeenCalledWith('/settings?tab=providers')
  })

  // Every reader row takes this action: a fresh identity per render re-renders them all per chunk.
  it('keeps its identity across renders with unchanged inputs', () => {
    const { result, rerender } = renderHook(() => useProfileFixAction(true, leaveAtOnce))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('follows a new story-leave guard', () => {
    const firstGuard = vi.fn()
    const secondGuard = vi.fn()
    const { result, rerender } = renderHook(
      ({ guard }: { guard: (proceed: () => void) => void }) => useProfileFixAction(true, guard),
      { initialProps: { guard: firstGuard } },
    )
    rerender({ guard: secondGuard })
    act(() => result.current?.onPress())
    expect(secondGuard).toHaveBeenCalledTimes(1)
    expect(firstGuard).not.toHaveBeenCalled()
  })
})

describe('useSystemEntryActions', () => {
  const onRetry = () => {}

  function actionsFor(failure: SystemFailureMeta | undefined, storyId: string | null = 'story_1') {
    return renderHook(() => useSystemEntryActions(failure, onRetry, storyId, leaveAtOnce)).result
      .current
  }

  it('offers Switch embedder for an embedder failure', () => {
    expect(actionsFor({ kind: 'embedder' }).fixAction?.label).toBe(
      t('reader:systemEntry.switchEmbedder'),
    )
  })

  it('still offers the config fix for a resolver failure', () => {
    expect(
      actionsFor({ kind: 'config-resolver', failure: 'profile-missing' }).fixAction?.label,
    ).toBe(t('reader:systemEntry.fixProfile'))
  })

  it('offers no fix action for a provider failure', () => {
    expect(actionsFor({ kind: 'provider' }).fixAction).toBeUndefined()
  })

  // A held branch can't run a pass: its entry offers Dismiss alone.
  it('offers no Retry on a held pass entry', () => {
    expect(actionsFor({ kind: 'orchestrator', pass: 'held' }).onRetry).toBeUndefined()
  })

  // Its pass has run; the entry only holds a text the composer couldn't take back.
  it('offers Dismiss alone on a resolved pass entry', () => {
    const actions = actionsFor(
      passResolvedEntry({ content: 'I wade in.', composerMode: 'free' }).failure,
    )
    expect(actions.onRetry).toBeUndefined()
    expect(actions.fixAction).toBeUndefined()
  })

  it('keeps Retry on a failed pass entry and on a turn failure', () => {
    expect(actionsFor({ kind: 'provider', pass: 'failed' }).onRetry).toBe(onRetry)
    expect(actionsFor({ kind: 'provider' }).onRetry).toBe(onRetry)
  })

  it("keeps a failed pass's config fix beside its Retry", () => {
    const actions = actionsFor({
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
      pass: 'failed',
    })
    expect(actions.fixAction?.label).toBe(t('reader:systemEntry.assignProfile'))
    expect(actions.onRetry).toBe(onRetry)
  })

  // A fix precedes Retry on every row (reader-composer.md → Transient pipeline failures).
  it("keeps a failed close's config fix beside its Retry", () => {
    const actions = actionsFor(toCloseFailureMeta(CLOSE_UNASSIGNED, undefined))
    expect(actions.fixAction?.label).toBe('Assign profile')
    expect(actions.onRetry).toBe(onRetry)
  })

  // Retry left nothing owed; the entry only holds a text the composer couldn't take back.
  it('offers Dismiss alone on a resolved close entry', () => {
    const actions = actionsFor(
      closeResolvedEntry({ content: 'I wade in.', composerMode: 'free' }, 'nothing-owed').failure,
    )
    expect(actions.onRetry).toBeUndefined()
    expect(actions.fixAction).toBeUndefined()
  })

  it('keeps Retry on a failed close entry', () => {
    expect(
      actionsFor(toCloseFailureMeta({ kind: 'provider', reason: 'network' }, undefined)).onRetry,
    ).toBe(onRetry)
  })

  it("keeps a cut close's Fix profile beside its Retry", () => {
    const actions = actionsFor(toCloseFailureMeta(CLOSE_CUT, undefined))
    expect(actions.fixAction?.label).toBe('Fix profile')
    expect(actions.onRetry).toBe(onRetry)
  })

  it('offers Fix profile beside Retry on a close entry whose rejection hinted at tool calling', () => {
    const actions = actionsFor(toCloseFailureMeta(CLOSE_HINTED, undefined))
    expect(actions.fixAction?.label).toBe('Fix profile')
    expect(actions.onRetry).toBe(onRetry)
  })

  // `Set window` is the window's remedy, hidden until App Settings has its editor (M7.1).
  it('offers Retry and no fix action on a close window entry', () => {
    const actions = actionsFor(toCloseFailureMeta(CLOSE_OVERFLOW, undefined))
    expect(actions.fixAction).toBeUndefined()
    expect(actions.onRetry).toBe(onRetry)
  })

  it('offers no fix action for an embedder failure with no story resolved', () => {
    expect(actionsFor({ kind: 'embedder' }, null).fixAction).toBeUndefined()
  })

  it('threads the story through so an override failure can offer its own fix', () => {
    expect(
      actionsFor({ kind: 'config-resolver', failure: 'override-provider-missing' }).fixAction
        ?.label,
    ).toBe(t('reader:systemEntry.fixOverride'))
    expect(
      actionsFor({ kind: 'config-resolver', failure: 'override-provider-missing' }, null).fixAction,
    ).toBeUndefined()
  })

  it('threads the story-leave guard to the config fix', () => {
    const leaveStory = vi.fn()
    const { result } = renderHook(() =>
      useSystemEntryActions(
        { kind: 'config-resolver', failure: 'profile-missing' },
        onRetry,
        'story_1',
        leaveStory,
      ),
    )
    act(() => result.current.fixAction?.onPress())
    expect(leaveStory).toHaveBeenCalledTimes(1)
    expect(router.push).not.toHaveBeenCalled()
  })

  it.each(['max-output', 'unknown'])(
    'offers Fix profile beside Retry for a cut-off with cause %s',
    (cause) => {
      const actions = actionsFor({ kind: 'reply-cut-off', failure: cause })
      expect(actions.fixAction?.label).toBe('Fix profile')
      expect(actions.onRetry).toBe(onRetry)
    },
  )

  // The window's remedy is `Set window`, not the profile.
  it('offers no fix action for a cut-off at the window', () => {
    const actions = actionsFor({ kind: 'reply-cut-off', failure: 'window' })
    expect(actions.fixAction).toBeUndefined()
    expect(actions.onRetry).toBe(onRetry)
  })

  it("keeps a cut pass's Fix profile beside its Retry", () => {
    const actions = actionsFor({ kind: 'reply-cut-off', failure: 'max-output', pass: 'failed' })
    expect(actions.fixAction?.label).toBe('Fix profile')
    expect(actions.onRetry).toBe(onRetry)
  })

  it("routes a cut-off's Fix profile through the story-leave guard to App Settings", () => {
    const leaveStory = vi.fn((proceed: () => void) => proceed())
    const { result } = renderHook(() =>
      useSystemEntryActions(
        { kind: 'reply-cut-off', failure: 'unknown' },
        onRetry,
        'story_1',
        leaveStory,
      ),
    )
    act(() => result.current.fixAction?.onPress())
    expect(leaveStory).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/settings?tab=providers')
  })
})

// reader-composer.md → Transient pipeline failures.
describe('window and capability-hint entries', () => {
  const onRetry = () => {}
  const SUBMISSION = { content: 'I open the door', composerMode: 'do' }
  const LLAMACPP_MESSAGE =
    'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it'

  const TURN_WINDOW = {
    kind: 'context-window',
    target: 'narrative',
    detectedBy: 'check',
    estimate: 71_234,
    window: 65_536,
    windowSource: 'configured',
    providerId: 'prov_local',
    modelId: 'llama3.1:70b',
  } satisfies PipelineError

  const PASS_OVERFLOW = {
    kind: 'context-window',
    target: 'classifier',
    detectedBy: 'provider',
    estimate: 71_234,
    window: null,
    windowSource: 'unknown',
    providerId: 'prov_local',
    modelId: 'llama3.1:70b',
    detail: LLAMACPP_MESSAGE,
  } satisfies PipelineError

  const TURN_HINTED = {
    kind: 'provider',
    reason: 'network',
    detail: "400: 'thinking' is not supported for this model",
    possibleCapabilityMismatch: { capability: 'reasoning', matched: 'thinking' },
  } satisfies PipelineError

  const PASS_HINTED = {
    kind: 'provider',
    reason: 'unknown',
    detail: 'Bad Request: json_schema is not supported',
    possibleCapabilityMismatch: { capability: 'structuredOutput', matched: 'json_schema' },
  } satisfies PipelineError

  const TURN_WINDOW_COPY =
    "This prompt is about 71,300 tokens; llama3.1:70b's context window is 65,536 (set by you). Nothing was sent. Shorten the prompt in Story Settings (memory budgets, history buffer), raise the window if the model allows more, or switch to a model with a larger one."
  const PASS_OVERFLOW_COPY = `Memory update failed, so your turn didn't start. The provider rejected the update's prompt; its message suggests it exceeded the model's context window: “${LLAMACPP_MESSAGE}”. Our estimate: about 71,300 tokens. Raise the window if the model allows more, or switch the classifier to a model with a larger one.`
  const TURN_REASONING_HINT =
    "The provider rejected the request. Its message mentions `thinking`. That can mean this model doesn't support reasoning: check the profile's thinking setting and the model's 🧠 badge. The provider may also have rejected the request for another reason."
  const PASS_STRUCTURED_HINT =
    "Memory update failed, so your turn didn't start. The provider rejected the update's request. Its message mentions `json_schema`. That can mean this model doesn't support structured output: check the profile's structured-output setting and the model's badge. The provider may also have rejected the request for another reason."

  function actionsFor(failure: SystemFailureMeta) {
    return renderHook(() => useSystemEntryActions(failure, onRetry, 'story_1', leaveAtOnce)).result
      .current
  }

  describe('describeTurnFailure', () => {
    it("gives a refused prompt the window copy and keeps the window's diagnostic line", () => {
      expect(describeTurnFailure(TURN_WINDOW)).toEqual({
        content: TURN_WINDOW_COPY,
        detail: describeContextWindow(TURN_WINDOW),
      })
    })

    it('gives a rejection naming a capability the hedged hint, keeping its reason and detail', () => {
      expect(describeTurnFailure(TURN_HINTED)).toEqual({
        content: TURN_REASONING_HINT,
        detail: "network: 400: 'thinking' is not supported for this model",
      })
    })
  })

  describe('describePassFailure', () => {
    it("gives a pass prompt the provider rejected the pass's window copy", () => {
      expect(describePassFailure({ held: false, error: PASS_OVERFLOW })).toEqual({
        content: PASS_OVERFLOW_COPY,
        detail: describeContextWindow(PASS_OVERFLOW),
      })
    })

    it("gives a pass rejection naming a capability the pass's hedged hint", () => {
      expect(describePassFailure({ held: false, error: PASS_HINTED })).toEqual({
        content: PASS_STRUCTURED_HINT,
        detail: 'unknown: Bad Request: json_schema is not supported',
      })
    })
  })

  describe('the persisted fix tag', () => {
    it('stores how a window failure was detected, its diagnostic line and the held text', () => {
      const meta = toSystemFailureMeta(TURN_WINDOW, SUBMISSION)
      expect(meta).toEqual({
        kind: 'context-window',
        failure: 'check',
        detail: describeContextWindow(TURN_WINDOW),
        submission: SUBMISSION,
      })
      const parsed = entryMetadataSchema.parse({
        sceneEntities: [],
        currentLocationId: null,
        worldTime: 0,
        systemFailure: meta,
      })
      expect(parsed.systemFailure).toEqual(meta)
    })

    it("stores a pass overflow's detection beside the failed marker", () => {
      expect(toPassFailureMeta({ held: false, error: PASS_OVERFLOW }, undefined)).toEqual({
        kind: 'context-window',
        failure: 'provider',
        detail: describeContextWindow(PASS_OVERFLOW),
        pass: 'failed',
      })
    })

    it("stores a provider hint's capability", () => {
      expect(toSystemFailureMeta(TURN_HINTED, undefined)).toEqual({
        kind: 'provider',
        failure: 'reasoning',
        detail: "network: 400: 'thinking' is not supported for this model",
      })
      expect(toPassFailureMeta({ held: false, error: PASS_HINTED }, undefined)).toEqual({
        kind: 'provider',
        failure: 'structuredOutput',
        detail: 'unknown: Bad Request: json_schema is not supported',
        pass: 'failed',
      })
    })

    it('stores no tag for a provider failure without a hint', () => {
      expect(
        toSystemFailureMeta({ kind: 'provider', reason: 'auth', detail: '401' }, undefined),
      ).toEqual({ kind: 'provider', detail: 'auth: 401' })
    })
  })

  describe('useSystemEntryActions', () => {
    // Fed through the meta builders, so the tag written and the tag read must agree.
    it('offers Fix profile beside Retry on a turn entry whose rejection hinted at a capability', () => {
      const actions = actionsFor(toSystemFailureMeta(TURN_HINTED, SUBMISSION))
      expect(actions.fixAction?.label).toBe('Fix profile')
      expect(actions.onRetry).toBe(onRetry)
    })

    it('offers Fix profile beside Retry on a failed pass entry whose rejection hinted at a capability', () => {
      const actions = actionsFor(toPassFailureMeta({ held: false, error: PASS_HINTED }, undefined))
      expect(actions.fixAction?.label).toBe('Fix profile')
      expect(actions.onRetry).toBe(onRetry)
    })

    it("routes a hint's Fix profile through the story-leave guard to App Settings", () => {
      const leaveStory = vi.fn((proceed: () => void) => proceed())
      const { result } = renderHook(() =>
        useSystemEntryActions(
          toSystemFailureMeta(TURN_HINTED, undefined),
          onRetry,
          'story_1',
          leaveStory,
        ),
      )
      act(() => result.current.fixAction?.onPress())
      expect(leaveStory).toHaveBeenCalledTimes(1)
      expect(router.push).toHaveBeenCalledWith('/settings?tab=providers')
    })

    // `Set window` is the window's remedy, hidden until App Settings has its editor.
    it('offers Retry and no fix action on a window entry, turn or pass', () => {
      const turn = actionsFor(toSystemFailureMeta(TURN_WINDOW, SUBMISSION))
      expect(turn.fixAction).toBeUndefined()
      expect(turn.onRetry).toBe(onRetry)
      const pass = actionsFor(toPassFailureMeta({ held: false, error: PASS_OVERFLOW }, undefined))
      expect(pass.fixAction).toBeUndefined()
      expect(pass.onRetry).toBe(onRetry)
    })

    it('offers no fix action for a provider entry whose tag is no capability', () => {
      expect(
        actionsFor({ kind: 'provider', failure: 'from-a-newer-build' }).fixAction,
      ).toBeUndefined()
    })
  })
})
