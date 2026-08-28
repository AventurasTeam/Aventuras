import { and, desc, eq, ne } from 'drizzle-orm'

import { describeCalendarVocabulary, resolveCalendar } from '@/lib/calendar'
import {
  inheritedEntryMetadata,
  storyEntries,
  type DbCtx,
  type Entity,
  type StoryEntry,
} from '@/lib/db'
import { IdBiMap, substituteIds } from '@/lib/ids'
import { buildSuggestionSlots, promptProse } from '@/lib/piggyback'
import {
  readPromptBuffer,
  type Candidate,
  type EntityRow,
  type LoreRow,
  type RetrievalSuccess,
  type ThreadRow,
} from '@/lib/retrieval'
import { currentStoryStore, entitiesStore } from '@/lib/stores'

import { RETRIEVAL_INTERMEDIATE_KEY } from './per-turn-retrieval'
import type { PhaseContext, PhaseResult } from '../types'

type BuildFlags = {
  /** Prefixes a guard failure's detail with the calling phase's name. */
  label: string
  // Whether THIS turn's tagged block will actually be consumed — only the
  // narrative phase knows this (piggybackMode + resolved model capability), so
  // it stays caller-supplied. Defaults false for every other consumer, which
  // never emits state-emission instructions in the first place.
  piggybackFires?: boolean
  // Whether THIS call should emit the <suggestions> fragment — only the calling
  // fold knows this (suggestionsEnabled + enabled categories + no suggestions
  // already in hand), so it is caller-supplied like piggybackFires.
  suggestionsFire?: boolean
  // Composer text at the moment the reader hit ⟳ on the chip strip
  // (reader-composer.md → Next-turn suggestions). Only the suggestion-refresh
  // phase has it; blank everywhere else.
  refreshGuidance?: string
}

export type GenerationContextLoad =
  | { ok: true; context: Record<string, unknown> }
  | { ok: false; result: Extract<PhaseResult, { status: 'failed' }> }

/** A ranked bundle row as a template sees it. */
export type RetrievedRow = { id: string; displayName: string; renderedText: string }

/** A structural-floor row as a template sees it, per source type. */
export type FloorEntity = Pick<EntityRow, 'id' | 'kind' | 'status' | 'name' | 'description'>
export type FloorLore = Pick<LoreRow, 'id' | 'title' | 'body'>
export type FloorThread = Pick<ThreadRow, 'id' | 'status' | 'title' | 'description'>

// Defense-in-depth: emit '' for whitespace-only definitional prose so a header
// stays guarded regardless of the template's blank-check idiom. The bundled
// template uses `!= blank` (LiquidJS `blank` already matches whitespace), but a
// custom pack using `!= ""` would leak the header on a whitespace-only value.
function blankIfWhitespace(value: string): string {
  return value.trim() === '' ? '' : value
}

/**
 * The exact fields templateContextMap documents for `generationContext.entities`.
 * Projected rather than passed whole: packs are user-authored, so an un-projected
 * drizzle row silently makes every future column (`state`, `tags`,
 * `embeddingStale`, timestamps) part of the template surface — reachable by a
 * custom template and impossible to drop later without breaking it.
 */
export const PROMPT_ENTITY_FIELDS = [
  'id',
  'kind',
  'name',
  'description',
  'status',
  'injectionMode',
] as const

function promptEntity(entity: Entity): Record<string, unknown> {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    description: entity.description,
    status: entity.status,
    injectionMode: entity.injectionMode,
  }
}

// Only the fields a prompt renders: `renderedText` is the exact string the
// ranker measured the type budget against, and the Float32Array vector beside
// it would be walked into a numeric-keyed object by substituteIds.
function promptRows(selected: readonly Candidate[] | undefined): RetrievedRow[] {
  return (selected ?? []).map((c) => ({
    id: c.id,
    displayName: c.displayName,
    renderedText: c.renderedText,
  }))
}

// Projected to exactly the fields a template renders — the floor's own rows are
// already narrowed, but a prompt surface is a user-authored contract and pins
// its own field set.
const floorEntity = (e: EntityRow): FloorEntity => ({
  id: e.id,
  kind: e.kind,
  status: e.status,
  name: e.name,
  description: e.description,
})

