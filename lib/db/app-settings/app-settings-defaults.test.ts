import { describe, expect, it } from 'vitest'

import { BUNDLED_PACK_ID } from '@/lib/prompts'

import { APP_SETTINGS_DEFAULTS } from './app-settings-defaults'

describe('app-settings defaults', () => {
  it('seeds default story settings with the bundled pack id', () => {
    expect(APP_SETTINGS_DEFAULTS.defaultStorySettings.activePackId).toBe(BUNDLED_PACK_ID)
  })
})
