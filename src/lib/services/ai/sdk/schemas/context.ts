/**
 * Context Selection Schema
 *
 * Schema for LLM-based entity selection in Tier 3 context building.
 */

import * as z from 'zod'

/**
 * Result of LLM entity selection: positions in the numbered candidate list, never ids —
 * ids are not rendered into the prompt, so the model has never seen one.
 */
export const entitySelectionSchema = z.object({
  selectedIndices: z
    .array(z.string())
    .describe('Index numbers of the most relevant entries, e.g. ["0", "3"]'),
  reasoning: z.string().optional().describe('Brief explanation of selection logic'),
})

export type EntitySelectionResult = z.infer<typeof entitySelectionSchema>
