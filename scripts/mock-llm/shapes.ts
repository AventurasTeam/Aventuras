import { z } from 'zod'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'
import { classifierExtractionSchema } from '@/lib/classifier'
import {
  fallbackClassifierSchema,
  fallbackClassifierWithSuggestionsSchema,
  suggestionRefreshSchema,
} from '@/lib/pipeline'
import { bundledPack, TEMPLATE_IDS, type TemplateId } from '@/lib/prompts'
import {
  castSuggestionsSchema,
  descriptionOutputSchema,
  labeledPromptOutputSchema,
  loreSuggestionsSchema,
  openingOutputSchema,
  settingOutputSchema,
  titleChipsSchema,
} from '@/lib/wizard'

// Shared by the dev mock server and e2e/harness/mock-llm.ts. Deliberately tiny
// and side-effect free: the E2E suite imports it, so anything heavier here
// becomes a way for a dev-tool edit to break the test run.
//
// `block` is the exact string the app renders into a structured prompt for this
// schema, produced by the app's own renderer over the app's own zod schema — so
// a match can never drift from what the app actually sends.
//
// One entry per CALL SITE. Where several call sites answer with the same schema
// — and therefore the same block — `marker` separates them: the literal text a
// template opens with, before its first Liquid tag, sliced out of the pack the
// app itself renders. Derived rather than hand-written, so editing a template
// moves its marker in the same edit. Story shapes are one call site each and
// carry no marker.
//
// Default replies are NOT shared. E2E wants inert no-ops for determinism, the
// dev mock wants defaults lively enough that a manual turn visibly does
// something; one list serving both would serve both badly.

export type ShapeGroup = 'story' | 'wizard'

export type StructuredShape = {
  name: string
  group: ShapeGroup
  schema: z.ZodType
  block: string
  /** Prompt prefix separating call sites that share a block; '' when unneeded. */
  marker: string
}

function blockOf(schema: z.ZodType): string {
  return schemaToTypeScriptBlock(z.toJSONSchema(schema) as JsonSchema)
}

const LIQUID_TAG = /\{[{%]/

function markerOf(templateId: TemplateId): string {
  const source = bundledPack.templates[templateId]?.source ?? ''
  const tag = source.search(LIQUID_TAG)
  return (tag === -1 ? source : source.slice(0, tag)).trim()
}

function storyShape(name: string, schema: z.ZodType): StructuredShape {
  return { name, group: 'story', schema, block: blockOf(schema), marker: '' }
}

function wizardShape(name: string, schema: z.ZodType, templateId: TemplateId): StructuredShape {
  return { name, group: 'wizard', schema, block: blockOf(schema), marker: markerOf(templateId) }
}

export const STRUCTURED_SHAPES: readonly StructuredShape[] = [
  storyShape('per-turn-classifier', fallbackClassifierSchema),
  storyShape('per-turn-classifier-suggestions', fallbackClassifierWithSuggestionsSchema),
  storyShape('periodic-classifier', classifierExtractionSchema),
  storyShape('suggestion-refresh', suggestionRefreshSchema),

  wizardShape('wizard-genre', labeledPromptOutputSchema, TEMPLATE_IDS.wizardGenre),
  wizardShape('wizard-genre-refine', labeledPromptOutputSchema, TEMPLATE_IDS.wizardGenreRefine),
  wizardShape('wizard-tone', labeledPromptOutputSchema, TEMPLATE_IDS.wizardTone),
  wizardShape('wizard-tone-refine', labeledPromptOutputSchema, TEMPLATE_IDS.wizardToneRefine),
  wizardShape('wizard-setting', settingOutputSchema, TEMPLATE_IDS.wizardSetting),
  wizardShape('wizard-setting-refine', settingOutputSchema, TEMPLATE_IDS.wizardSettingRefine),
  wizardShape('wizard-lore', loreSuggestionsSchema, TEMPLATE_IDS.wizardLore),
  wizardShape('wizard-cast', castSuggestionsSchema, TEMPLATE_IDS.wizardCast),
  wizardShape('wizard-opening', openingOutputSchema, TEMPLATE_IDS.wizardOpening),
  wizardShape('wizard-opening-refine', openingOutputSchema, TEMPLATE_IDS.wizardOpeningRefine),
  wizardShape('wizard-title-chips', titleChipsSchema, TEMPLATE_IDS.wizardTitleChips),
  wizardShape('wizard-description', descriptionOutputSchema, TEMPLATE_IDS.wizardDescription),
  wizardShape(
    'wizard-description-refine',
    descriptionOutputSchema,
    TEMPLATE_IDS.wizardDescriptionRefine,
  ),
]

export function findShapeByName(name: string): StructuredShape | undefined {
  return STRUCTURED_SHAPES.find((s) => s.name === name)
}
