import type { SwitchBranchResult } from '@/lib/actions'
import { t } from '@/lib/i18n'

/**
 * What a switch's result says to the user (branch-navigator.md → Per-row anatomy). A landed or
 * abandoned switch says nothing, and so does a press that met a running one: the paused rows
 * already said it. `gateReason`: the live reason the caller computed when the result landed,
 * without the branch's hold.
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
