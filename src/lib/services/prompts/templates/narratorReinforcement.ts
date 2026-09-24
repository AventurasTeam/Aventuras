/**
 * The `narratorReinforcement` template variable, which the narrative templates branch on to
 * decide how much of the narrator's role and the agency rules the turn message repeats.
 *
 * It reaches the template as the raw level, not as a formatted sentence, so a pack decides
 * what each level says.
 */

import {
  templateReferencesVariable,
  variableIsHonoured,
  type NarratorPrompts,
} from './templateReferences'

export type { NarratorPrompts }

/** The template variable this feeds. A prompt without it cannot honour the setting. */
export const NARRATOR_REINFORCEMENT_VAR = 'narratorReinforcement'

/** Whether a template would honour the setting at all. */
export function templateUsesNarratorReinforcement(content: string | null | undefined): boolean {
  return templateReferencesVariable(content, NARRATOR_REINFORCEMENT_VAR)
}

/** Whether the reinforcement setting can take effect for a story. */
export function narratorReinforcementIsHonoured(prompts: NarratorPrompts): boolean {
  return variableIsHonoured(NARRATOR_REINFORCEMENT_VAR, prompts)
}
