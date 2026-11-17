import { describe, expect, it } from 'vitest'

import type { ModelOverride, ModelProfile } from '../db'
import { modelSettingsOf, overrideFieldsOf, overrideSettingsOf } from './model-settings'

const EVERY_SETTING = {
  temperature: 0.7,
  maxOutput: 4096,
  thinking: 1024,
  timeout: 60,
  structuredOutput: 'force-on',
  customJson: { top_k: 40 },
} as const

describe('modelSettingsOf', () => {
  it("keeps a profile's settings and drops what names the profile", () => {
    const profile: ModelProfile = {
      id: 'prof-1',
      kind: 'agent',
      name: 'Fast tasks',
      description: 'Cheap and quick.',
      modelRef: { providerId: 'prov-1', modelId: 'm' },
      ...EVERY_SETTING,
    }
    expect(modelSettingsOf(profile)).toStrictEqual(EVERY_SETTING)
  })

  it("drops an override's model and leaves an unset setting out", () => {
    const override: ModelOverride = {
      providerId: 'prov-1',
      modelId: 'm',
      maxOutput: 2048,
      temperature: undefined,
    }
    expect(modelSettingsOf(override)).toStrictEqual({ maxOutput: 2048 })
  })
})

// patterns/model-settings.md → Which fields an owner shows.
describe('overrideFieldsOf', () => {
  it('leaves structured output off the narrative override', () => {
    expect(overrideFieldsOf('narrative')).toStrictEqual([
      'temperature',
      'maxOutput',
      'thinking',
      'timeout',
      'customJson',
    ])
  })

  it.each(['classifier', 'translation', 'suggestion', 'lore-mgmt', 'retrieval'] as const)(
    'gives the %s override every field',
    (target) => {
      expect([...overrideFieldsOf(target)].sort()).toStrictEqual(Object.keys(EVERY_SETTING).sort())
    },
  )
})

describe('overrideSettingsOf', () => {
  it("copies a profile's settings onto a narrative override, without structured output", () => {
    const { structuredOutput: _dropped, ...rest } = EVERY_SETTING
    expect(overrideSettingsOf('narrative', EVERY_SETTING)).toStrictEqual(rest)
  })

  it('copies every setting onto an agent override', () => {
    expect(overrideSettingsOf('classifier', EVERY_SETTING)).toStrictEqual(EVERY_SETTING)
  })

  it('copies nothing it was not given', () => {
    expect(overrideSettingsOf('lore-mgmt', { timeout: 30 })).toStrictEqual({ timeout: 30 })
    expect(overrideSettingsOf('narrative', {})).toStrictEqual({})
  })
})
