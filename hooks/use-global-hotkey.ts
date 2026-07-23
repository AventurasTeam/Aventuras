// Web-only global keydown shortcut. Centralizes the addEventListener/cleanup
// scaffold and the repeat/editable-target guards previously duplicated across
// save-bar, actions-menu, and the reader composer's undo/redo shortcut.
import { useEffect } from 'react'
import { Platform } from 'react-native'

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true
}

type UseGlobalHotkeyOptions = {
  capture?: boolean
  stopPropagation?: boolean
  ignoreEditableTargets?: boolean
  /**
   * Pass a screen's focus state. A pushed-under expo-router screen stays
   * mounted, so an ungated listener keeps firing from behind the new screen.
   */
  enabled?: boolean
}

export function useGlobalHotkey(
  matches: (event: KeyboardEvent) => boolean,
  onMatch: (event: KeyboardEvent) => void,
  {
    capture = false,
    stopPropagation = false,
    ignoreEditableTargets = false,
    enabled = true,
  }: UseGlobalHotkeyOptions = {},
): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return undefined
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (ignoreEditableTargets && isEditableTarget(event.target)) return
      if (!matches(event)) return
      event.preventDefault()
      if (stopPropagation) event.stopPropagation()
      onMatch(event)
    }
    window.addEventListener('keydown', handler, capture)
    return () => window.removeEventListener('keydown', handler, capture)
  }, [matches, onMatch, capture, stopPropagation, ignoreEditableTargets, enabled])
}
