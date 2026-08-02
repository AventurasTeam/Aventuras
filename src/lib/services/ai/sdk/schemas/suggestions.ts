/**
 * Suggestions Schema
 *
 * Zod schema for validating story suggestions output from the LLM.
 * This replaces the manual JSON parsing and validation in SuggestionsService.
 */

import * as z from 'zod'

/**
 * Schema for a single story suggestion.
 */
export const suggestionSchema = z.object({
  /** The suggestion text - a narrative direction or plot beat */
  text: z.string().describe('The suggestion text'),
  /** Type of suggestion: action, dialogue, revelation, or twist */
  type: z.enum(['action', 'dialogue', 'revelation', 'twist']).describe('Type of suggestion'),
})

/**
 * Schema for the suggestions result.
 * Contains an array of up to 3 suggestions.
 */
export const suggestionsResultSchema = z.object({
  suggestions: z.array(suggestionSchema).max(3).describe('Up to 3 story suggestions'),
})

// Type exports inferred from schemas
export type Suggestion = z.infer<typeof suggestionSchema>
export type SuggestionsResult = z.infer<typeof suggestionsResultSchema>
