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

const wizardLoreDraftSchema = z.object({
  // Minted at add time (generateId('lore')) so the row keeps identity across
  // autosave round-trips and lands in the commit under the same id.
  id: z.string(),
  title: z.string().default(''),
  body: z.string().default(''),
  category: z.string().default(''),
  tags: z.array(z.string()).default(() => []),
  injectionMode: z.enum(['always', 'auto', 'disabled']).default('auto'),
  priority: z.number().int().min(0).max(100).default(0),
})

export type WizardLoreDraft = z.infer<typeof wizardLoreDraftSchema>

export const wizardWorkingStateSchema = z.object({
  step: z.number().int().min(1).max(5).default(1),
  definition: wizardDefinitionDraftSchema.default(() => wizardDefinitionDraftSchema.parse({})),
  leadName: z.string().default(''),
  // Real UUID minted once when the opening ✨ runs on a lead-requiring path, so
  // the opening's sceneEntities refs, the lead entities row, and
  // definition.leadEntityId all resolve to the same id at Finish.
  leadEntityId: z.string().nullable().default(null),
  opening: wizardOpeningDraftSchema.default(() => wizardOpeningDraftSchema.parse({})),
  // null = model native dim; a positive int truncates to that Matryoshka dim.
  // Locked into stories.settings.effectiveDim at Finish (retrieval.md).
  effectiveDim: z.number().int().positive().nullable().default(null),
  // Flips true on any explicit dim pick (including Native/null) so the
  // platform pre-selection fires once per session, not once per disclosure
  // mount — a deliberate Native choice survives step-nav remounts.
  effectiveDimTouched: z.boolean().default(false),
  lore: z.array(wizardLoreDraftSchema).default(() => []),
})

export type WizardWorkingState = z.infer<typeof wizardWorkingStateSchema>

export function emptyWorkingState(): WizardWorkingState {
  return wizardWorkingStateSchema.parse({})
}
