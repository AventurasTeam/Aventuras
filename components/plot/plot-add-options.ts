import type { ImporterMenuOption } from '@/components/compounds/importer-menu'
import { t } from '@/lib/i18n'

type BlankGate = { disabled?: boolean; disabledReason?: string }

/** The `[+]` menu; Blank is live, JSON and Vault import are disabled placeholders. */
export function plotAddOptions(onBlank: () => void, blank: BlankGate): ImporterMenuOption[] {
  return [
    {
      key: 'blank',
      label: t('plot:addMenu.blank'),
      disabled: blank.disabled,
      disabledReason: blank.disabledReason,
      onPress: onBlank,
    },
    {
      key: 'json',
      label: t('plot:addMenu.fromJson'),
      disabled: true,
      disabledReason: t('plot:addMenu.fromJsonReason'),
    },
    {
      key: 'vault',
      label: t('plot:addMenu.fromVault'),
      disabled: true,
      disabledReason: t('plot:addMenu.fromVaultReason'),
    },
  ]
}
