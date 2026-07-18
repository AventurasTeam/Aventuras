import { describe, expect, it, vi } from 'vitest'

import { announceStorySettingsResetConfirmation } from './accessibility'

const confirmationCopy = {
  title: 'Reset settings for Mornstone?',
  body: "This replaces only this story's settings with your current app defaults.",
  warning: 'The story definition, branches, entries, entities, and world data stay intact.',
}

describe('announceStorySettingsResetConfirmation', () => {
  it('announces the confirmation copy on Android', () => {
    const announceForAccessibility = vi.fn()

    announceStorySettingsResetConfirmation(confirmationCopy, 'android', announceForAccessibility)

    expect(announceForAccessibility).toHaveBeenCalledOnce()
    expect(announceForAccessibility).toHaveBeenCalledWith(
      `${confirmationCopy.title} ${confirmationCopy.body} ${confirmationCopy.warning}`,
    )
  })

  it('does not announce the confirmation copy on web', () => {
    const announceForAccessibility = vi.fn()

    announceStorySettingsResetConfirmation(confirmationCopy, 'web', announceForAccessibility)

    expect(announceForAccessibility).not.toHaveBeenCalled()
  })
})
