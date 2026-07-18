import { Platform } from 'react-native'

type DatabaseFileRevealBridge = {
  revealDbFile(): Promise<void>
}

function currentBridge(): DatabaseFileRevealBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return window.native
}

export function getDatabaseFileRevealAction(
  platform = Platform.OS,
  bridge = currentBridge(),
): (() => Promise<void>) | undefined {
  if (platform !== 'web' || bridge == null) return undefined
  return () => bridge.revealDbFile()
}
