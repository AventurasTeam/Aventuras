import { and, asc, between, eq, inArray, ne } from 'drizzle-orm'

import { boundedSignal } from '@/lib/abort'
import {
  callTimeoutMs,
  generateStructured,
  type ResolveModelConfig,
  type ResolveTarget,
} from '@/lib/ai'
import { storyEntries, type DbCtx, type StoryMode, type Thread } from '@/lib/db'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, chaptersStore, currentStoryStore, threadsStore } from '@/lib/stores'

import { buildChapterContext, type CloseRangeEntry } from './chapter-context'
import {
  chapterMetadataSchema,
  normalizeChapterMetadata,
  type NormalizedChapterMetadata,
} from './chapter-metadata-schema'
import { CLOSE_PHASE, type CloseRange } from './intermediates'
import { storesHoldBranch } from './stores-hold-branch'
import { retriedAttemptEvents, structuredCallFailure } from '../call-error'
import type { PhaseContext, PhaseEmittedEvent, PhaseFailure, PipelineError } from '../types'

const TARGET = 'lore-mgmt' satisfies ResolveTarget

/** The range's whole non-system rows, start entry through end, oldest first, stamped or not. */
export async function readCloseRangeEntries(
  db: DbCtx['db'],
  branchId: string,
  range: CloseRange,
): Promise<readonly CloseRangeEntry[]> {
  const bounds = await db
    .select({ id: storyEntries.id, position: storyEntries.position })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        inArray(storyEntries.id, [range.startEntryId, range.endEntryId]),
      ),
    )
  const start = bounds.find((b) => b.id === range.startEntryId)
  const end = bounds.find((b) => b.id === range.endEntryId)
  if (!start || !end) return []
  const rows = await db
    .select()
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        ne(storyEntries.kind, 'system'),
        between(storyEntries.position, start.position, end.position),
      ),
    )
    .orderBy(asc(storyEntries.position), asc(storyEntries.createdAt))
  return rows.map((row) => ({ ...row, kind: row.kind as CloseRangeEntry['kind'] }))
}

export type MetadataCallOutcome =
  | { status: 'ok'; metadata: NormalizedChapterMetadata }
  | { status: 'aborted' }
  | { status: 'failed'; error: PipelineError }

/** What the metadata call reads from the stores, taken once before the phase's first await. */
export type MetadataCallInputs = {
  previousChapterSummary: string | null
  /** The branch's threads as the store holds them; the render keeps the open ones. */
  threads: readonly Thread[]
  mode: StoryMode
  modelConfig: ResolveModelConfig
}

function latestChapterSummary(branchId: string): string | null {
  let latest: { sequenceNumber: number; summary: string } | undefined
  for (const chapter of chaptersStore.getChapters().values()) {
    if (chapter.branchId !== branchId) continue
    if (latest === undefined || chapter.sequenceNumber > latest.sequenceNumber) latest = chapter
  }
  return latest?.summary ?? null
}

/**
 * Synchronous: every store read the metadata call needs, while the check holds. An open publishing
 * during a later await replaces the stores with another branch's rows.
 */
export function readMetadataInputs(ctx: PhaseContext): MetadataCallInputs | PhaseFailure {
  const open = currentStoryStore.getCurrentStory()
  if (!storesHoldBranch(open, ctx))
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: branch not loaded' },
    }
  const settings = appSettingsStore.getAppSettings()
  return {
    previousChapterSummary: latestChapterSummary(ctx.branchId),
    threads: [...threadsStore.getThreads().values()].filter((t) => t.branchId === ctx.branchId),
    mode: open.definition.mode,
    modelConfig: {
      providers: settings.providers,
      profiles: settings.profiles,
      assignments: settings.assignments,
      storyModels: open.settings.models,
    },
  }
}

/**
 * chapter-close.md → Phase 2's metadata: one call for the whole chapter, under the lore-mgmt
 * agent's bound. A cancel returns `aborted`; an expiry fails, as others do.
 */
export async function* requestChapterMetadata(
  ctx: PhaseContext,
  range: CloseRange,
  inputs: MetadataCallInputs,
): AsyncGenerator<PhaseEmittedEvent, MetadataCallOutcome> {
  const prompt = renderTemplate(
    TEMPLATE_IDS.chapterMetadata,
    buildChapterContext({
      entries: await readCloseRangeEntries(ctx.db, ctx.branchId, range),
      previousChapterSummary: inputs.previousChapterSummary,
      threads: inputs.threads,
      mode: inputs.mode,
    }),
  )
  const { modelConfig } = inputs
  const timeoutMs = callTimeoutMs(TARGET, modelConfig)
  const bounded = boundedSignal(ctx.abortSignal, timeoutMs)
  let result
  try {
    result = await generateStructured(
      TARGET,
      prompt,
      chapterMetadataSchema,
      modelConfig,
      bounded.signal,
      { actionId: ctx.actionId },
    )
  } finally {
    bounded.dispose()
  }
  yield* retriedAttemptEvents(result, TARGET)
  if (result.status === 'aborted' && !bounded.expired()) return { status: 'aborted' }
  if (result.status !== 'ok')
    return {
      status: 'failed',
      error: structuredCallFailure(result, {
        target: TARGET,
        phaseName: CLOSE_PHASE.metadata,
        timeoutMs,
      }).error,
    }
  return { status: 'ok', metadata: normalizeChapterMetadata(result.value) }
}
