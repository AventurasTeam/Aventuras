import * as z from 'zod'

export const expandedSettingSchema = z.object({
  name: z.string().describe('memorable name for the setting'),
  description: z
    .string()
    .describe('2-3 paragraphs describing the world, its rules, and atmosphere'),
  keyLocations: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().describe('1-2 sentences describing the location'),
      }),
    )
    .describe('3-5 locations initially available in the setting'),
  atmosphere: z.string().describe('the overall mood and feeling of the setting'),
  themes: z.array(z.string()).describe('3-5 themes that this setting explores'),
  potentialConflicts: z.array(z.string()).describe('3-5 story hooks or conflicts'),
})

export const generatedProtagonistSchema = z.object({
  name: z.string().describe('fitting name for this character (leave generic for 2nd person POV)'),
  description: z.string().describe('1-2 sentences about who they are'),
  background: z.string().describe('2-3 sentences about their history'),
  motivation: z
    .string()
    .describe('1-2 sentences about what drives the protagonist, what they want'),
  traits: z.array(z.string()).describe('3-5 personality traits'),
  appearance: z
    .string()
    .optional()
    .describe('brief physical description (optional for 2nd person POV)'),
})

export const generatedCharacterSchema = z.object({
  name: z.string().describe('fitting name for this character'),
  role: z
    .string()
    .describe("character's role in the story (ally, antagonist, mentor, love interest, etc.)"),
  description: z.string().describe('1-2 sentences about who they are'),
  relationship: z.string().describe("character's relationship to the protagonist"),
  traits: z.array(z.string()).describe('2-4 personality traits'),
  vaultId: z.string().optional(),
})
export const generatedCharactersSchema = z.array(generatedCharacterSchema)

export const generatedOpeningSchema = z.object({
  scene: z.string().describe('2-3 paragraphs describing the opening scene'),
  title: z.string().describe('title for the story'),
  initialLocation: z.object({
    name: z.string(),
    description: z.string().describe('1-2 sentences describing the location'),
  }),
})

export type ExpandedSetting = z.infer<typeof expandedSettingSchema>
export type GeneratedProtagonist = z.infer<typeof generatedProtagonistSchema>
export type GeneratedCharacter = z.infer<typeof generatedCharacterSchema>
export type GeneratedCharacters = z.infer<typeof generatedCharactersSchema>
export type GeneratedOpening = z.infer<typeof generatedOpeningSchema>
