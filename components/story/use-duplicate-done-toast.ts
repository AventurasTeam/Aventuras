import { useCallback, useEffect, useRef } from 'react'

import { useAliveRef } from '@/components/reader/use-alive-ref'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

/**
 * story-list.md → Duplicate a story, Done: the toast's `Open` belongs to the list. It acts only
 * while the list has focus and no list confirm is up, and the toast goes when focus leaves.
 */
export function useDuplicateDoneToast({
  focused,
  blocked,
  open,
}: {
  focused: boolean
  /** A list confirm is up: on native the toast sits above it. */
  blocked: boolean
  open: (storyId: string) => void
}): (copy: { storyId: string; title: string }) => void {
  const toastId = useRef<string | null>(null)
  // A copy can land after the list unmounts.
  const mountedRef = useAliveRef()
  // Read at the press: the toast is mounted at the root and outlives the list's focus.
  const live = useRef({ focused, blocked, open })
  useEffect(() => {
    live.current = { focused, blocked, open }
  })

  const dismissShown = useCallback(() => {
    if (toastId.current != null) toast.dismiss(toastId.current)
    toastId.current = null
  }, [])

  useEffect(() => {
    if (!focused) dismissShown()
  }, [focused, dismissShown])
  useEffect(() => dismissShown, [dismissShown])

  return useCallback(
    ({ storyId, title }: { storyId: string; title: string }) => {
      // The blur dismissal has already run, so a toast shown now would outlast it over a reader.
      if (!mountedRef.current || !live.current.focused) return
      dismissShown()
      toastId.current = toast.info(t('landing:duplicate.done', { name: title }), {
        action: {
          label: t('landing:duplicate.open'),
          onPress: () => {
            const { focused: isFocused, blocked: isBlocked, open: openCopy } = live.current
            if (mountedRef.current && isFocused && !isBlocked) openCopy(storyId)
          },
        },
      })
    },
    [dismissShown, mountedRef],
  )
}
