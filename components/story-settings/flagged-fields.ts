import { t } from '@/lib/i18n'

import type { FlaggedField } from './save-session-state'

/** story-settings.md → Flagged fields. */
const FLAGGED_FIELDS = {
  composerWrapPov: {
    labelKey: 'storySettings:generation.field.composerWrapPov',
    consequenceKey: 'storySettings:confirm.consequence.composerWrapPov',
  },
} as const

export type FlaggedFieldKey = keyof typeof FLAGGED_FIELDS

export function flaggedFieldsFor(keys: readonly FlaggedFieldKey[]): FlaggedField[] {
  return keys.map((key) => ({
    key,
    label: t(FLAGGED_FIELDS[key].labelKey),
    consequence: t(FLAGGED_FIELDS[key].consequenceKey),
  }))
}