const floorEntities = (rows: readonly EntityRow[] | undefined): FloorEntity[] =>
  (rows ?? []).map(floorEntity)

const floorLore = (rows: readonly LoreRow[] | undefined): FloorLore[] =>
  (rows ?? []).map((l) => ({ id: l.id, title: l.title, body: l.body }))

const floorThreads = (rows: readonly ThreadRow[] | undefined): FloorThread[] =>
  (rows ?? []).map((t) => ({
    id: t.id,
    status: t.status,
    title: t.title,
    description: t.description,
  }))

/** The last two narrative turns: the user's action and the AI's reply. */
const LAST_TURNS = 2

/**
 * A story entry as a template sees it. `metadata` is projected, never passed
 * whole: the column also carries raw model `reasoning`, the reversed submission
 * kept for Retry, internal failure detail and per-call telemetry — none of which
 * belongs in a prompt, and any of which a pack could reach for good once
 * exposed. `id` is deliberately absent; `entry` has no substitutable prefix, and
 * `position` is the handle a template wants.
 */
function promptEntry(entry: StoryEntry): Record<string, unknown> {
  return {
    position: entry.position,
    content: promptProse(entry),
    metadata: {
      ...inheritedEntryMetadata(entry.metadata),
      summary: entry.metadata?.summary ?? '',
    },
  }
}

// Bounded by the query rather than by a caller or a template: the pair is a
// pipeline contract (the user's action plus the AI's reply), not a share of the
// prompt budget, so neither the story's buffer knobs nor a pack may narrow it.
async function readLastTurns(db: DbCtx['db'], branchId: string): Promise<StoryEntry[]> {
  const rows = (await db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system')))
    .orderBy(desc(storyEntries.position))
    .limit(LAST_TURNS)) as StoryEntry[]
  return rows.reverse()
}

function readRetrievalOutcome(
  intermediates: Record<string, unknown>,
): RetrievalSuccess | undefined {
  const stashed = intermediates[RETRIEVAL_INTERMEDIATE_KEY]
  if (typeof stashed !== 'object' || stashed === null || !('ok' in stashed)) return undefined
  return stashed.ok === true ? (stashed as RetrievalSuccess) : undefined
}

const guardFailure = (detail: string): GenerationContextLoad => ({
  ok: false,
  result: { status: 'failed', error: { kind: 'orchestrator', detail } },
})

/**
 * The one context builder for the `generationContext` group: every story agent's
 * phase calls this and its template picks from the same variable set (pinned in
 * templateContextMap; parity-tested here).
 *
 * Takes run identity and run-scoped flags only. No caller hands it domain data,
 * so no phase can quietly narrow the group's context to a slice of its own —
 * entries come from SQLite (never `entriesStore`, whose reader window caps them),
 * and the open story carries definition, settings and entities.
 */
