import type { NarratorPrompts } from './templateReferences'
import { TARGET_RESPONSE_LENGTH_VAR, targetResponseLengthIsHonoured } from './targetResponseLength'
import {
  NARRATOR_REINFORCEMENT_VAR,
  narratorReinforcementIsHonoured,
} from './narratorReinforcement'

/** Why each narrator setting would have no effect, or `undefined` where it works. */
export interface NarratorSettingAvailability {
  targetResponseLength?: string
  narratorReinforcement?: string
}

export function narratorSettingAvailability(prompts: NarratorPrompts): NarratorSettingAvailability {
  const custom = !!prompts.customSystemPrompt
  return {
    targetResponseLength: targetResponseLengthIsHonoured(prompts)
      ? undefined
      : custom
        ? `Neither the custom system prompt nor the pack's turn message references ` +
          `{{ ${TARGET_RESPONSE_LENGTH_VAR} }}, so this setting would have no effect. Branch on ` +
          `it under # Format in the custom prompt.`
        : `Neither of the prompt pack's narrator prompts references ` +
          `{{ ${TARGET_RESPONSE_LENGTH_VAR} }}, so this setting would have no effect. Branch on ` +
          `it under # Format in the pack's narrator template, or choose a pack that has it.`,
    narratorReinforcement: narratorReinforcementIsHonoured(prompts)
      ? undefined
      : `Neither narrator prompt references {{ ${NARRATOR_REINFORCEMENT_VAR} }}, so this ` +
        `setting would have no effect. Add it to the narrator turn message in the prompt pack, ` +
        `or choose a pack that has it.`,
  }
}
