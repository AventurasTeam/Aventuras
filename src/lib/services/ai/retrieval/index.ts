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
  SimpleActivationTracker,
  STICKINESS_BY_TYPE,
  DEFAULT_ENTRY_RETRIEVAL_CONFIG,
  type EntryRetrievalResult,
  type ActivationTracker,
  type RetrievedEntry,
  type EntryRetrievalConfig,
} from './EntryRetrievalService'

// Agentic Retrieval
export {
  AgenticRetrievalService,
  type RetrievalContext as AgenticRetrievalContext,
  type RetrievalResult as AgenticRetrievalResult,
} from './AgenticRetrievalService'

// Timeline Fill
// `TimelineFillSettings` and its defaults live in ai/index.ts, which is what the settings
// store reads. A second copy here declared `mode: 'static'` while the real default had
// moved to 'agentic', so the two disagreed about the app's behaviour and neither call
// site would have told you which one was live -- nothing imported this one at all.
export {
  TimelineFillService,
  type TimelineFillResult,
  type TimelineQueryResult,
} from './TimelineFillService'
