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
import { announceStorySettingsResetConfirmation } from '@/lib/recovery'
import type { OpenFailureKind } from '@/lib/stores'

type StoryConfigRecoveryDialogProps = {
  open: boolean
  kind: OpenFailureKind
  storyName: string
  onOpenFile?: () => void | Promise<void>
  onReset: () => void | Promise<void>
  onDismiss: () => void
}

type ConfirmationTarget = Pick<StoryConfigRecoveryDialogProps, 'kind' | 'storyName'>

export function StoryConfigRecoveryDialog({
  open,
  kind,
  storyName,
  onOpenFile,
  onReset,
  onDismiss,
}: StoryConfigRecoveryDialogProps) {
  const [confirmationTarget, setConfirmationTarget] = useState<ConfirmationTarget | null>(null)
  const restoreResetFocusRef = useRef(false)
  const focusId = useId()
  const resetButtonId = `${focusId}-reset`
  const cancelButtonId = `${focusId}-cancel`
  const confirmationTitle = t('landing:storyRecovery.confirmTitle', { storyName })
  const confirmationBody = t('landing:storyRecovery.confirmBody')
  const confirmationWarning = t('landing:storyRecovery.confirmWarning')
  const confirmingReset =
    open && confirmationTarget?.kind === kind && confirmationTarget.storyName === storyName

  useEffect(() => {
    restoreResetFocusRef.current = false
    setConfirmationTarget(null)
  }, [kind, open, storyName])

  useEffect(() => {
    if (confirmingReset) {
      if (Platform.OS === 'web') {
        document.getElementById(cancelButtonId)?.focus()
      } else {
        announceStorySettingsResetConfirmation({
          title: confirmationTitle,
          body: confirmationBody,
          warning: confirmationWarning,
        })
      }
      return
    }
    if (Platform.OS === 'web' && restoreResetFocusRef.current) {
      restoreResetFocusRef.current = false
      document.getElementById(resetButtonId)?.focus()
    }
  }, [
    cancelButtonId,
    confirmationBody,
    confirmationTitle,
    confirmationWarning,
    confirmingReset,
    resetButtonId,
  ])

  function dismiss() {
    restoreResetFocusRef.current = false
    setConfirmationTarget(null)
    onDismiss()
  }

  function cancelReset() {
    restoreResetFocusRef.current = true
    setConfirmationTarget(null)
  }

  function confirmReset() {
    restoreResetFocusRef.current = true
    setConfirmationTarget(null)
    void onReset()
  }

  const title = confirmingReset
    ? confirmationTitle
    : t(
        kind === 'definition-corrupt'
          ? 'landing:storyRecovery.definitionTitle'
          : 'landing:storyRecovery.settingsTitle',
        { storyName },
      )
  const body = confirmingReset
    ? confirmationBody
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
            {confirmationWarning}
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
                  onPress={() => setConfirmationTarget({ kind, storyName })}
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
