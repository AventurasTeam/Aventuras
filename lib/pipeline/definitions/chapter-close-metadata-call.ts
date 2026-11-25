import { and, asc, between, eq, inArray, ne } from 'drizzle-orm'
import type { z } from 'zod'

import { modelConfigOf, type PromptHalves, type ResolveModelConfig } from '@/lib/ai'
import type { ChapterPartCut } from '@/lib/chapters'
import {
  storyEntries,
  type DbCtx,
  type StoryDefinition,
  type StoryMode,
  type Thread,
} from '@/lib/db'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import {
  appSettingsStore,
  chaptersStore,
  currentStoryStore,
  entitiesStore,
  threadsStore,
} from '@/lib/stores'
import { oneLine } from '@/lib/text'
import { resolveLeadLogged } from '@/lib/world'

import {
  buildChapterContext,
  buildChapterMergeContext,
  type CloseRangeEntry,
} from './chapter-context'
import {
  chapterMetadataSchema,
  chapterPartSummarySchema,
  normalizeChapterMetadata,
  normalizeChapterPartSummary,
  type NormalizedChapterMetadata,
} from './chapter-metadata-schema'
import { closeParts } from './close-agent/parts'
import { CLOSE_TARGET, CLOSE_PHASE, type CloseRange } from './intermediates'
import { storesHoldBranch } from './stores-hold-branch'
import { boundedStructuredCall } from '../bounded-structured-call'
import type { PhaseContext, PhaseEmittedEvent, PhaseFailure, PipelineError } from '../types'

const TARGET = CLOSE_TARGET

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
  /** The branch's lead by the flag, its name on one line; null with none or two. */
  lead: { id: string; name: string } | null
  narration: StoryDefinition['narration']
  /** A branch character's name on one line; undefined for no such row. */
  nameOf: (id: string) => string | undefined
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
  const lead = resolveLeadLogged(
    entitiesStore.getEntities(ctx.branchId),
    ctx.branchId,
    'chapter-close-metadata',
  )
  // Copied now, for the reason above: a lookup into the store would answer after the awaits.
  const names = new Map<string, string>(
    entitiesStore.getByKind(ctx.branchId, 'character').map((row) => [row.id, oneLine(row.name)]),
  )
  return {
    previousChapterSummary: chaptersStore.getLatest(ctx.branchId)?.summary ?? null,
    threads: [...threadsStore.getThreads(ctx.branchId).values()],
    mode: open.definition.mode,
    modelConfig: modelConfigOf(settings, open.settings),
    lead: lead == null ? null : { id: lead.id, name: oneLine(lead.name) },
    narration: open.definition.narration,
    nameOf: (id) => names.get(id),
  }
}

type CallOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'aborted' }
  | { status: 'failed'; error: PipelineError }

// One lore-mgmt call under its agent's bound, with no output default (a cut fails the close);
// the phase reports the run's error alone.
async function* metadataCall<T>(
  ctx: PhaseContext,
  prompt: PromptHalves,
  schema: z.ZodType<T>,
  modelConfig: ResolveModelConfig,
): AsyncGenerator<PhaseEmittedEvent, CallOutcome<T>> {
  const call = yield* boundedStructuredCall({
    target: TARGET,
    phaseName: CLOSE_PHASE.metadata,
    prompt,
    schema,
    config: modelConfig,
    signal: ctx.abortSignal,
    options: { actionId: ctx.actionId },
  })
  if (call.status === 'ok') return { status: 'ok', value: call.value }
  if (call.status === 'failed') return { status: 'failed', error: call.error }
  return call
}

/**
 * chapter-close.md → Phase 2's metadata. One part: one call over the chapter. More: a call per part
 * for its summary, then one merging them, the cancel polled before each. A cancel returns
 * `aborted`; a failed or expired call fails.
 */
export async function* requestChapterMetadata(
  ctx: PhaseContext,
  range: CloseRange,
  parts: readonly ChapterPartCut[],
  inputs: MetadataCallInputs,
): AsyncGenerator<PhaseEmittedEvent, MetadataCallOutcome> {
  const { previousChapterSummary, threads, mode, modelConfig, lead, narration, nameOf } = inputs
  const story = { previousChapterSummary, threads, mode, lead, narration, nameOf }
  const entries = await readCloseRangeEntries(ctx.db, ctx.branchId, range)
  if (parts.length <= 1) {
    const prompt = renderTemplate(
      TEMPLATE_IDS.chapterMetadata,
      buildChapterContext({ entries, ...story }),
    )
    const call = yield* metadataCall(ctx, prompt, chapterMetadataSchema, modelConfig)
    if (call.status !== 'ok') return call
    return { status: 'ok', metadata: normalizeChapterMetadata(call.value) }
  }

  const partSummaries: string[] = []
  for (const part of closeParts(entries, parts)) {
    if (ctx.abortSignal.aborted) return { status: 'aborted' }
    const inPart = new Set(part.entryIds)
    // Each part's own entries, walked on their own from the lead.
    const prompt = renderTemplate(
      TEMPLATE_IDS.chapterMetadataPart,
      buildChapterContext({ entries: entries.filter((entry) => inPart.has(entry.id)), ...story }),
    )
    const call = yield* metadataCall(ctx, prompt, chapterPartSummarySchema, modelConfig)
    if (call.status !== 'ok') return call
    partSummaries.push(normalizeChapterPartSummary(call.value))
  }
  if (ctx.abortSignal.aborted) return { status: 'aborted' }
  const prompt = renderTemplate(
    TEMPLATE_IDS.chapterMetadataMerge,
    buildChapterMergeContext({ partSummaries, previousChapterSummary, threads }),
  )
  const merge = yield* metadataCall(ctx, prompt, chapterMetadataSchema, modelConfig)
  if (merge.status !== 'ok') return merge
  return { status: 'ok', metadata: normalizeChapterMetadata(merge.value) }
}
