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
