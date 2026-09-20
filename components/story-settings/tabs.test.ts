import { describe, expect, it } from 'vitest'

import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'

import {
  isStorySettingsTabId,
  STORY_SETTINGS_TAB_GROUPS,
  STORY_SETTINGS_TAB_IDS,
  storySettingsTabOrder,
  syncTabParam,
  type TabParamState,
} from './tabs'

describe('story-settings tabs', () => {
  // Written out rather than re-derived from the groups: this is the rail order the
  // user reads and the order the save bar lists dirty fields in, so a regroup has to
  // fail here instead of quietly renumbering both. Membership is asserted whole, not
  // as a list of group ids: moving a tab across the boundary leaves the flat order
  // untouched and only shows up as a tab sitting under the wrong rail header.
  it('registers the eight tabs in rail order, under the two groups that head them', () => {
    expect(STORY_SETTINGS_TAB_IDS).toEqual([
      'about',
      'generation',
      'models',
      'memory',
      'translation',
      'pack',
      'calendar',
      'advanced',
    ])
    expect(STORY_SETTINGS_TAB_GROUPS).toEqual([
      { id: 'story', tabs: ['about', 'generation'] },
      { id: 'settings', tabs: ['models', 'memory', 'translation', 'pack', 'calendar', 'advanced'] },
    ])
    expect(new Set(STORY_SETTINGS_TAB_IDS).size).toBe(STORY_SETTINGS_TAB_IDS.length)
  })

  it('ranks every tab by its rail position', () => {
    expect(storySettingsTabOrder('about')).toBe(0)
    expect(storySettingsTabOrder('generation')).toBe(1)
    expect(storySettingsTabOrder('models')).toBe(2)
    expect(storySettingsTabOrder('advanced')).toBe(7)
  })

  // A tab added without its locale entry would ship the raw key as the rail
  // label, which reads as a rendering bug rather than a missing translation.
  it('resolves a label for every tab and a header for every group', () => {
    for (const id of STORY_SETTINGS_TAB_IDS) {
      expect(hasCopy(`storySettings:tabs.${id}`)).toBe(true)
    }
    for (const group of STORY_SETTINGS_TAB_GROUPS) {
      expect(hasCopy(`storySettings:groups.${group.id}`)).toBe(true)
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

  describe('syncTabParam', () => {
    // The mirrored param may land a render after the selection; comparing against
    // the selection instead would snap the user's pick back to the stale param.
    it('keeps a selection the unchanged param disagrees with', () => {
      const state: TabParamState = { selected: 'models', param: 'memory' }
      expect(syncTabParam(state, 'memory')).toBe(state)
    })

    it('opens the tab a changed param names', () => {
      expect(syncTabParam({ selected: 'about', param: 'about' }, 'memory')).toEqual({
        selected: 'memory',
        param: 'memory',
      })
    })

    it('records a changed param that names no tab without moving the selection', () => {
      expect(syncTabParam({ selected: null, param: 'memory' }, undefined)).toEqual({
        selected: null,
        param: undefined,
      })
      expect(syncTabParam({ selected: 'models', param: 'models' }, 'nope')).toEqual({
        selected: 'models',
        param: 'nope',
      })
    })
  })
})
