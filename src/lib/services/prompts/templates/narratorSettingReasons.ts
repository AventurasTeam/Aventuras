import { variableIsHonoured, type NarratorPrompts } from './templateReferences'

/** Raw story settings the narrator templates branch on; a pack decides what each value says. */
export const TARGET_RESPONSE_LENGTH_VAR = 'targetResponseLength'
export const NARRATOR_REINFORCEMENT_VAR = 'narratorReinforcement'

/** Why each narrator setting would have no effect, or `undefined` where it works. */
export interface NarratorSettingReasons {
  targetResponseLength?: string
  narratorReinforcement?: string
}

export function narratorSettingReasons(prompts: NarratorPrompts): NarratorSettingReasons {
  const custom = !!prompts.customSystemPrompt
  return {
    targetResponseLength: variableIsHonoured(TARGET_RESPONSE_LENGTH_VAR, prompts)
      ? undefined
      : custom
        ? `Neither the custom system prompt nor the pack's turn message references ` +
          `{{ ${TARGET_RESPONSE_LENGTH_VAR} }}, so this setting would have no effect. Branch on ` +
          `it under # Format in the custom prompt.`
        : `Neither of the prompt pack's narrator prompts references ` +
          `{{ ${TARGET_RESPONSE_LENGTH_VAR} }}, so this setting would have no effect. Branch on ` +
          `it under # Format in the pack's narrator template, or choose a pack that has it.`,
    narratorReinforcement: variableIsHonoured(NARRATOR_REINFORCEMENT_VAR, prompts)
      ? undefined
      : `Neither narrator prompt references {{ ${NARRATOR_REINFORCEMENT_VAR} }}, so this ` +
        `setting would have no effect. Add it to the narrator turn message in the prompt pack, ` +
        `or choose a pack that has it.`,
  }
}
