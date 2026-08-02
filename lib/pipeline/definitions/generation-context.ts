import { describeCalendarVocabulary, getCalendar } from '@/lib/calendar'
import type { Entity, StoryDefinition, StorySettings, StoryEntry } from '@/lib/db'
import { substituteIds, type IdBiMap } from '@/lib/ids'
import { buildSuggestionSlots } from '@/lib/piggyback'
import {
  composePromptBuffer,
  type Candidate,
  type EntityRow,
  type LoreRow,
  type RetrievalSuccess,
  type ThreadRow,
} from '@/lib/retrieval'

type BuildArgs = {
  // Scopes both collections below. Callers already read per-branch, but no
  // generation context has ever wanted a row from another branch, so the
  // predicate belongs here rather than at each call site.
  branchId: string
  // The branch's loaded entries, ascending by position. Every consumer draws
  // from that one set and differs only in how much of it it passes, so this is
  // a truncation seam, not a per-kind query. What reaches a template is
  // composePromptBuffer's window over this list, so a caller handing over a
  // deliberate short tail can still have it cut — or emptied — by the story's
  // own buffer knobs, which the caller does not control.
  entries: readonly StoryEntry[]
  entities: readonly Entity[]
  definition: StoryDefinition
  settings: StorySettings
  idMap: IdBiMap
  // Whether THIS turn's tagged block will actually be consumed — only the
  // narrative phase knows this (piggybackMode + resolved model capability),
  // so it's caller-supplied rather than computed here. Defaults false for
  // every other generationContext consumer, which never emits state-emission
  // instructions in the first place.
  piggybackFires?: boolean
  // Whether THIS call should emit the <suggestions> fragment — only the
  // calling fold knows this (suggestionsEnabled + enabled categories + no
  // suggestions already in hand), so it's caller-supplied like piggybackFires
  // rather than computed here. Defaults false for every other
  // generationContext consumer.
  suggestionsFire?: boolean
  // Composer text at the moment the reader hit ⟳ on the chip strip
  // (reader-composer.md → Next-turn suggestions). Only the suggestion-refresh
  // phase has it; blank everywhere else.
  refreshGuidance?: string
  // This turn's successful retrieval pass. Absent for the two folds that never
  // retrieve — the piggyback fallback classifier and suggestion-refresh — which
  // then render every bucket empty.
  retrieval?: RetrievalSuccess
}

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

// Projected for the same reason as promptRows, plus one the types hide: the
// floor is built over loaded source rows, so every row below still carries
// `embeddingStale` (and lore's `keywords`) at runtime even though StructuralFloor
// declares the narrower shape. Only this projection actually drops them.
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

// The one context builder for the `generationContext` group: every story
// agent's phase calls this and its template picks from the same variable set
// (pinned in templateContextMap; parity-tested here).
export function buildGenerationContext(args: BuildArgs): Record<string, unknown> {
  const {
    branchId,
    entries,
    entities,
    definition,
    settings,
    idMap,
    piggybackFires = false,
    suggestionsFire = false,
    refreshGuidance = '',
    retrieval,
  } = args

  // Both exclusions are unconditional defense-in-depth: system entries are
  // technical-only rows (removed on generate) that templates must never see,
  // and a foreign-branch row would describe a story this prompt isn't telling.
  // Not redundant with composePromptBuffer's own system filter — the scene and
  // location tail reads below depend on this one.
  const narrative = entries.filter((e) => e.kind !== 'system' && e.branchId === branchId)
  const branchEntities = entities.filter((e) => e.branchId === branchId)

  const normalizedDefinition = {
    ...definition,
    setting: blankIfWhitespace(definition.setting),
    genre: { ...definition.genre, promptBody: blankIfWhitespace(definition.genre.promptBody) },
    tone: { ...definition.tone, promptBody: blankIfWhitespace(definition.tone.promptBody) },
  }

  const calendar = getCalendar(definition.calendarSystemId)

  // Built unconditionally: the slots are the story's palette, not an
  // instruction to emit. suggestionsFire answers the separate question of
  // whether a surface should ASK for chips, and suggestion-refresh leaves it
  // false — asking is that call's whole premise, not a per-run condition.
  const suggestionSlots = buildSuggestionSlots(settings.suggestionCategories).slots

  const tail = narrative.at(-1)
  const floor = retrieval?.floor

  const context = {
    // cadence.md → Composition rule: the two-mode window plus its
    // protectedBuffer spillover is not expressible as a template `| recent: N`.
    entries: composePromptBuffer(narrative, settings).map((e) => ({ content: e.content })),
    entities: branchEntities,
    // Writers inherit scene state forward (submit-turn, per-turn), so the
    // non-system tail always carries the current scene and location.
    sceneEntities: tail?.metadata?.sceneEntities ?? [],
    currentLocationId: tail?.metadata?.currentLocationId ?? null,
    definition: normalizedDefinition,
    calendarVocabulary: calendar ? describeCalendarVocabulary(calendar) : null,
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
    structuralSceneEntities: floorEntities(floor?.sceneEntities),
    structuralLocation: floor?.currentLocation ? floorEntity(floor.currentLocation) : null,
    structuralActiveThreads: floorThreads(floor?.activeThreads),
    // Kept per type rather than concatenated: no field tags a row with its own
    // type, and an entity's `name` against lore's and threads' `title` leaves
    // one loop nothing uniform to render.
    structuralPinnedEntities: floorEntities(floor?.alwaysEntities),
    structuralPinnedLore: floorLore(floor?.alwaysLore),
    structuralPinnedThreads: floorThreads(floor?.alwaysThreads),
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
  return substituteIds(context, idMap) as Record<string, unknown>
}
