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

// Type exports inferred from schemas
export type TimelineQuery = z.infer<typeof timelineQuerySchema>
export type TimelineQueriesResult = z.infer<typeof timelineQueriesResultSchema>