export async function buildGenerationContext(
  ctx: Pick<PhaseContext, 'db' | 'storyId' | 'branchId' | 'intermediates'>,
  flags: BuildFlags,
): Promise<GenerationContextLoad> {
  const { branchId, storyId } = ctx
  const { label, piggybackFires = false, suggestionsFire = false, refreshGuidance = '' } = flags

  // Both guards are defense-in-depth against store desync: a build against the
  // wrong branch would describe a story this prompt isn't telling, and would
  // filter every entity away rather than fail.
  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== branchId || open.storyId !== storyId)
    return guardFailure(`${label}: no open story for branch`)
  if (entitiesStore.getLoadedBranch() !== branchId)
    return guardFailure(`${label}: entities store loaded for another branch`)

  const { definition, settings } = open

  // Run-scoped, so it rides intermediates: the placeholders a later phase
  // resolves must be the ones the prompt was built with.
  const idMap = (ctx.intermediates.idMap as IdBiMap | undefined) ?? new IdBiMap()
  ctx.intermediates.idMap = idMap

  const [buffer, lastTurns] = await Promise.all([
    readPromptBuffer(ctx.db, branchId, settings),
    readLastTurns(ctx.db, branchId),
  ])
  const branchEntities = [...entitiesStore.getEntities().values()].filter(
    (e) => e.branchId === branchId,
  )

  const normalizedDefinition = {
    ...definition,
    setting: blankIfWhitespace(definition.setting),
    genre: { ...definition.genre, promptBody: blankIfWhitespace(definition.genre.promptBody) },
    tone: { ...definition.tone, promptBody: blankIfWhitespace(definition.tone.promptBody) },
  }

  // Prompt and reader footer must describe the same calendar; both fall back to
  // earth-gregorian until vault calendars land (M8.3).
  const calendar = resolveCalendar(definition.calendarSystemId)

  // Built unconditionally: the slots are the story's palette, not an
  // instruction to emit. suggestionsFire answers the separate question of
  // whether a surface should ASK for chips, and suggestion-refresh leaves it
  // false — asking is that call's whole premise, not a per-run condition.
  const suggestionSlots = buildSuggestionSlots(settings.suggestionCategories).slots

  const retrieval = readRetrievalOutcome(ctx.intermediates)
  const floor = retrieval?.floor

  // The branch's own tail, not the window's: scene state is what the story is
  // currently in, so it must not move with the buffer knobs or with whatever a
  // template chose to render.
  const tail = lastTurns.at(-1)

  // Every place the prompt brackets an id for, in the order the blocks render.
  // A template that instead named "the ids above" would point <current_location>
  // at a set that can be all characters: ranked rows reach a template as
  // RetrievedRow, which carries no EntityKind, so their kinds come off the
  // retrieval outcome, which still held the source row.
  const locationIds = [
    ...(floor?.sceneEntities ?? []).filter((e) => e.kind === 'location').map((e) => e.id),
    ...(floor?.currentLocation?.kind === 'location' ? [floor.currentLocation.id] : []),
    ...(floor?.alwaysEntities ?? []).filter((e) => e.kind === 'location').map((e) => e.id),
    ...(retrieval?.selectedLocationIds ?? []),
  ]

  const context = {
    // cadence.md → Composition rule: the two-mode window plus its
    // protectedBuffer spillover is not expressible as a template `| recent: N`.
    entries: buffer.map(promptEntry),
    lastTurns: lastTurns.map(promptEntry),
    entities: branchEntities.map(promptEntity),
    // Writers inherit scene state forward (submit-turn, per-turn), so the
    // non-system tail always carries the current scene and location.
    sceneEntities: tail?.metadata?.sceneEntities ?? [],
    currentLocationId: tail?.metadata?.currentLocationId ?? null,
    definition: normalizedDefinition,
    calendarVocabulary: describeCalendarVocabulary(calendar),
    userSettings: {
      fullChapterInBuffer: settings.fullChapterInBuffer,
      partialChapterBuffer: settings.partialChapterBuffer,
      protectedBuffer: settings.protectedBuffer,
    },
    retrievedEntities: promptRows(retrieval?.bundles.entities.selected),
    retrievedLore: promptRows(retrieval?.bundles.lore.selected),
    retrievedHappenings: promptRows(retrieval?.bundles.happenings.selected),
    retrievedThreads: promptRows(retrieval?.bundles.threads.selected),
    retrievedChapters: promptRows(retrieval?.bundles.chapters.selected),
    structuralLocation: floor?.currentLocation ? floorEntity(floor.currentLocation) : null,
    structuralActiveThreads: floorThreads(floor?.activeThreads),
    // Kept per type rather than concatenated: no field tags a row with its own
    // type, and an entity's `name` against lore's and threads' `title` leaves
    // one loop nothing uniform to render.
    structuralPinnedEntities: floorEntities(floor?.alwaysEntities),
    structuralPinnedLore: floorLore(floor?.alwaysLore),
    structuralPinnedThreads: floorThreads(floor?.alwaysThreads),
    locationIds: [...new Set(locationIds)],
    intermediates: {},
    piggybackFires,
    // Re-gated on the derived slots, not just the caller's flag: a caller
    // passing suggestionsFire=true against an all-disabled palette must still
    // omit the fragment rather than render it with an empty pick list.
    suggestionsFire: suggestionsFire && suggestionSlots.length > 0,
    suggestionSlots,
    suggestionCount: settings.suggestionCount,
    refreshGuidance: blankIfWhitespace(refreshGuidance),
  }

  // Data-side, pre-render substitution: entity `id` (char_/loc_/... UUIDs) becomes
  // a placeholder; prose (entry.content, definition prose) has no IDs and passes through.
  return { ok: true, context: substituteIds(context, idMap) as Record<string, unknown> }
}
