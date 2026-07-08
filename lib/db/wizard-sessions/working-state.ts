import { z } from 'zod'

const labeledPromptSchema = z.object({
  label: z.string().default(''),
  promptBody: z.string().default(''),
})

const wizardDefinitionDraftSchema = z.object({
  title: z.string().default(''),
  description: z.string().default(''),
  mode: z.enum(['adventure', 'creative']).default('creative'),
  narration: z.enum(['first', 'second', 'third']).default('third'),
  genre: labeledPromptSchema.default(() => labeledPromptSchema.parse({})),
  tone: labeledPromptSchema.default(() => labeledPromptSchema.parse({})),
  setting: z.string().default(''),
  calendarSystemId: z.string().default('earth-gregorian'),
  worldTimeOrigin: z.record(z.string(), z.number()).default(() => ({})),
})

const wizardOpeningDraftSchema = z.object({
  content: z.string().default(''),
  sceneEntities: z.array(z.string()).default(() => []),
  currentLocationId: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
})

export const wizardWorkingStateSchema = z.object({
  step: z.number().int().min(1).max(5).default(1),
  definition: wizardDefinitionDraftSchema.default(() => wizardDefinitionDraftSchema.parse({})),
  leadName: z.string().default(''),
  // Real UUID minted once when the opening ✨ runs on a lead-requiring path, so
  // the opening's sceneEntities refs, the lead entities row, and
  // definition.leadEntityId all resolve to the same id at Finish.
  leadEntityId: z.string().nullable().default(null),
  opening: wizardOpeningDraftSchema.default(() => wizardOpeningDraftSchema.parse({})),
})

export type WizardWorkingState = z.infer<typeof wizardWorkingStateSchema>

export function emptyWorkingState(): WizardWorkingState {
  return wizardWorkingStateSchema.parse({})
}
