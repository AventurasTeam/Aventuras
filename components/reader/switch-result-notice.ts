import {
  generationGateReason,
  selectStorySettingsGenerationRunKind,
} from '@/components/story-settings/generation-run'
import type { SwitchBranchResult } from '@/lib/actions'
import { t } from '@/lib/i18n'
import { isStoryBusy, type TxState } from '@/lib/stores'

type SwitchNotice = { kind: 'info' | 'error'; message: string }
type RefusalCode = Extract<SwitchBranchResult, { status: 'refused' }>['code']

/** The live state a switch result is read against when it lands. */
export type SwitchLanding = {
  txState: TxState
  storyId: string
  /** The branch the switch left. */
  fromBranchId: string
  /** Whether a turn body is still active on `fromBranchId`. */
  turnBodyActive: boolean
}

/**
 * Why the gate refuses a switch, read from the state when the result lands: the rendered reason is
 * stale by then, and may name the reader hold or a restart hold, which refuse no switch.
 */
export function switchGateReason(txState: TxState, storyId: string): string {
  return generationGateReason(true, selectStorySettingsGenerationRunKind(txState, storyId))
}

/** A switch result's user notice (branch-navigator.md → Per-row anatomy), or null for none. */
export function switchResultNotice(
  result: SwitchBranchResult,
  landing: SwitchLanding,
): SwitchNotice | null {
  switch (result.status) {
    // The chip and the reader on the new branch are its evidence.
    case 'ok':
      return null
    // The user left.
    case 'abandoned':
      return null
    case 'refused':
      return refusalNotice(result.code, landing)
    case 'failed':
      // A run or turn body that started during the reads blocked the reset as the gate would have.
      return result.code === 'navigation-blocked' && leftBranchBusy(landing)
        ? gateNotice(landing)
        : failedNotice()
  }
}

function refusalNotice(code: RefusalCode, landing: SwitchLanding): SwitchNotice | null {
  switch (code) {
    // The paused rows already said it.
    case 'running':
      return null
    case 'gate':
    case 'turn-body':
      return gateNotice(landing)
    case 'missing':
      return failedNotice()
  }
}

// The reset's own check (switchBranch): the story busy from the branch left, or its turn body.
function leftBranchBusy(landing: SwitchLanding): boolean {
  return (
    isStoryBusy(landing.txState, landing.storyId, landing.fromBranchId) || landing.turnBodyActive
  )
}

function gateNotice(landing: SwitchLanding): SwitchNotice {
  return { kind: 'info', message: switchGateReason(landing.txState, landing.storyId) }
}

function failedNotice(): SwitchNotice {
  return { kind: 'error', message: t('reader:branches.switchFailed') }
}
