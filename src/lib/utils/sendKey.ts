import { isIos } from './platform'
import { isTouchDevice } from './swipe'

export type SendKeyPlatform = 'desktop' | 'touch' | 'ios'

type SendKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'keyCode'
>

export function sendKeyPlatform(): SendKeyPlatform {
  if (isIos()) return 'ios'
  return isTouchDevice() ? 'touch' : 'desktop'
}

/**
 * Whether a keydown in a chat box should send rather than insert a newline. On iOS the soft
 * keyboard reports `shiftKey` whenever auto-capitalisation has Shift engaged, so Shift+Return
 * cannot mean "send" there; only ⌘/Ctrl+Return does.
 */
export function isSendKey(e: SendKeyEvent, platform: SendKeyPlatform): boolean {
  // WebKit sends the Enter that commits an IME composition with `isComposing` false but keyCode 229.
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return false
  if (e.ctrlKey || e.metaKey) return true
  switch (platform) {
    case 'desktop':
      return !e.shiftKey
    case 'touch':
      return e.shiftKey
    case 'ios':
      return false
    default: {
      const exhaustive: never = platform
      return exhaustive
    }
  }
}

export function sendKeyHint(platform: SendKeyPlatform): string {
  switch (platform) {
    case 'desktop':
      return 'Enter to send, Shift+Enter for new line'
    case 'touch':
      return 'Shift+Enter to send, Enter for new line'
    case 'ios':
      return '⌘+Return to send, Return for new line'
    default: {
      const exhaustive: never = platform
      return exhaustive
    }
  }
}
