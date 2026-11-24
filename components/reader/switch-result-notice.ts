import {
  generationGateReason,
  selectStorySettingsGenerationRunKind,
} from '@/components/story-settings/generation-run'
import type { SwitchBranchResult } from '@/lib/actions'
import { t } from '@/lib/i18n'
import type { TxState } from '@/lib/stores'

/**
 * Why the gate refuses a switch, read from the state when the result lands: the rendered reason is
 * stale by then, and may name the branch's own hold or a re-run hold, which refuse no switch.
 */
export function switchGateReason(txState: TxState, storyId: string | undefined): string {
  return (
    generationGateReason(true, selectStorySettingsGenerationRunKind(txState, storyId)) ??
    t('generationGate.inFlight')
  )
}

/**
 * A switch result's user notice (branch-navigator.md → Per-row anatomy). Landed, abandoned and
 * met-a-running-switch results say nothing: the paused rows already did. `gateReason`: computed
 * live when the result landed, without the branch's hold.
 */
export function switchResultNotice(
  result: SwitchBranchResult,
  gateReason: string,
): { kind: 'info' | 'error'; message: string } | null {
  switch (result.status) {
    case 'ok':
    case 'abandoned':
      return null
    case 'refused':
      if (result.code === 'running') return null
      if (result.code === 'gate' || result.code === 'turn-body')
        return { kind: 'info', message: gateReason }
      return { kind: 'error', message: t('reader:branches.switchFailed') }
    case 'failed':
      return { kind: 'error', message: t('reader:branches.switchFailed') }
  }
}
