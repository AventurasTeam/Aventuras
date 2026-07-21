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

// Routed by the act the user must perform, not by reason alone: downloading is
// the embedding-models tab's job, and everything else is a *selection*, which
// lives on the memory tab next to the backend picker. Reason alone would send a
// provider-backend user with no model name to the local ONNX catalog.
const INSTALL_TAB = '/settings?tab=embedding-models' as Href
const SELECT_TAB = '/settings?tab=memory' as Href

function settingsHref(reason: EmbedderGateBlockedReason): Href {
  return reason === 'model-not-installed' ? INSTALL_TAB : SELECT_TAB
}

const BODY_KEY_BY_REASON = {
  'no-model': 'wizard:embedGate.body.no-model',
  'unknown-model': 'wizard:embedGate.body.unknown-model',
  'model-not-installed': 'wizard:embedGate.body.model-not-installed',
  'no-provider': 'wizard:embedGate.body.no-provider',
  'provider-cannot-embed': 'wizard:embedGate.body.provider-cannot-embed',
} as const satisfies Record<EmbedderGateBlockedReason, string>

type EmbedderGateBlockedProps = {
  reason: EmbedderGateBlockedReason
  backend: 'local' | 'provider'
}

// Modal over the wizard shell (autosave-continue precedent) rather than a
// fullscreen takeover. The gate stays hard: every exit leaves the wizard —
// Escape / system back resolve to router.back(), never into the steps.
export function EmbedderGateBlocked({ reason, backend }: EmbedderGateBlockedProps) {
  const router = useRouter()
  // 'no-model' is the one reason whose copy depends on the backend: local means
  // "pick a model", provider means "type a model name".
  const bodyKey =
    backend === 'provider' && reason === 'no-model'
      ? ('wizard:embedGate.body.no-model-provider' as const)
      : BODY_KEY_BY_REASON[reason]
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
          <AlertDialogDescription>{t(bodyKey)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="secondary" onPress={() => router.back()}>
            <Text>{t('wizard:embedGate.back')}</Text>
          </Button>
          <Button onPress={() => router.push(settingsHref(reason))}>
            <Text>{t('wizard:embedGate.openSettings')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { EmbedderGateBlockedProps }

type EmbedderGateUnresolvedProps = {
  message: string
  onRetry: () => void
}

// Distinct from EmbedderGateBlocked: the embedder may well be fine and we
// simply couldn't read the installed list, so the affordance is Retry rather
// than a settings route that wouldn't fix the underlying cause.
export function EmbedderGateUnresolved({ message, onRetry }: EmbedderGateUnresolvedProps) {
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
          <AlertDialogTitle>{t('wizard:embedGate.unresolved.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('wizard:embedGate.unresolved.body', { error: message })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="secondary" onPress={() => router.back()}>
            <Text>{t('wizard:embedGate.back')}</Text>
          </Button>
          <Button onPress={onRetry}>
            <Text>{t('wizard:embedGate.unresolved.retry')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { EmbedderGateUnresolvedProps }
