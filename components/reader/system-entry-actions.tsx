import { useRouter } from 'expo-router'

import { t } from '@/lib/i18n'
import type { PipelineError } from '@/lib/pipeline'

export type SystemEntryFixAction = { label: string; onPress: () => void } | undefined

export function useSystemEntryActions(
  error: PipelineError | undefined,
  onRetry: () => void,
): { onRetry: () => void; fixAction: SystemEntryFixAction } {
  const router = useRouter()

  function navigateToProviderSettings() {
    router.push('/settings?tab=providers')
  }

  let fixAction: SystemEntryFixAction
  if (error?.kind === 'config-resolver') {
    const labelKey =
      error.failure === 'no-profile-assigned'
        ? 'reader:systemEntry.assignProfile'
        : error.failure === 'profile-missing'
          ? 'reader:systemEntry.fixProfile'
          : 'reader:systemEntry.fixDefault'
    fixAction = { label: t(labelKey), onPress: navigateToProviderSettings }
  }

  return { onRetry, fixAction }
}
