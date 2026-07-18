/**
 * Memory Service Schemas
 *
 * Zod schemas for chapter analysis, summarization, and retrieval decisions.
 * The .describe() calls provide semantic guidance to LLMs via schema introspection.
 */

import { z } from 'zod'

export const chapterAnalysisSchema = z.object({
  shouldCreateChapter: z.boolean().describe('true if content forms a complete narrative arc'),
  optimalEndIndex: z.number().describe('Message index where chapter should end'),
  suggestedTitle: z.string().nullable().describe('Evocative chapter title (3-6 words)').optional(),
  keywords: z.array(z.string()).describe('Key terms for search'),
  characters: z.array(z.string()).describe('Character names mentioned'),
  locations: z.array(z.string()).describe('Location names mentioned'),
  plotThreads: z.array(z.string()).describe('Active plot threads or quests'),
  emotionalTone: z.string().describe('Overall emotional tone (tense, hopeful, mysterious, etc.)'),
  significantEvents: z.array(z.string()).describe('Major events that occurred'),
})

export type ChapterAnalysis = z.infer<typeof chapterAnalysisSchema>

export const chapterSummaryResultSchema = z.object({
  title: z.string().nullable().describe('Short evocative chapter title').optional(),
  summary: z.string().describe('Concise 2-3 sentence summary of what happened'),
  keywords: z.array(z.string()).describe('Key words for search'),
  characters: z.array(z.string()).describe('Character names mentioned'),
  locations: z.array(z.string()).describe('Location names mentioned'),
  plotThreads: z.array(z.string()).describe('Active plot threads or quests'),
  emotionalTone: z.string().nullable().describe('Overall emotional tone').optional(),
})

export type ChapterSummaryResult = z.infer<typeof chapterSummaryResultSchema>

export const retrievalDecisionSchema = z.object({
  shouldRetrieve: z.boolean().describe('true if past chapters are relevant to current context'),
  relevantChapterIds: z.array(z.string()).describe('IDs of chapters relevant to current scene'),
  reasoning: z.string().describe('Brief explanation of relevance').optional(),
})

export type RetrievalDecision = z.infer<typeof retrievalDecisionSchema>

export const chapterTimelineSchema = z.object({
  years: z.number().int().min(0).describe('Full years elapsed during this chapter'),
  days: z.number().int().min(0).describe('Days elapsed, beyond full years'),
  hours: z.number().int().min(0).describe('Hours elapsed, beyond full days'),
  minutes: z.number().int().min(0).describe('Minutes elapsed, beyond full hours'),
})

export type ChapterTimelineEstimate = z.infer<typeof chapterTimelineSchema>
