import type { ReactElement, RefObject } from 'react'
import { View } from 'react-native'

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

export type BranchDeleteConfirmProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  /** Entries no other branch of the story holds. */
  count: number
  /** The gate's or the swap's reason; disables `Delete branch` while set. */
  blockedReason?: string
  /** The delete is running: both buttons disable, and Esc and back wait for it. */
  pending?: boolean
  /** The last press threw; both buttons stay live for a retry or Cancel. */
  failed?: boolean
  portalHost?: string
  returnFocusTo?: RefObject<unknown>
  onDelete: () => void
}

function countLine(count: number): string {
  return count === 0
    ? t('reader:branches.deleteConfirm.countNone')
    : t('reader:branches.deleteConfirm.count', { count })
}

/** branch-navigator.md → Delete confirm, over the navigator's Popover or Sheet. */
export function BranchDeleteConfirm({
  open,
  onOpenChange,
  name,
  count,
  blockedReason,
  pending = false,
  failed = false,
  portalHost,
  returnFocusTo,
  onDelete,
}: BranchDeleteConfirmProps): ReactElement {
  function handleOpenChange(next: boolean) {
    // Escape and Android back land here too; the batch can't stop partway.
    if (!next && pending) return
    onOpenChange(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        portalHost={portalHost}
        returnFocusTo={returnFocusTo}
        busy={pending || blockedReason != null}
        aboveOpenPopover
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('reader:branches.deleteConfirm.title', { name })}</AlertDialogTitle>
          <AlertDialogDescription>
            <Text size="sm">{countLine(count)}</Text>
            <Text size="sm">{`\n\n${t('reader:branches.deleteConfirm.consequence')}`}</Text>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {blockedReason != null ? (
          <View role="status">
            <Text size="sm" variant="secondary">
              {blockedReason}
            </Text>
          </View>
        ) : failed ? (
          <View role="alert" accessibilityLiveRegion="assertive">
            <Text size="sm" className="text-danger">
              {t('reader:branches.deleteConfirm.failed')}
            </Text>
          </View>
        ) : null}
        <AlertDialogFooter>
          {/* AlertDialogCancel: Radix focuses an AlertDialog through its Cancel as it opens. */}
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={pending}>
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          {/* Plain button: AlertDialogAction also requests close, before the delete settles. */}
          <Button
            variant="destructive"
            disabled={blockedReason != null}
            loading={pending}
            disabledReason={blockedReason}
            onPress={onDelete}
          >
            <Text>{t('reader:branches.deleteConfirm.confirm')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
