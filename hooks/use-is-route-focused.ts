import { NavigationContext } from '@react-navigation/native'
import { useCallback, useContext, useSyncExternalStore } from 'react'

/**
 * Whether the calling screen currently owns the navigator, reporting `true` when there is
 * no navigator at all.
 *
 * Same subscription `useIsFocused` builds, minus its `useNavigation` throw: a component
 * that also mounts outside a navigator (a story, a dev route) can call this unconditionally.
 * Nothing competes for a window-level shortcut there, so unfocused is not a state that
 * exists — reporting focused is the honest answer, not a fallback.
 */
export function useIsRouteFocused(): boolean {
  const navigation = useContext(NavigationContext)
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (navigation == null) return () => {}
      const offFocus = navigation.addListener('focus', onStoreChange)
      const offBlur = navigation.addListener('blur', onStoreChange)
      return () => {
        offFocus()
        offBlur()
      }
    },
    [navigation],
  )
  const read = useCallback(() => navigation?.isFocused() ?? true, [navigation])
  return useSyncExternalStore(subscribe, read, read)
}
