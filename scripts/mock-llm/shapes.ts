import { z } from 'zod'

import { schemaToTypeScriptBlock, type JsonSchema } from '@/lib/ai'
import { classifierExtractionSchema } from '@/lib/classifier'
import {
  fallbackClassifierSchema,
  fallbackClassifierWithSuggestionsSchema,
  suggestionRefreshSchema,
} from '@/lib/pipeline'

// Shared by the dev mock server and e2e/harness/mock-llm.ts. Deliberately tiny
// and side-effect free: the E2E suite imports it, so anything heavier here
// becomes a way for a dev-tool edit to break the test run.
//
// `block` is the exact string the app renders into a structured prompt for this
// schema, produced by the app's own renderer over the app's own zod schema — so
// a match can never drift from what the app actually sends. One entry per reply
// SHAPE, not per agent: the classifier has three schemas and therefore three
// entries.
//
// Default replies are NOT shared. E2E wants inert no-ops for determinism, the
// dev mock wants defaults lively enough that a manual turn visibly does
// something; one list serving both would serve both badly.

export type StructuredShape = {
  name: string
  schema: z.ZodType
  block: string
}

function shape(name: string, schema: z.ZodType): StructuredShape {
  return { name, schema, block: schemaToTypeScriptBlock(z.toJSONSchema(schema) as JsonSchema) }
}

export const STRUCTURED_SHAPES: readonly StructuredShape[] = [
  shape('per-turn-classifier', fallbackClassifierSchema),
  shape('per-turn-classifier-suggestions', fallbackClassifierWithSuggestionsSchema),
  shape('periodic-classifier', classifierExtractionSchema),
  shape('suggestion-refresh', suggestionRefreshSchema),
]

export function findShapeByName(name: string): StructuredShape | undefined {
  return STRUCTURED_SHAPES.find((s) => s.name === name)
}
