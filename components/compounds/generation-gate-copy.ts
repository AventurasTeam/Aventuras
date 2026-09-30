import { t } from '@/lib/i18n'

/** A gated action's disabled reason: its own reason, else the shared generation-gate text. */
export function gateDisabledReason(blocked: boolean, blockedReason?: string): string | undefined {
  if (!blocked) return undefined
  return blockedReason ?? t('common:generationGate.inFlight')
}
