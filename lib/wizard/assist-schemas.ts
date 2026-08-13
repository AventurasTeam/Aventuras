import { z } from 'zod'

// Field descriptions live on the schema (.describe); lib/ai's prompt-schema
// middleware renders them into the call as TypeScript-interface comments, so
// the validated shape and the prompt's field list cannot drift apart.
export const openingOutputSchema = z.object({
  prose: z.string().describe('the opening passage as a string'),
  sceneEntities: z
    .array(z.string())
    .describe(
      'cast ids present in the scene (use the exact cast id(s) provided above; [] if none)',
    ),
  currentLocationId: z
    .string()
    .nullable()
    .describe('the location id where the scene opens, or null'),
  worldTime: z.literal(0),
})
export const titleChipsSchema = z.object({
  titles: z.array(z.string()).min(1).describe('five short, evocative titles'),
})
export const descriptionOutputSchema = z.object({
  description: z.string().describe('the one-sentence log line'),
})

export const loreSuggestionsSchema = z.object({
  lore: z
    .array(
      z.object({
        // Trimmed at the parse boundary: a padded title would otherwise reach
        // the store through the list result's opaque `payload`, which bypasses
        // the render-layer trim in markExisting.
        title: z.string().trim().describe('short reference-entry title'),
        body: z.string().trim().describe('one or two paragraphs of reference prose'),
        category: z
          .string()
          .trim()
          .default('')
          .describe('optional grouping label, e.g. cosmology or history'),
      }),
    )
    .min(1)
    .describe('five reference entries about this world'),
})

export type LoreSuggestions = z.infer<typeof loreSuggestionsSchema>

export const labeledPromptOutputSchema = z.object({
  // Trimmed at the parse boundary: these values land in stories.definition
  // verbatim, and there is no later trim on the write path.
  label: z.string().trim().describe('a short name for this genre or tone'),
  promptBody: z
    .string()
    .trim()
    .describe('two or three paragraphs instructing how the prose should read'),
})

export const settingOutputSchema = z.object({
  // Same reason as labeledPromptOutputSchema above.
  setting: z.string().trim().describe('one or two paragraphs describing the world'),
})

export type LabeledPromptOutput = z.infer<typeof labeledPromptOutputSchema>
export type SettingOutput = z.infer<typeof settingOutputSchema>

export type OpeningOutput = z.infer<typeof openingOutputSchema>

const castSuggestionStatus = z
  .enum(['active', 'staged'])
  .default('active')
  .describe("'active' if present from the opening scene; 'staged' for cast introduced later")

// Trimmed at the parse boundary like loreSuggestionsSchema above: these payloads
// bypass the render-layer trim, and the reference-name fields feed Task 9's
// case-insensitive name matching, so an untrimmed name would mismatch.
const castSuggestionShared = {
  name: z.string().trim().describe('entity name'),
  description: z.string().trim().describe('two or three sentences of who or what this is'),
  status: castSuggestionStatus,
}

const characterSuggestionSchema = z.object({
  ...castSuggestionShared,
  kind: z.literal('character'),
  voice: z.string().trim().optional().describe('speech pattern, e.g. "clipped, formal"'),
  traits: z.array(z.string().trim()).optional().describe('personality/skill traits, at most 8'),
  drives: z.array(z.string().trim()).optional().describe('goals, fears, sore spots, at most 6'),
  faction_name: z
    .string()
    .trim()
    .optional()
    .describe(
      "this character's faction — the exact name of a faction in this batch or the existing cast",
    ),
  visual: z
    .object({
      physique: z.string().trim().optional(),
      face: z.string().trim().optional(),
      hair: z.string().trim().optional(),
      eyes: z.string().trim().optional(),
      attire: z.string().trim().optional(),
      distinguishing: z.string().trim().optional(),
    })
    .optional()
    .describe('visual descriptors, free strings'),
})

const locationSuggestionSchema = z.object({
  ...castSuggestionShared,
  kind: z.literal('location'),
  parent_location_name: z
    .string()
    .trim()
    .optional()
    .describe('the exact name of the containing location in this batch or the existing cast'),
  condition: z.string().trim().optional().describe('ongoing state, e.g. "war-damaged"'),
})

const itemSuggestionSchema = z.object({
  ...castSuggestionShared,
  kind: z.literal('item'),
  condition: z.string().trim().optional().describe('dynamic state, e.g. "intact", "cursed"'),
})

const factionSuggestionSchema = z.object({
  ...castSuggestionShared,
  kind: z.literal('faction'),
  agenda: z.array(z.string().trim()).optional().describe('current goals, at most 4'),
  standing: z.string().trim().optional().describe('dynamic power/situation'),
})

export const castSuggestionsSchema = z.object({
  entities: z
    .array(
      z.discriminatedUnion('kind', [
        characterSuggestionSchema,
        locationSuggestionSchema,
        itemSuggestionSchema,
        factionSuggestionSchema,
      ]),
    )
    .min(1)
    .describe(
      'five suggested cast entries, mixed across kinds unless the guidance directs otherwise',
    ),
})

export type CastSuggestions = z.infer<typeof castSuggestionsSchema>
export type CastSuggestion = CastSuggestions['entities'][number]
