import { describe, expect, it } from 'vitest'

import { t } from '@/lib/i18n'
import { hasCopy } from '@/lib/i18n/__tests__/locale-keys'

import { flaggedFieldsFor } from './flagged-fields'

describe('flaggedFieldsFor', () => {
  it('resolves each key to its label and consequence copy, in the order given', () => {
    expect(flaggedFieldsFor(['composerWrapPov'])).toEqual([
      {
        key: 'composerWrapPov',
        label: t('storySettings:generation.field.composerWrapPov'),
        consequence: t('storySettings:confirm.consequence.composerWrapPov'),
      },
    ])
  })

  it('is empty for no keys', () => {
    expect(flaggedFieldsFor([])).toEqual([])
  })

  // The assertion above resolves both sides through `t`, which echoes a key it
  // cannot find — so it would pass with the consent dialog showing a raw key.
  it('resolves real copy rather than echoing the keys', () => {
    const [field] = flaggedFieldsFor(['composerWrapPov'])

    expect(hasCopy('storySettings:generation.field.composerWrapPov')).toBe(true)
    expect(hasCopy('storySettings:confirm.consequence.composerWrapPov')).toBe(true)
    expect(field?.consequence).toContain('Do / Say / Think')
  })
})
