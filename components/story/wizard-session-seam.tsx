import type { ReactNode } from 'react'

export type ConcurrentTrigger = 'new-story' | 'draft'

export type ConcurrentStatePromptProps = {
  trigger: ConcurrentTrigger
  draftName?: string
  onContinueSession: () => void
  onDiscard: () => void
  onDismiss: () => void
}

// PLACEHOLDER for Slice 2.3 (milestone C5). Returns "no session" so the prompt
// path stays dormant until 2.3 lands the persisted wizard session store.
export function useWizardSessionExists(): boolean {
  return false
}

// PLACEHOLDER for Slice 2.3. Real prompt UI lands with the wizard session.
export function ConcurrentStatePrompt(_props: ConcurrentStatePromptProps): ReactNode {
  return null
}
