/**
 * AI Retrieval Module
 *
 * Context retrieval services for gathering relevant story information:
 * - EntryRetrieval: Tiered lorebook entry retrieval (always-inject, name-matching, LLM-selection)
 * - AgenticRetrieval: Tool-based intelligent chapter/entry search
 * - TimelineFill: Fill gaps in story timeline with generated content
 */

// Entry Retrieval
export {
  EntryRetrievalService,
  getEntryRetrievalConfigFromSettings,
  getRelevantEntries,
  SimpleActivationTracker,
  STICKINESS_BY_TYPE,
  DEFAULT_ENTRY_RETRIEVAL_CONFIG,
  type EntryRetrievalResult,
  type ActivationTracker,
  type RetrievedEntry,
  type EntryRetrievalConfig,
  type LiveWorldState,
} from './EntryRetrievalService'

// Agentic Retrieval
export {
  AgenticRetrievalService,
  getDefaultAgenticRetrievalSettings,
  type AgenticRetrievalContext,
  type AgenticRetrievalResult,
  type AgenticRetrievalSettings,
} from './AgenticRetrievalService'

// Timeline Fill
export {
  TimelineFillService,
  getDefaultTimelineFillSettings,
  type TimelineFillResult,
  type TimelineFillSettings,
  type ResolvedTimelineQuery,
  type TimelineQueryResult,
  type TimelineChapterInfo,
} from './TimelineFillService'
