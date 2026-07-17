import { useRef, type ComponentRef } from 'react'
import { Platform } from 'react-native'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import type { RecoveryReport } from '@/lib/pipeline'
import { formatRecoveryReport, type RecoveryStoryNames } from '@/lib/recovery'

type CrashRecoveryModalProps = {
  open: boolean
  report: RecoveryReport
  storyNames: RecoveryStoryNames
  onAcknowledge: () => void
}

export function CrashRecoveryModal({
  open,
  report,
  storyNames,
  onAcknowledge,
}: CrashRecoveryModalProps) {
  const okActionRef = useRef<ComponentRef<typeof AlertDialogAction>>(null)

  return (
    <AlertDialog open={open} onOpenChange={() => undefined}>
      <AlertDialogContent
        onOpenAutoFocus={
          Platform.OS === 'web'
            ? (event) => {
                event.preventDefault()
                okActionRef.current?.focus()
              }
            : undefined
        }
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('crashRecovery.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {formatRecoveryReport(report, storyNames)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction ref={okActionRef} asChild>
            <Button onPress={onAcknowledge}>
              <Text>{t('crashRecovery.ok')}</Text>
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { CrashRecoveryModalProps }
