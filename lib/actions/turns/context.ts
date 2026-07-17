import type { Entity, StoryDefinition, StorySettings, StoryEntry } from '@/lib/db'
import { substituteIds, type IdBiMap } from '@/lib/ids'

type BuildArgs = {
  entries: readonly StoryEntry[] // full branch buffer, ascending by position
  entities: readonly Entity[]
  definition: StoryDefinition
  settings: StorySettings
  idMap: IdBiMap
}

// Defense-in-depth: emit '' for whitespace-only definitional prose so a header
// stays guarded regardless of the template's blank-check idiom. The bundled
// template uses `!= blank` (LiquidJS `blank` already matches whitespace), but a
// custom pack using `!= ""` would leak the header on a whitespace-only value.
function blankIfWhitespace(value: string): string {
  return value.trim() === '' ? '' : value
}

export function buildPerTurnGenerationContext(args: BuildArgs): Record<string, unknown> {
  const { entries, entities, definition, settings, idMap } = args

  const buffer = entries
    .filter((e) => e.kind !== 'system')
    .slice(-settings.partialChapterBuffer)
    .map((e) => ({ content: e.content }))

  const normalizedDefinition = {
    ...definition,
    setting: blankIfWhitespace(definition.setting),
    genre: { ...definition.genre, promptBody: blankIfWhitespace(definition.genre.promptBody) },
    tone: { ...definition.tone, promptBody: blankIfWhitespace(definition.tone.promptBody) },
  }

  const context = {
    entries: buffer,
    entities,
    sceneEntities: [] as string[], // M2: no classifier populates scene membership yet
    definition: normalizedDefinition,
    userSettings: {},
    intermediates: {},
  }

  // Data-side, pre-render substitution: entity `id` (char_/loc_/... UUIDs) becomes
  // a placeholder; prose (entry.content, definition prose) has no IDs and passes through.
  return substituteIds(context, idMap) as Record<string, unknown>
}
