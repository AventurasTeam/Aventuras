/**
 * The `targetResponseLength` template variable, which the narrative templates branch on to
 * decide how long they ask each response to be: `dynamic`, `short`, `medium` or `long`.
 *
 * It reaches the template as the raw value, not as a formatted sentence, so a pack decides
 * what each length asks for.
 */

import {
  templateReferencesVariable,
  variableIsHonoured,
  type NarratorPrompts,
} from './templateReferences'

/** The template variable this feeds. A prompt without it cannot honour the setting. */
export const TARGET_RESPONSE_LENGTH_VAR = 'targetResponseLength'

/** Whether a template would honour the setting at all. */
export function templateUsesTargetResponseLength(content: string | null | undefined): boolean {
  return templateReferencesVariable(content, TARGET_RESPONSE_LENGTH_VAR)
}

/** Whether the Response Length setting can take effect for a story. */
export function targetResponseLengthIsHonoured(prompts: NarratorPrompts): boolean {
  return variableIsHonoured(TARGET_RESPONSE_LENGTH_VAR, prompts)
}
