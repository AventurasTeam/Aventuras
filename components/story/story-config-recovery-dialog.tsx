import { useEffect, useId, useRef, useState } from 'react'
import { Platform, View } from 'react-native'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import type { OpenFailureKind } from '@/lib/stores'

type StoryConfigRecoveryDialogProps = {
  open: boolean
  kind: OpenFailureKind
  storyName: string
  onOpenFile?: () => void | Promise<void>
  onReset: () => void | Promise<void>
  onDismiss: () => void
}

export function StoryConfigRecoveryDialog({
  open,
  kind,
  storyName,
  onOpenFile,
  onReset,
  onDismiss,
}: StoryConfigRecoveryDialogProps) {
  const [confirmingReset, setConfirmingReset] = useState(false)
  const restoreResetFocusRef = useRef(false)
  const focusId = useId()
  const resetButtonId = `${focusId}-reset`
  const cancelButtonId = `${focusId}-cancel`

  useEffect(() => {
    if (Platform.OS !== 'web') return
    if (confirmingReset) {
      document.getElementById(cancelButtonId)?.focus()
      return
    }
    if (restoreResetFocusRef.current) {
      restoreResetFocusRef.current = false
      document.getElementById(resetButtonId)?.focus()
    }
  }, [cancelButtonId, confirmingReset, resetButtonId])

  function dismiss() {
    restoreResetFocusRef.current = false
    setConfirmingReset(false)
    onDismiss()
  }

  function cancelReset() {
    restoreResetFocusRef.current = true
    setConfirmingReset(false)
  }

  function confirmReset() {
    restoreResetFocusRef.current = true
    setConfirmingReset(false)
    void onReset()
  }

  const title = confirmingReset
    ? t('landing:storyRecovery.confirmTitle', { storyName })
    : t(
        kind === 'definition-corrupt'
          ? 'landing:storyRecovery.definitionTitle'
          : 'landing:storyRecovery.settingsTitle',
        { storyName },
      )
  const body = confirmingReset
    ? t('landing:storyRecovery.confirmBody')
    : t(
        kind === 'definition-corrupt'
          ? 'landing:storyRecovery.definitionBody'
          : 'landing:storyRecovery.settingsBody',
      )

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>

        {confirmingReset ? (
          <Text variant="muted" size="sm">
            {t('landing:storyRecovery.confirmWarning')}
          </Text>
        ) : null}

        <AlertDialogFooter>
          {confirmingReset ? (
            <>
              <Button nativeID={cancelButtonId} variant="secondary" onPress={cancelReset}>
                <Text>{t('landing:storyRecovery.cancel')}</Text>
              </Button>
              <Button variant="destructive" onPress={confirmReset}>
                <Text>{t('landing:storyRecovery.confirmReset')}</Text>
              </Button>
            </>
          ) : (
            <View className="w-full gap-2">
              {onOpenFile ? (
                <Button variant="secondary" onPress={() => void onOpenFile()}>
                  <Text>{t('landing:storyRecovery.openFile')}</Text>
                </Button>
              ) : null}
              {kind === 'settings-corrupt' ? (
                <Button
                  nativeID={resetButtonId}
                  variant="destructive"
                  onPress={() => setConfirmingReset(true)}
                >
                  <Text>{t('landing:storyRecovery.resetStorySettings')}</Text>
                </Button>
              ) : null}
              <AlertDialogCancel asChild>
                <Button variant="secondary">
                  <Text>{t('landing:storyRecovery.dismiss')}</Text>
                </Button>
              </AlertDialogCancel>
            </View>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { StoryConfigRecoveryDialogProps }
