// TODO(spine): smoke scaffolding — removed when real story-creation + provider
// settings UI land (see docs/followups.md).
import { generateText } from 'ai'

import { getModel, registerStubProvider } from '@/lib/ai'
import { generateId } from '@/lib/ids'
import {
  definePhase,
  definePipeline,
  getPipeline,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { domain } from '@/lib/stores'

export const SMOKE_KIND = 'smoke'
export const SMOKE_STORY_ID = 'story_smoke'
export const SMOKE_BRANCH_ID = 'branch_smoke'

async function* smokePhase(): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const { abortSignal } = domain.getPerTurnContext()
  await generateText({
    model: getModel(registerStubProvider(), 'happy'),
    prompt: 'smoke',
    abortSignal,
  })

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
          content: 'Smoke entry',
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
