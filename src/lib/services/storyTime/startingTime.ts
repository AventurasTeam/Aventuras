/**
 * The time a new story starts at, where the wizard's opening step reads it from and what it tells
 * generation.
 *
 * Each opening the step offers carries its own start, so nothing here arbitrates between them:
 * the start belonging to the opening that is used is the one that seeds the story.
 */

import type { TimeTracker } from '$lib/types'
import { formatStoryTime } from './duration'

export const STARTING_TIME_VAR = 'storyStartingTime'

/** What an empty start is sent as, the same request an empty title makes. */
export const SUGGEST_ONE = '(suggest one)'

/** Whether a template body would render the start at all. */
export function templateReceivesStartingTime(content: string | null | undefined): boolean {
  return !!content && new RegExp(`{{\\s*${STARTING_TIME_VAR}\\b`).test(content)
}

/** The value the opening prompts are given for the start. */
export function startingTimePromptValue(start: TimeTracker | null | undefined): string {
  return start ? formatStoryTime(start) : SUGGEST_ONE
}
