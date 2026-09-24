/**
 * The time a new story starts at, where the wizard's opening step reads it from and what it tells
 * generation.
 *
 * Each opening the step offers carries its own start, so nothing here arbitrates between them:
 * the start belonging to the opening that is used is the one that seeds the story.
 */

import type { TimeTracker } from '$lib/types'
import { formatStoryTime, parseStoryTime } from './duration'
import { normalizeTime } from './minutes'

export const STARTING_TIME_VAR = 'storyStartingTime'

/** What an empty start is sent as, the same request an empty title makes. */
export const SUGGEST_ONE = '(suggest one)'

/** Whether a template body would render the start at all. */
export function templateReceivesStartingTime(content: string | null | undefined): boolean {
  return !!content && new RegExp(`{{\\s*${STARTING_TIME_VAR}\\b`).test(content)
}

export type ResultStartSource = 'returned' | 'guidance' | 'edited'

/**
 * The generated opening's own start: what the model returned, or the guidance it was given when
 * it returned nothing readable. Normalized, so an untouched value never reads as an edit later.
 */
export function returnedStart(
  returned: string | null | undefined,
  guidance: TimeTracker | null,
): { text: string; source: ResultStartSource | null } {
  const parsed = parseStoryTime(returned ?? '')
  const start = parsed ?? guidance
  return {
    text: start ? formatStoryTime(normalizeTime(start)) : '',
    source: parsed ? 'returned' : start ? 'guidance' : null,
  }
}

/**
 * A vault scenario's start, when it has an opening for the start to belong to. Without one it
 * would satisfy the wizard's starting-time guard for an opening never chosen.
 */
export function scenarioOpeningStart(scenario: {
  firstMessage?: string | null
  startingTime?: TimeTracker | null
}): TimeTracker | null {
  return scenario.firstMessage ? (scenario.startingTime ?? null) : null
}

/** The start shown beside an imported greeting: the scenario's describes its first message only. */
export function greetingStart(index: number, scenarioStart: TimeTracker | null): string {
  return index === 0 && scenarioStart ? formatStoryTime(scenarioStart) : ''
}

/** The value the opening prompts are given for the start. */
export function startingTimePromptValue(start: TimeTracker | null | undefined): string {
  return start ? formatStoryTime(start) : SUGGEST_ONE
}
