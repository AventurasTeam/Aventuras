import { z } from 'zod'

export const openingOutputSchema = z.object({
  prose: z.string(),
  sceneEntities: z.array(z.string()),
  currentLocationId: z.string().nullable(),
  worldTime: z.literal(0),
})
export const titleChipsSchema = z.object({ titles: z.array(z.string()).min(1) })
export const descriptionOutputSchema = z.object({ description: z.string() })

export type OpeningOutput = z.infer<typeof openingOutputSchema>
