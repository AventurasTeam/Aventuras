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

export type OpeningOutput = z.infer<typeof openingOutputSchema>
