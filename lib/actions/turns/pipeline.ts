import { getModel, resolveModel, streamProviderCall } from '@/lib/ai'
import { generateId } from '@/lib/ids'
import {
  definePipeline,
  getPipeline,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { appSettingsStore, entriesStore, generationStore } from '@/lib/stores'

export const PER_TURN_KIND = 'per-turn'

// INTERIM (Slice 2.5): one phase, real provider, streamed reply. No memory /
// classifier piggyback, no per-turn buffer/template — Slice 2.7 swaps this
// phase's internals without touching submitTurn's call site.
async function* narrativePhase(ctx: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  // PhaseContext carries no branchId; the run's own record is the only place it
  // lives at phase time (same lookup shape as orchestrator.ts awaitRunTerminal).
  const run = [...generationStore.getTxState().runs.values()].find(
    (r) => r.actionId === ctx.actionId,
  )
  if (!run) throw new Error('per-turn phase: no matching run in generationStore')
  const { branchId } = run

  const entries = [...entriesStore.getEntries().values()]
    .filter((e) => e.branchId === branchId)
    .sort((a, b) => a.position - b.position)
  const prompt = entries.at(-1)?.content ?? ''

  const cfg = appSettingsStore.getAppSettings()
  const resolved = resolveModel('narrative', {
    providers: cfg.providers,
    profiles: cfg.profiles,
    assignments: cfg.assignments,
    defaultProviderId: cfg.defaultProviderId,
  })
  // Preflight (the phase's `resolves` declaration) halts before this phase on a
  // broken resolver, so a failure here only covers a resolver-time race the
  // preflight snapshot missed — surface it as a phase failure, don't fabricate.
  if (!resolved.ok)
    return {
      status: 'failed',
      error: {
        kind: 'config-resolver',
        failure: resolved.kind,
        target: resolved.target,
        phaseName: 'narrative',
      },
    }

  const entryId = generateId('entry')
  const model = getModel(resolved.providerId, resolved.modelId, ctx.actionId)
  const stream = streamProviderCall({ model, prompt, abortSignal: ctx.abortSignal })
  let content = ''
  for await (const chunk of stream.textStream) {
    content += chunk
    yield { type: 'stream_chunk', targetEntryId: entryId, text: chunk }
  }

  yield {
    type: 'delta_emitted',
    entryId,
    action: {
      kind: 'createStoryEntry',
      source: 'ai_classifier',
      payload: {
        entry: {
          id: entryId,
          branchId,
          position: entries.length + 1,
          kind: 'ai_reply',
          content,
          createdAt: Date.now(),
        },
      },
    },
  }
  return { status: 'completed' }
}

export function ensurePerTurnPipelineRegistered(): void {
  try {
    getPipeline(PER_TURN_KIND)
  } catch {
    definePipeline({
      kind: PER_TURN_KIND,
      phases: [{ name: 'narrative', run: narrativePhase, resolves: [{ target: 'narrative' }] }],
      affordance: 'pill-only',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    })
  }
}
