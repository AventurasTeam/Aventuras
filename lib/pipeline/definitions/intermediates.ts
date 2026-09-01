/**
 * Keys the per-turn phases park run-scoped results under in `ctx.intermediates`.
 * A leaf on purpose: a consumer that imported the producing phase for its key
 * alone would drag that phase's whole dependency graph in behind it.
 */

/** Where the retrieval phase parks its outcome; consumers re-narrow to `RetrievalSuccess`. */
export const RETRIEVAL_INTERMEDIATE_KEY = 'retrieval'
