/**
 * Style Review Schemas
 *
 * Zod schemas for style analysis output from the LLM.
 */

import * as z from 'zod'

export const phraseAnalysisSchema = z.object({
  phrase: z.string().describe('The repeated phrase or pattern'),
  frequency: z.number().describe('How many times it appears'),
  severity: z.enum(['low', 'medium', 'high']),
  alternatives: z.array(z.string()).describe('Suggested alternatives'),
  contexts: z.array(z.string()).describe('Example contexts where found'),
})

export const styleReviewResultSchema = z.object({
  phrases: z.array(phraseAnalysisSchema),
  overallAssessment: z.string().describe('Brief overall style assessment'),
})

export type PhraseAnalysis = z.infer<typeof phraseAnalysisSchema>
export type StyleReviewResult = z.infer<typeof styleReviewResultSchema>
