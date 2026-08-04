/**
 * Action Choices Schema
 *
 * Zod schema for validating action choices output from the LLM.
 * Used by ActionChoicesService for adventure mode.
 */

import * as z from 'zod'

/**
 * Schema for a single action choice.
 */
export const actionChoiceSchema = z.object({
  /** The action text for the player */
  text: z.string().describe('The action text for the player'),
  /** Type: action, dialogue, examine, or move */
  type: z
    .enum(['action', 'dialogue', 'examine', 'move'])
    .describe('Type: action, dialogue, examine, or move'),
})

/**
 * Schema for the action choices result.
 * Contains an array of 1-4 choices.
 */
export const actionChoicesResultSchema = z.object({
  choices: z.array(actionChoiceSchema).min(1).max(4).describe('1-4 action choices'),
})

// Type exports inferred from schemas
export type ActionChoice = z.infer<typeof actionChoiceSchema>
export type ActionChoicesResult = z.infer<typeof actionChoicesResultSchema>
