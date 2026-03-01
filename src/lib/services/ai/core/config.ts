/**
 * AI Service Configuration
 *
 * Centralized configuration constants and logging utilities for all AI services.
 * This replaces the scattered hardcoded values and per-service DEBUG flags.
 *
 * MIGRATION NOTE: Use getContextConfig() and getLorebookConfig() instead of AI_CONFIG
 * for values that should be user-configurable via Advanced Settings.
 */

import { settings } from '$lib/stores/settings.svelte'

/**
 * AI service configuration constants (defaults).
 * These values control context window sizes, limits, and thresholds.
 * Use getContextConfig() and getLorebookConfig() to get user-configurable values.
 */
export const AI_CONFIG = {
  /** Context window sizes for different operations */
  context: {
    /** Number of recent entries for main narrative context */
    recentEntriesForNarrative: 20,
    /** Number of recent entries for tiered context building */
    recentEntriesForTiered: 10,
    /** Number of recent entries for classification/retrieval operations */
    recentEntriesForRetrieval: 5,
    /** Number of recent entries for action choices context */
    recentEntriesForChoices: 5,
    /** Number of user actions to analyze for style matching */
    userActionsForStyle: 6,
    /** Number of recent entries for lore management context */
    recentEntriesForLoreManagement: 10,
    /** Number of recent entries for name matching in tiered context */
    recentEntriesForNameMatching: 3,
  },

  /** Lorebook injection limits */
  lorebook: {
    /** Max lorebook entries for action choices */
    maxForActionChoices: 12,
    /** Max lorebook entries for suggestions */
    maxForSuggestions: 15,
    /** Max lorebook entries for agentic preview */
    maxForAgenticPreview: 20,
    /** Threshold for switching to LLM-based selection */
    llmThreshold: 30,
    /** Max entries per tier in context building */
    maxEntriesPerTier: 20,
  },

  /** Memory/chapter system defaults */
  memory: {
    /** Default token threshold for chapter creation */
    defaultTokenThreshold: 16000,
    /** Default chapter buffer (entries protected from summarization) */
    defaultChapterBuffer: 10,
  },

  /** Classifier settings */
  classifier: {
    /** Default chat history truncation length */
    defaultChatHistoryTruncation: 100,
  },
} as const

/**
 * Debug configuration.
 * Controls logging behavior across all AI services.
 */
export const DEBUG = {
  /** Master switch for all AI service logging - enabled in dev mode only */
  enabled: import.meta.env.DEV,
} as const

/**
 * Creates a logger function for an AI service.
 * Logs are only output when DEBUG.enabled is true (dev mode).
 *
 * @param serviceName - Name of the service (shown as prefix in logs)
 * @returns A logging function that respects the DEBUG configuration
 *
 * @example
 * const log = createLogger('Classifier');
 * log('Processing entry', { id: entry.id }); // [Classifier] Processing entry { id: ... }
 */
export function createLogger(serviceName: string) {
  const prefix = `[${serviceName}]`
  return (...args: unknown[]) => {
    if (DEBUG.enabled) {
      console.log(prefix, ...args)
    }
  }
}

/**
 * Type for the logger function returned by createLogger.
 */
export type Logger = ReturnType<typeof createLogger>

/**
 * Get context window configuration from user settings with fallback to defaults.
 * Use this instead of AI_CONFIG.context for user-configurable values.
 */
export function getContextConfig() {
  const ctx = settings.serviceSpecificSettings?.contextWindow
  return {
    recentEntriesForNarrative:
      ctx?.recentEntriesForNarrative ?? AI_CONFIG.context.recentEntriesForNarrative,
    recentEntriesForTiered: ctx?.recentEntriesForTiered ?? AI_CONFIG.context.recentEntriesForTiered,
    recentEntriesForRetrieval:
      ctx?.recentEntriesForRetrieval ?? AI_CONFIG.context.recentEntriesForRetrieval,
    recentEntriesForChoices:
      ctx?.recentEntriesForChoices ?? AI_CONFIG.context.recentEntriesForChoices,
    userActionsForStyle: ctx?.userActionsForStyle ?? AI_CONFIG.context.userActionsForStyle,
    recentEntriesForLoreManagement:
      ctx?.recentEntriesForLoreManagement ?? AI_CONFIG.context.recentEntriesForLoreManagement,
    recentEntriesForNameMatching:
      ctx?.recentEntriesForNameMatching ?? AI_CONFIG.context.recentEntriesForNameMatching,
  }
}

/**
 * Get lorebook limits configuration from user settings with fallback to defaults.
 * Use this instead of AI_CONFIG.lorebook for user-configurable values.
 */
export function getLorebookConfig() {
  const lb = settings.serviceSpecificSettings?.lorebookLimits
  return {
    maxForActionChoices: lb?.maxForActionChoices ?? AI_CONFIG.lorebook.maxForActionChoices,
    maxForSuggestions: lb?.maxForSuggestions ?? AI_CONFIG.lorebook.maxForSuggestions,
    maxForAgenticPreview: lb?.maxForAgenticPreview ?? AI_CONFIG.lorebook.maxForAgenticPreview,
    llmThreshold: lb?.llmThreshold ?? AI_CONFIG.lorebook.llmThreshold,
    maxEntriesPerTier: lb?.maxEntriesPerTier ?? AI_CONFIG.lorebook.maxEntriesPerTier,
  }
}

/**
 * Get agentic retrieval configuration from user settings with fallback to defaults.
 */
export function getAgenticRetrievalConfig() {
  const ar = settings.serviceSpecificSettings?.agenticRetrieval
  return {
    maxIterations: ar?.maxIterations ?? 10,
  }
}
