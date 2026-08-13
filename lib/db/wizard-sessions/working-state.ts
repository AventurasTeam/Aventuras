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

const castVisualDraftSchema = z.object({
  physique: z.string().default(''),
  face: z.string().default(''),
  hair: z.string().default(''),
  eyes: z.string().default(''),
  attire: z.string().default(''),
  distinguishing: z.string().default(''),
})

const castDraftShared = {
  // Minted at add/import time so the row keeps identity across autosave
  // round-trips and lands in the commit under the same id (same rule as lore).
  id: z.string(),
  name: z.string().default(''),
  description: z.string().default(''),
  // `retired` is unreachable at wizard time (canon); only active|staged apply.
  status: z.enum(['active', 'staged']).default('active'),
  tags: z.array(z.string()).default(() => []),
}

const characterCastDraftSchema = z.object({
  ...castDraftShared,
  kind: z.literal('character'),
  voice: z.string().default(''),
  traits: z.array(z.string()).default(() => []),
  drives: z.array(z.string()).default(() => []),
  visual: castVisualDraftSchema.default(() => castVisualDraftSchema.parse({})),
  factionId: z.string().nullable().default(null),
})

const locationCastDraftSchema = z.object({
  ...castDraftShared,
  kind: z.literal('location'),
  parentLocationId: z.string().nullable().default(null),
  condition: z.string().default(''),
})

const itemCastDraftSchema = z.object({
  ...castDraftShared,
  kind: z.literal('item'),
  condition: z.string().default(''),
})

const factionCastDraftSchema = z.object({
  ...castDraftShared,
  kind: z.literal('faction'),
  agenda: z.array(z.string()).default(() => []),
  standing: z.string().default(''),
})

export const wizardCastDraftSchema = z.discriminatedUnion('kind', [
  characterCastDraftSchema,
  locationCastDraftSchema,
  itemCastDraftSchema,
  factionCastDraftSchema,
])

export type WizardCastDraft = z.infer<typeof wizardCastDraftSchema>
export type WizardCharacterDraft = z.infer<typeof characterCastDraftSchema>
export type WizardLocationDraft = z.infer<typeof locationCastDraftSchema>
export type WizardItemDraft = z.infer<typeof itemCastDraftSchema>
export type WizardFactionDraft = z.infer<typeof factionCastDraftSchema>

// `Omit` isn't distributive over a union by itself; the `T extends unknown`
// clause forces per-member distribution so each kind's own fields survive.
// `status` is excluded too: only setCastStatus may write it, because staging
// the lead must null leadEntityId in the same set() call — a generic by-id
// collection patch has no lead awareness and would leave that pointer stale.
type CastDraftPatchOf<T> = T extends unknown ? Partial<Omit<T, 'id' | 'kind' | 'status'>> : never

/** Patch accepted by a by-id cast mutator: any one kind's editable fields (status goes through setCastStatus). */
export type WizardCastDraftPatch = CastDraftPatchOf<WizardCastDraft>

export type WizardCastDraftByKind<K extends WizardCastDraft['kind']> = Extract<
  WizardCastDraft,
  { kind: K }
>

export function emptyCastDraft<K extends WizardCastDraft['kind']>(
  kind: K,
  id: string,
): WizardCastDraftByKind<K> {
  return wizardCastDraftSchema.parse({ kind, id }) as WizardCastDraftByKind<K>
}

export const wizardWorkingStateSchema = z.object({
  step: z.number().int().min(1).max(5).default(1),
  definition: wizardDefinitionDraftSchema.default(() => wizardDefinitionDraftSchema.parse({})),
  leadName: z.string().default(''),
  // Set by setLeadEntityId (the ⭐ button) or migrateLegacyLead's one-time
  // upgrade of a pre-3.6b session; always points at an existing active
  // character row in `cast`, or null. Nulled by the same cast mutators that
  // remove or stage the row it points at (status flip to staged, deletion).
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
  cast: z.array(wizardCastDraftSchema).default(() => []),
})

export type WizardWorkingState = z.infer<typeof wizardWorkingStateSchema>

export function emptyWorkingState(): WizardWorkingState {
  return wizardWorkingStateSchema.parse({})
}
