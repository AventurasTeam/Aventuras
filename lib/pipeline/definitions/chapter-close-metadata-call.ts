import { and, asc, between, eq, inArray, ne } from 'drizzle-orm'

import { boundedSignal } from '@/lib/abort'
import {
  callTimeoutMs,
  generateStructured,
  type ResolveModelConfig,
  type ResolveTarget,
} from '@/lib/ai'
import { storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, chaptersStore, currentStoryStore, threadsStore } from '@/lib/stores'

import { buildChapterContext } from './chapter-context'
import {
  chapterMetadataSchema,
  normalizeChapterMetadata,
  type ChapterMetadata,
} from './chapter-metadata-schema'
import { CLOSE_PHASE, type CloseRange } from './intermediates'
import { storesHoldBranch } from './stores-hold-branch'
import { retriedAttemptEvents, structuredCallFailure } from '../call-error'
import type { PhaseContext, PhaseEmittedEvent, PipelineError } from '../types'

const TARGET = 'lore-mgmt' satisfies ResolveTarget

/** The range's whole non-system rows, start entry through end, oldest first, stamped or not. */
export async function readCloseRangeEntries(
  db: DbCtx['db'],
  branchId: string,
  range: CloseRange,
): Promise<StoryEntry[]> {
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
  return (await db
    .select()
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        ne(storyEntries.kind, 'system'),
        between(storyEntries.position, start.position, end.position),
      ),
    )
    .orderBy(asc(storyEntries.position), asc(storyEntries.createdAt))) as StoryEntry[]
}

export type MetadataCallOutcome =
  | { status: 'ok'; metadata: ChapterMetadata }
  | { status: 'aborted' }
  | { status: 'failed'; error: PipelineError }

function previousChapterSummary(branchId: string): string | null {
  let latest: { sequenceNumber: number; summary: string } | undefined
  for (const chapter of chaptersStore.getChapters().values()) {
    if (chapter.branchId !== branchId) continue
    if (latest === undefined || chapter.sequenceNumber > latest.sequenceNumber) latest = chapter
  }
  return latest?.summary ?? null
}

/**
 * chapter-close.md → Phase 2: one structured call for the whole chapter, under the lore-mgmt
 * agent's bound. A cancel returns `aborted`; an expiry fails, as every other failure does.
 */
export async function* requestChapterMetadata(
  ctx: PhaseContext,
  range: CloseRange,
): AsyncGenerator<PhaseEmittedEvent, MetadataCallOutcome> {
  const open = currentStoryStore.getCurrentStory()
  if (!storesHoldBranch(open, ctx))
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: branch not loaded' },
    }
  // Read before the first await, while the check above still holds: an open publishing during the
  // range read replaces the stores with another branch's rows.
  const previousSummary = previousChapterSummary(ctx.branchId)
  const threads = [...threadsStore.getThreads().values()].filter((t) => t.branchId === ctx.branchId)
  const prompt = renderTemplate(
    TEMPLATE_IDS.chapterMetadata,
    buildChapterContext({
      entries: await readCloseRangeEntries(ctx.db, ctx.branchId, range),
      previousChapterSummary: previousSummary,
      threads,
      mode: open.definition.mode,
    }),
  )

  const cfg = appSettingsStore.getAppSettings()
  const modelConfig: ResolveModelConfig = {
    providers: cfg.providers,
    profiles: cfg.profiles,
    assignments: cfg.assignments,
    storyModels: open.settings.models,
  }
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
