import { useRouter, type Href } from 'expo-router'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

import type { EmbedderGateBlockedReason } from './finish'

// no-model / unknown-model / model-not-installed are local-model concerns → the
// embedding-models tab; no-provider is a provider-instance concern → memory.
// (no-model under a provider backend also lands on embedding-models; the local
// case dominates since the default backend is local.)
const SETTINGS_HREF_BY_REASON: Record<EmbedderGateBlockedReason, Href> = {
  'no-model': '/settings?tab=embedding-models' as Href,
  'unknown-model': '/settings?tab=embedding-models' as Href,
  'model-not-installed': '/settings?tab=embedding-models' as Href,
  'no-provider': '/settings?tab=memory' as Href,
}

const BODY_KEY_BY_REASON = {
  'no-model': 'wizard:embedGate.body.no-model',
  'unknown-model': 'wizard:embedGate.body.unknown-model',
  'model-not-installed': 'wizard:embedGate.body.model-not-installed',
  'no-provider': 'wizard:embedGate.body.no-provider',
} as const satisfies Record<EmbedderGateBlockedReason, string>

type EmbedderGateBlockedProps = {
  reason: EmbedderGateBlockedReason
}

export function EmbedderGateBlocked({ reason }: EmbedderGateBlockedProps) {
  const router = useRouter()
  return (
    <View className="flex-1 items-center justify-center px-6">
      <EmptyState title={t('wizard:embedGate.title')} subtext={t(BODY_KEY_BY_REASON[reason])} />
      <View className="mt-2 flex-row gap-3">
        <Button variant="secondary" onPress={() => router.back()}>
          <Text>{t('wizard:embedGate.back')}</Text>
        </Button>
        <Button onPress={() => router.push(SETTINGS_HREF_BY_REASON[reason])}>
          <Text>{t('wizard:embedGate.openSettings')}</Text>
        </Button>
      </View>
    </View>
  )
}

export type { EmbedderGateBlockedProps }
