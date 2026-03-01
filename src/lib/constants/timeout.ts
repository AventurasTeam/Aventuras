/**
 * LLM Request Timeout Constants
 *
 * These constants define the minimum, maximum, and default timeout values
 * for LLM API requests across the application.
 */

/** Minimum timeout for LLM requests: 30 seconds */
export const LLM_TIMEOUT_MIN = 30000

/** Maximum timeout for LLM requests: 10 minutes */
export const LLM_TIMEOUT_MAX = 600000

/** Default timeout for LLM requests: 6 minutes */
export const LLM_TIMEOUT_DEFAULT = 360000

/** Timeout slider step: 30 seconds */
export const LLM_TIMEOUT_STEP = 30000

/** Minimum timeout in seconds (for display/input) */
export const LLM_TIMEOUT_MIN_SECONDS = LLM_TIMEOUT_MIN / 1000

/** Maximum timeout in seconds (for display/input) */
export const LLM_TIMEOUT_MAX_SECONDS = LLM_TIMEOUT_MAX / 1000
