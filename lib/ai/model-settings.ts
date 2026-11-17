import type { ModelSettings } from '../db'
import type { StoryOverrideTarget } from './agents'

// Which slots hold each field (patterns/model-settings.md → Which fields an owner shows). Keyed by
// every field, so one ModelSettings gains is a type error until its slots are listed here.
const FIELD_SLOTS = {
  temperature: 'all',
  maxOutput: 'all',
  thinking: 'all',
  timeout: 'all',
  structuredOutput: 'agents',
  customJson: 'all',
} as const satisfies Record<keyof ModelSettings, 'all' | 'agents'>

const FIELDS = Object.keys(FIELD_SLOTS) as (keyof ModelSettings)[]

/** An owner's call settings: a profile's or an override's, without their identity, unset dropped. */
export function modelSettingsOf(owner: ModelSettings): ModelSettings {
  return Object.fromEntries(
    FIELDS.flatMap((field) => (owner[field] === undefined ? [] : [[field, owner[field]]])),
  ) as ModelSettings
}

/** The fields a story's override for `target` holds. */
export function overrideFieldsOf(target: StoryOverrideTarget): readonly (keyof ModelSettings)[] {
  return FIELDS.filter((field) => FIELD_SLOTS[field] === 'all' || target !== 'narrative')
}

/** `settings` limited to the fields `target`'s override holds, as copied when it's made. */
export function overrideSettingsOf(
  target: StoryOverrideTarget,
  settings: ModelSettings,
): ModelSettings {
  const fields = overrideFieldsOf(target)
  return Object.fromEntries(
    Object.entries(modelSettingsOf(settings)).filter(([field]) =>
      fields.includes(field as keyof ModelSettings),
    ),
  ) as ModelSettings
}
