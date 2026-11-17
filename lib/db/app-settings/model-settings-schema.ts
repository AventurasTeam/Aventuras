import { z } from 'zod'

// A leaf module: app-settings-schema imports the story schema, so the story's override can't
// import the profile's settings from there without a cycle.

/** The call settings a profile and a story's model override share (data-model.md → App settings storage). */
export const modelSettingsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxOutput: z.number().int().positive().optional(),
  thinking: z.number().int().nonnegative().optional(),
  /** Seconds; unset = no limit, except a classifier pass's or a chapter close's call's ten minutes. */
  timeout: z.number().optional(),
  structuredOutput: z.enum(['auto', 'force-on', 'force-off']).optional(),
  customJson: z.record(z.string(), z.unknown()).optional(),
})

export type ModelSettings = z.infer<typeof modelSettingsSchema>
