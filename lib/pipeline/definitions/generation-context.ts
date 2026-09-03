import { describeCalendarVocabulary, resolveCalendar } from '@/lib/calendar'
import { inheritedEntryMetadata, type Entity, type StoryEntry } from '@/lib/db'
import { IdBiMap, substituteIds } from '@/lib/ids'
import { buildSuggestionSlots, NARRATIVE_KINDS, promptProse } from '@/lib/piggyback'
import { templateReads, type TemplateId } from '@/lib/prompts'
import {
  readPromptBuffer,
  type Candidate,
  type EntityRow,
  type LoreRow,
  type RetrievalSuccess,
  type ThreadRow,
} from '@/lib/retrieval'
import { currentStoryStore, entitiesStore } from '@/lib/stores'

import { readLastTurns, readSceneSource } from './entry-reads'
import { RETRIEVAL_INTERMEDIATE_KEY } from './intermediates'
import type { GenerationPhaseName, PhaseContext, PhaseFailure } from '../types'

type BuildFlags = {
  /** Names the calling phase in a guard failure's detail. */
  phaseName: GenerationPhaseName
  /**
   * The template this context will render. The group's variable set does not
   * change with it — every story template may read all of it — but a read
   * behind a variable this template never mentions is work with no reader, so
   * the query behind it is skipped and the variable comes back empty.
   */
  templateId: TemplateId
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

type GuardFailure = { ok: false; result: PhaseFailure }

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

function promptEntity(entity: Entity): Pick<Entity, (typeof PROMPT_ENTITY_FIELDS)[number]> {
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

// One read serves all three, so any of them keeps it.
const SCENE_VARIABLES = ['sceneMetadata', 'sceneEntities', 'currentLocationId']

/**
 * Which end the model should measure `<world_time_delta>` from. Resolved here rather
 * than worded statically in the macro: "seconds elapsed since the previous entry" is
 * ambiguous about time the user's own action consumed.
 *
 * A `user_action` inherits the preceding AI entry's `worldTime`, so equal values mean
 * the action carries no time of its own and the delta must include it. Unequal means
 * the user advanced time on the action itself (the world-time footer is editable
 * there), and the delta measures from its end.
 */
export type WorldTimeDeltaBasis = 'sinceUserAction' | 'sinceLastAiReply'

function resolveWorldTimeDeltaBasis(rows: readonly StoryEntry[]): WorldTimeDeltaBasis {
  const tail = rows.at(-1)
  const previous = rows.at(-2)
  if (tail?.kind !== 'user_action' || previous == null || !NARRATIVE_KINDS.has(previous.kind))
    return 'sinceLastAiReply'
  const action = tail.metadata?.worldTime
  const reply = previous.metadata?.worldTime
  // Only a forward advance is evidence the user moved time on the action itself. A
  // missing value (the column is nullable) or a backward one is a broken premise, not
  // the other basis, and the inclusive reading is the safe default either way.
  if (typeof action !== 'number' || typeof reply !== 'number') return 'sinceLastAiReply'
  return action > reply ? 'sinceUserAction' : 'sinceLastAiReply'
}

/**
 * A story entry as a template sees it. Prose and position only: `metadata`
 * carries entity ids, and substituteIds allocates a placeholder for every id it
 * walks, so a window's worth of historical scene rosters would put entities
 * deleted chapters ago into the map — where resolveRef reads presence as "the
 * model was shown this". Current scene state is `sceneMetadata`, sourced from
 * one entry. `id` is deliberately absent; `entry` has no substitutable prefix,
 * and `position` is the handle a template wants.
 */
function promptEntry(entry: StoryEntry) {
  return { position: entry.position, content: promptProse(entry) }
}

function readRetrievalOutcome(
  intermediates: Record<string, unknown>,
): RetrievalSuccess | undefined {
  const stashed = intermediates[RETRIEVAL_INTERMEDIATE_KEY]
  if (typeof stashed !== 'object' || stashed === null || !('ok' in stashed)) return undefined
  return stashed.ok === true ? (stashed as RetrievalSuccess) : undefined
}

// The identity is the whole point of a desync guard: which branch went out of
// step is what the reader's system entry has to be able to say.
function guardFailure(
  phaseName: GenerationPhaseName,
  reason: string,
  ids: Pick<PhaseContext, 'storyId' | 'branchId'>,
): GuardFailure {
  return {
    ok: false,
    result: {
      status: 'failed',
      error: {
        kind: 'orchestrator',
        detail: `${phaseName}: ${reason} (story ${ids.storyId}, branch ${ids.branchId})`,
      },
    },
  }
}

/**
 * The one context builder for the `generationContext` group: every story agent's
 * phase calls this and its template picks from the same variable set (pinned in
 * templateContextMap; parity-tested here).
 *
 * Takes run identity and run-scoped flags only. No caller hands it domain data,
 * so no phase can quietly narrow the group's context to a slice of its own —
 * entries come from SQLite (never `entriesStore`, whose reader window caps them),
 * definition and settings from the open story, and entities from
 * `entitiesStore` — a separate store, hence the separate guard.
 */
export async function buildGenerationContext(
  ctx: Pick<PhaseContext, 'db' | 'storyId' | 'branchId' | 'intermediates'>,
  flags: BuildFlags,
) {
  const { branchId, storyId } = ctx
  const {
    phaseName,
    templateId,
    piggybackFires = false,
    suggestionsFire = false,
    refreshGuidance = '',
  } = flags

  // Both guards are defense-in-depth against store desync: a build against the
  // wrong branch would describe a story this prompt isn't telling, and would
  // filter every entity away rather than fail.
  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== branchId || open.storyId !== storyId)
    return guardFailure(phaseName, 'no open story for branch', ctx)
  if (entitiesStore.getLoadedBranch() !== branchId)
    return guardFailure(phaseName, 'entities store loaded for another branch', ctx)

  const { definition, settings } = open

  // Run-scoped, so it rides intermediates: the placeholders a later phase
  // resolves must be the ones the prompt was built with.
  const idMap = (ctx.intermediates.idMap as IdBiMap | undefined) ?? new IdBiMap()
  ctx.intermediates.idMap = idMap

  const reads = templateReads(templateId)
  const readsScene = SCENE_VARIABLES.some((name) => reads.has(name))
  const [buffer, lastTurns, sceneSource] = await Promise.all([
    reads.has('entries') ? readPromptBuffer(ctx.db, branchId, settings) : [],
    reads.has('lastTurns') || reads.has('worldTimeDeltaBasis')
      ? readLastTurns(ctx.db, branchId)
      : [],
    readsScene ? readSceneSource(ctx.db, branchId) : undefined,
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

  // The one entry's worth of scene state a template may read, so no historical
  // roster reaches the prompt or the id map.
  const scene = {
    ...inheritedEntryMetadata(sceneSource?.metadata),
    summary: sceneSource?.metadata?.summary ?? '',
  }

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
    // Read whenever `worldTimeDeltaBasis` is asked for, but exposed only when the
    // template names it: the read is a means to the basis, not an entitlement to
    // the rows.
    lastTurns: reads.has('lastTurns') ? lastTurns.map(promptEntry) : [],
    entities: branchEntities.map(promptEntity),
    sceneEntities: scene.sceneEntities,
    currentLocationId: scene.currentLocationId,
    sceneMetadata: scene,
    worldTimeDeltaBasis: resolveWorldTimeDeltaBasis(lastTurns),
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
  return { ok: true as const, context: substituteIds(context, idMap), idMap }
}

export type GenerationContextLoad = Awaited<ReturnType<typeof buildGenerationContext>>
/** The variable set every `generationContext` template renders, as the builder emits it. */
export type GenerationContext = Extract<GenerationContextLoad, { ok: true }>['context']
