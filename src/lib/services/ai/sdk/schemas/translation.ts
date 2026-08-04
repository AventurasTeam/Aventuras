/**
 * Translation Schemas
 *
 * Zod schemas for validating translation outputs from the LLM.
 * Used by TranslationService for structured translation results.
 */

import * as z from 'zod'

// ============================================================================
// UI Elements Translation
// ============================================================================

/**
 * Schema for a translated UI item.
 */
export const translatedUIItemSchema = z.object({
  /** Original item ID - unchanged */
  id: z.string().describe('Original item ID - unchanged'),
  /** Translated text content */
  text: z.string().describe('Translated text content'),
  /** Item type - unchanged */
  type: z.enum(['name', 'description', 'title']).describe('Item type - unchanged'),
})

/**
 * Schema for batch UI translation result.
 */
export const translatedUIResultSchema = z.object({
  items: z.array(translatedUIItemSchema).describe('Translated UI items'),
})

// ============================================================================
// Suggestions Translation
// ============================================================================

/**
 * Schema for a translated suggestion.
 */
export const translatedSuggestionSchema = z.object({
  /** Translated suggestion text */
  text: z.string().describe('Translated suggestion text'),
  /** Suggestion type - unchanged */
  type: z.string().optional().describe('Suggestion type - unchanged'),
})

/**
 * Schema for suggestions translation result.
 */
export const translatedSuggestionsResultSchema = z.object({
  suggestions: z.array(translatedSuggestionSchema).describe('Translated suggestions'),
})

// ============================================================================
// Action Choices Translation
// ============================================================================

/**
 * Schema for a translated action choice.
 */
export const translatedActionChoiceSchema = z.object({
  /** Translated action choice text */
  text: z.string().describe('Translated action choice text'),
  /** Action type - unchanged */
  type: z.string().optional().describe('Action type - unchanged'),
})

/**
 * Schema for action choices translation result.
 */
export const translatedActionChoicesResultSchema = z.object({
  choices: z.array(translatedActionChoiceSchema).describe('Translated action choices'),
})

// ============================================================================
// Wizard Batch Translation
// ============================================================================

/**
 * Schema for wizard batch translation result.
 * Translates a record of key-value string pairs.
 */
export const translatedWizardBatchResultSchema = z.object({
  translations: z.record(z.string(), z.string()).describe('Translated key-value pairs'),
})

// ============================================================================
// Type Exports
// ============================================================================

export type TranslatedUIItem = z.infer<typeof translatedUIItemSchema>
export type TranslatedUIResult = z.infer<typeof translatedUIResultSchema>
export type TranslatedSuggestion = z.infer<typeof translatedSuggestionSchema>
export type TranslatedSuggestionsResult = z.infer<typeof translatedSuggestionsResultSchema>
export type TranslatedActionChoice = z.infer<typeof translatedActionChoiceSchema>
export type TranslatedActionChoicesResult = z.infer<typeof translatedActionChoicesResultSchema>
export type TranslatedWizardBatchResult = z.infer<typeof translatedWizardBatchResultSchema>
