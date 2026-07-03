import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

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
  trigger: ConcurrentTrigger
  draftName?: string
  onContinueSession: () => void
  onDiscard: () => void
  onDismiss: () => void
}

const ctx = { db, runInTransaction }

// Focus-aware: cancelling out of the wizard back to the landing screen must
// clear a stale `true` from a previous visit, so the check re-runs on every
// focus, not just on first mount.
export function useWizardSessionExists(): boolean {
  const [exists, setExists] = useState(false)

  const check = useCallback(() => {
    let cancelled = false
    void sessionExists(ctx).then((result) => {
      if (!cancelled) setExists(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => check(), [check])
  useFocusEffect(check)

  return exists
}

export function ConcurrentStatePrompt({
  trigger,
  draftName,
  onContinueSession,
  onDiscard,
  onDismiss,
}: ConcurrentStatePromptProps): ReactNode {
  const isDraft = trigger === 'draft'
  const name = draftName ?? t('landing:concurrentSession.untitledDraft')

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('landing:concurrentSession.title')}</DialogTitle>
          <DialogDescription>
            {isDraft
              ? t('landing:concurrentSession.draft.body', { draftName: name })
              : t('landing:concurrentSession.newStory.body')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="destructive" onPress={onDiscard}>
            <Text>
              {isDraft
                ? t('landing:concurrentSession.draft.discard', { draftName: name })
                : t('landing:concurrentSession.newStory.discard')}
            </Text>
          </Button>
          <Button variant="primary" onPress={onContinueSession}>
            <Text>
              {isDraft
                ? t('landing:concurrentSession.draft.continue')
                : t('landing:concurrentSession.newStory.continue')}
            </Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
