// Persisted in pipeline_runs.kind and read back by boot recovery: the value must never change.
export const CHAPTER_CLOSE_KIND = 'chapter-close'

/** A re-run's gate kind, never a pipeline's: a re-run runs as CHAPTER_CLOSE_KIND. */
export const CHAPTER_CLOSE_RERUN = 'chapter-close-rerun'
