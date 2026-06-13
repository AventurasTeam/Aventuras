// TODO(spine): smoke scaffolding — removed when real story-creation + provider
// settings UI land (see docs/followups.md).
import { generateText } from 'ai'

import { getModel, registerStubProvider, resolveModel, streamProviderCall } from '@/lib/ai'
import { generateId } from '@/lib/ids'
import {
  definePhase,
  definePipeline,
  getPipeline,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { appSettingsStore } from '@/lib/stores'

export const SMOKE_KIND = 'smoke'
export const SMOKE_STORY_ID = 'story_smoke'
export const SMOKE_BRANCH_ID = 'branch_smoke'

const SMOKE_PROMPT = 'Reply with a short, friendly one-sentence greeting.'

// When a narrative model is quick-wired, make a real streamed call against the
// user's endpoint (the only real-generation path until Slice 2.7) and surface
// the reply; otherwise fall back to the dev stub so the smoke still runs with
// nothing configured.
async function generateSmokeReply(ctx: PhaseContext): Promise<string> {
  const cfg = appSettingsStore.getAppSettings()
  const resolved = resolveModel('narrative', {
    providers: cfg.providers,
    profiles: cfg.profiles,
    assignments: cfg.assignments,
    defaultProviderId: cfg.defaultProviderId,
  })
  if (resolved.ok) {
    const model = getModel(resolved.providerId, resolved.modelId, ctx.actionId)
    const reply = await streamProviderCall({
      model,
      prompt: SMOKE_PROMPT,
      abortSignal: ctx.abortSignal,
    }).text
    return reply.length > 0 ? reply : 'Smoke entry'
  }
  await generateText({
    model: getModel(registerStubProvider(), 'happy', ctx.actionId),
    prompt: 'smoke',
    abortSignal: ctx.abortSignal,
  })
  return 'Smoke entry'
}

async function* smokePhase(ctx: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const content = await generateSmokeReply(ctx)

  // Benign warning so the run lands a logger.warn in diagnosticsStore: the happy
  // path otherwise only logs at debug, which the gate drops unless debug-level is on.
  yield { type: 'recoverable_error', error: { kind: 'phase-logic', detail: 'smoke marker' } }

  const entryId = generateId('entry')
  yield {
    type: 'delta_emitted',
    entryId,
    action: {
      kind: 'createStoryEntry',
      source: 'ai_classifier',
      payload: {
        entry: {
          id: entryId,
          branchId: SMOKE_BRANCH_ID,
          position: 0,
          kind: 'ai_reply',
          content,
          createdAt: Date.now(),
        },
      },
    },
  }
  return { status: 'completed' }
}

// Guard via getPipeline (not a module flag): the test resets the registry between
// cases, so a flag would leave us thinking it's registered when it isn't.
export function ensureSmokePipelineRegistered(): void {
  try {
    getPipeline(SMOKE_KIND)
  } catch {
    definePipeline({
      kind: SMOKE_KIND,
      phases: [definePhase('smoke', smokePhase)],
      affordance: 'invisible',
      gateBehavior: 'no-gate',
      concurrencyPolicy: {},
    })
  }
}
