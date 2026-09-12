import { useRouter } from 'expo-router'
import { useCallback } from 'react'

import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

/** Leaves a story that failed to open: back to the story list, with the failure as a toast. */
export function useLeaveFailedStoryOpen(): () => void {
  const router = useRouter()
  return useCallback(() => {
    toast.error(t('reader:hydrationFailedTitle'))
    router.dismissTo('/')
  }, [router])
}
