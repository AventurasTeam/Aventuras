import { AccessibilityInfo, Platform } from 'react-native'

type StorySettingsResetConfirmationCopy = {
  title: string
  body: string
  warning: string
}

type AnnounceForAccessibility = (announcement: string) => void

export function announceStorySettingsResetConfirmation(
  copy: StorySettingsResetConfirmationCopy,
  platform = Platform.OS,
  announceForAccessibility: AnnounceForAccessibility = AccessibilityInfo.announceForAccessibility,
): void {
  if (platform !== 'android') return
  announceForAccessibility(`${copy.title} ${copy.body} ${copy.warning}`)
}
