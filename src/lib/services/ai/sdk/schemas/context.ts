/**
 * Context Selection Schema
 *
 * Schema for LLM-based entity selection in Tier 3 context building.
 */

import * as z from 'zod'

/**
 * Result of LLM entity selection.
 * The LLM returns IDs of relevant entities from a candidate list.
 */
export const entitySelectionSchema = z.object({
  selectedIds: z.array(z.string()).describe('IDs of the most relevant entities'),
  reasoning: z.string().optional().describe('Brief explanation of selection logic'),
})

export type EntitySelectionResult = z.infer<typeof entitySelectionSchema>
