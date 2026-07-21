import { useRouter, type Href } from 'expo-router'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
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

// Modal over the wizard shell (autosave-continue precedent) rather than a
// fullscreen takeover. The gate stays hard: every exit leaves the wizard —
// Escape / system back resolve to router.back(), never into the steps.
export function EmbedderGateBlocked({ reason }: EmbedderGateBlockedProps) {
  const router = useRouter()
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) router.back()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('wizard:embedGate.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t(BODY_KEY_BY_REASON[reason])}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="secondary" onPress={() => router.back()}>
            <Text>{t('wizard:embedGate.back')}</Text>
          </Button>
          <Button onPress={() => router.push(SETTINGS_HREF_BY_REASON[reason])}>
            <Text>{t('wizard:embedGate.openSettings')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { EmbedderGateBlockedProps }
