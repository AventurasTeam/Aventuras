import { useFocusEffect } from 'expo-router'
import { useCallback, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Text } from '@/components/ui/text'
import { sessionExists } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { t } from '@/lib/i18n'

export type ConcurrentTrigger = 'new-story' | 'draft'

export type ConcurrentStatePromptProps = {
  open: boolean
  trigger: ConcurrentTrigger
  draftName?: string
  onContinueSession: () => void
  onDiscard: () => void
  onDismiss: () => void
}

const ctx = { db, runInTransaction }

// Focus-aware: `useFocusEffect` fires on initial focus (mount) AND on every
// refocus, so cancelling out of the wizard back to the landing screen clears a
// stale `true` from a previous visit. Focus-effect alone (no companion
// `useEffect`) matches the sibling precedent in hooks/use-master-detail-back.ts;
// the returned cleanup's `cancelled` guard drops an in-flight fetch on blur so a
// late resolve can't overwrite a newer focus-triggered result.
export function useWizardSessionExists(): boolean {
  const [exists, setExists] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void sessionExists(ctx).then((result) => {
        if (!cancelled) setExists(result)
      })
      return () => {
        cancelled = true
      }
    }, []),
  )

  return exists
}

export function ConcurrentStatePrompt({
  open,
  trigger,
  draftName,
  onContinueSession,
  onDiscard,
  onDismiss,
}: ConcurrentStatePromptProps): ReactNode {
  const isDraft = trigger === 'draft'
  const name = draftName ?? t('landing:concurrentSession.untitledDraft')

  const copy = isDraft
    ? {
        body: t('landing:concurrentSession.draft.body', { draftName: name }),
        discard: t('landing:concurrentSession.draft.discard', { draftName: name }),
        continue: t('landing:concurrentSession.draft.continue'),
      }
    : {
        body: t('landing:concurrentSession.newStory.body'),
        discard: t('landing:concurrentSession.newStory.discard'),
        continue: t('landing:concurrentSession.newStory.continue'),
      }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('landing:concurrentSession.title')}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        {/* Discard left / Continue (primary) right — matches embedder-download-dialog's Cancel-left/primary-right convention. */}
        <DialogFooter>
          <Button variant="destructive" onPress={onDiscard}>
            <Text>{copy.discard}</Text>
          </Button>
          <Button variant="primary" onPress={onContinueSession}>
            <Text>{copy.continue}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
