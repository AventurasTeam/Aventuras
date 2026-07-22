import { describe, expect, it } from 'vitest'

import { t } from '@/lib/i18n'

import {
  isStorySettingsTabId,
  STORY_SETTINGS_TAB_GROUPS,
  STORY_SETTINGS_TAB_IDS,
  storySettingsTabOrder,
} from './tabs'

describe('story-settings tabs', () => {
  it('registers every group tab exactly once', () => {
    const flattened = STORY_SETTINGS_TAB_GROUPS.flatMap((group) => group.tabs)
    expect(STORY_SETTINGS_TAB_IDS).toEqual(flattened)
    expect(new Set(STORY_SETTINGS_TAB_IDS).size).toBe(STORY_SETTINGS_TAB_IDS.length)
  })

  it('ranks every tab by its rail position', () => {
    const orders = STORY_SETTINGS_TAB_IDS.map(storySettingsTabOrder)
    expect(orders).toEqual(STORY_SETTINGS_TAB_IDS.map((_, index) => index))
  })

  // A tab added without its locale entry would ship the raw key as the rail
  // label, which reads as a rendering bug rather than a missing translation.
  it('resolves a label for every tab and a header for every group', () => {
    for (const id of STORY_SETTINGS_TAB_IDS) {
      const key = `storySettings:tabs.${id}` as const
      expect(t(key)).not.toBe(key)
    }
    for (const group of STORY_SETTINGS_TAB_GROUPS) {
      const key = `storySettings:groups.${group.id}` as const
      expect(t(key)).not.toBe(key)
    }
  })

  describe('isStorySettingsTabId', () => {
    it('accepts every registered id', () => {
      expect(STORY_SETTINGS_TAB_IDS.every(isStorySettingsTabId)).toBe(true)
    })

    it('rejects an unregistered id, a wrong case, and undefined', () => {
      expect(isStorySettingsTabId('nope')).toBe(false)
      expect(isStorySettingsTabId('Advanced')).toBe(false)
      expect(isStorySettingsTabId(undefined)).toBe(false)
    })
  })
})
