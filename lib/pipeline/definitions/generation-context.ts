import { describeCalendarVocabulary, getCalendar } from '@/lib/calendar'
import type { Entity, StoryDefinition, StorySettings, StoryEntry } from '@/lib/db'
import { substituteIds, type IdBiMap } from '@/lib/ids'
import { buildSuggestionSlots } from '@/lib/piggyback'

type BuildArgs = {
  // The branch's loaded entries, ascending by position. Every consumer draws
  // from that one set and differs only in how much of it it passes, so this is
  // a truncation seam, not a per-kind query. Recency windowing is template-side
  // via the `recent` filter, not done here.
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
}

// Defense-in-depth: emit '' for whitespace-only definitional prose so a header
// stays guarded regardless of the template's blank-check idiom. The bundled
// template uses `!= blank` (LiquidJS `blank` already matches whitespace), but a
// custom pack using `!= ""` would leak the header on a whitespace-only value.
function blankIfWhitespace(value: string): string {
  return value.trim() === '' ? '' : value
}

// The one context builder for the `generationContext` group: every story
// agent's phase calls this and its template picks from the same variable set
// (pinned in templateContextMap; parity-tested here).
export function buildGenerationContext(args: BuildArgs): Record<string, unknown> {
  const {
    entries,
    entities,
    definition,
    settings,
    idMap,
    piggybackFires = false,
    suggestionsFire = false,
    refreshGuidance = '',
  } = args

  // System entries are technical-only rows (removed on generate) — templates
  // must never see them, so exclusion is unconditional defense-in-depth.
  const narrative = entries.filter((e) => e.kind !== 'system')

  const normalizedDefinition = {
    ...definition,
    setting: blankIfWhitespace(definition.setting),
    genre: { ...definition.genre, promptBody: blankIfWhitespace(definition.genre.promptBody) },
    tone: { ...definition.tone, promptBody: blankIfWhitespace(definition.tone.promptBody) },
  }

  const calendar = getCalendar(definition.calendarSystemId)

  const suggestionSlots = suggestionsFire
    ? buildSuggestionSlots(settings.suggestionCategories).slots
    : []

  const context = {
    entries: narrative.map((e) => ({ content: e.content })),
    entities,
    // Writers inherit scene membership forward (submit-turn, per-turn), so the
    // non-system tail always carries the current scene state.
    sceneEntities: narrative.at(-1)?.metadata?.sceneEntities ?? [],
    definition: normalizedDefinition,
    calendarVocabulary: calendar ? describeCalendarVocabulary(calendar) : null,
    userSettings: { partialChapterBuffer: settings.partialChapterBuffer },
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
