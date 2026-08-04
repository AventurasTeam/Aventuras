/**
 * Timeline Schema
 *
 * Zod schemas for timeline fill service operations.
 * Used by TimelineFillService for memory retrieval.
 */

import * as z from 'zod'

/**
 * Schema for a single timeline query.
 * Can specify either a list of chapters or a chapter range.
 */
export const timelineQuerySchema = z.object({
  /** The question to ask about the timeline */
  query: z.string().describe('The question to ask about the timeline'),
  /** Specific chapter numbers to query */
  chapters: z.array(z.number()).optional().describe('Specific chapter numbers to query'),
  /** Start of chapter range (inclusive) */
  startChapter: z.number().optional().describe('Start of chapter range'),
  /** End of chapter range (inclusive) */
  endChapter: z.number().optional().describe('End of chapter range'),
})

/**
 * Schema for the timeline queries result.
 * Contains an array of queries to run against chapters.
 */
export const timelineQueriesResultSchema = z.object({
  queries: z.array(timelineQuerySchema).describe('Queries to run against chapter summaries'),
})

/**
 * Schema for a batched answer to multiple questions about the same chapter(s).
 * Answers are keyed by the index of the question they answer (matching the order
 * questions were listed in the prompt), not necessarily returned in that order.
 */
export const timelineBatchAnswerResultSchema = z.object({
  answers: z
    .array(
      z.object({
        index: z.number().describe('Index of the question being answered, from the QUESTIONS list'),
        answer: z.string().describe('Concise, factual answer to that question'),
      }),
    )
    .describe('One answer per question, keyed by index'),
})

// Type exports inferred from schemas
export type TimelineQuery = z.infer<typeof timelineQuerySchema>
export type TimelineQueriesResult = z.infer<typeof timelineQueriesResultSchema>
export type TimelineBatchAnswerResult = z.infer<typeof timelineBatchAnswerResultSchema>
