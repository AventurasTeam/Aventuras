/**
 * Retrieval Steps
 *
 * Translates the retrieval agent's own event record into activity steps.
 *
 * A translation rather than a direct reuse of `RetrievalEvent`: that type is shaped for the
 * agent's progress line and the debug transcript, and binding the activity record to it
 * would make either hard to change.
 */

import type { RetrievalEvent } from './retrievalHistory'
import type { StartStepOptions } from '$lib/services/activity'

export interface RetrievalStep {
  label: string
  options: StartStepOptions & { durationMs?: number }
}

/**
 * How a tool call reads in the timeline: what it looked for, and what came back.
 *
 * Only `query` is marked as an LLM step -- it is the one that costs a model call, and the
 * point of the marker is to tell the expensive work from the free work at a glance.
 */
export function retrievalStep(event: RetrievalEvent): RetrievalStep {
  switch (event.kind) {
    case 'grep': {
      const scope = event.chapters?.length ? `ch.${event.chapters.join(',')}` : 'all chapters'
      const shown = event.sampled
        ? `${event.excerptsShown} of ${event.totalMatches} matches`
        : `${event.totalMatches} matches`
      return {
        label: `grep "${event.query}"`,
        options: { detail: `${scope} · ${shown}${event.repeated ? ' · repeated' : ''}` },
      }
    }
    case 'query':
      return {
        label: `query ch.${event.chapterNumber}`,
        options: {
          detail: event.failed ? 'failed' : event.cached ? 'cached' : event.question,
          // A cached replay is the same answer handed back, not a second model call.
          isLLM: !event.cached && !event.failed,
          durationMs: event.durationMs ?? 0,
        },
      }
    case 'search':
      return {
        label: event.query ? `search "${event.query}"` : 'search entries',
        options: { detail: `${event.resultCount} found${event.type ? ` · ${event.type}` : ''}` },
      }
    case 'world_state':
      return {
        label: event.query ? `world state "${event.query}"` : 'world state',
        options: {
          detail: `${event.resultCount} found${event.category ? ` · ${event.category}` : ''}`,
        },
      }
    case 'entry':
      return {
        label: `read ${event.name ?? event.entryId ?? 'entry'}`,
        options: { detail: event.found ? undefined : 'not found' },
      }
    case 'finish':
      return {
        label: 'finish',
        options: {
          detail: `confidence: ${event.confidence}${event.hasSummary ? '' : ' · no summary'}`,
        },
      }
  }
}

/** The status a translated step is recorded with. */
export function retrievalStepStatus(event: RetrievalEvent): 'done' | 'failed' {
  return event.kind === 'query' && event.failed ? 'failed' : 'done'
}
