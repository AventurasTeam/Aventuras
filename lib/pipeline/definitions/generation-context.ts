import { describeCalendarVocabulary, getCalendar } from '@/lib/calendar'
import type { Entity, StoryDefinition, StorySettings, StoryEntry } from '@/lib/db'
import { substituteIds, type IdBiMap } from '@/lib/ids'

type BuildArgs = {
  // Caller-scoped entry window, ascending by position (per-turn: the open
  // partial chapter; chapter-close: the closing chapter). Recency windowing
  // is template-side via the `recent` filter, not done here.
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
  const { entries, entities, definition, settings, idMap, piggybackFires = false } = args

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
  }

  // Data-side, pre-render substitution: entity `id` (char_/loc_/... UUIDs) becomes
  // a placeholder; prose (entry.content, definition prose) has no IDs and passes through.
  return substituteIds(context, idMap) as Record<string, unknown>
}
