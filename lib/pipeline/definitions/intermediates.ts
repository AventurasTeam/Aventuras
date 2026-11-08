import type { CloseReport } from '@/lib/db'

/**
 * Keys phases park run-scoped results under in `ctx.intermediates`; a leaf so a key needn't import
 * its producing phase's dependency graph. The close's keys sit behind `close-intermediates.ts`.
 */

/** Where the retrieval phase parks its outcome; consumers re-narrow to `RetrievalSuccess`. */
export const RETRIEVAL_INTERMEDIATE_KEY = 'retrieval'

/** The close's range, parked by `boundary`; later phases read its rows from SQL by these ids. */
export type CloseRange = Readonly<{ chapterId: string; startEntryId: string; endEntryId: string }>

/** C4: what a close's run builds of its report; `report` adds `version` and `actionId`. */
export type CloseLedger = Pick<CloseReport, 'calls' | 'stopped' | 'noToolCalls'>

/** The close's phase names, shared by its declaration and every phase's `phaseName`. */
export const CLOSE_PHASE = {
  boundary: 'boundary',
  metadata: 'metadata',
  agent: 'agent',
  report: 'report',
} as const
