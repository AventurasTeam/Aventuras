import type { ImporterMenuOption } from '@/components/compounds/importer-menu'
import { t } from '@/lib/i18n'

type BlankGate = { disabled?: boolean; disabledReason?: string }

export function worldAddOptions(onBlank: () => void, blank: BlankGate): ImporterMenuOption[] {
  return [
    {
      key: 'blank',
      label: t('world:addMenu.blank'),
      disabled: blank.disabled,
      disabledReason: blank.disabledReason,
      onPress: onBlank,
    },
    {
      key: 'json',
      label: t('world:addMenu.fromJson'),
      disabled: true,
      disabledReason: t('world:addMenu.fromJsonReason'),
    },
    {
      key: 'vault',
      label: t('world:addMenu.fromVault'),
      disabled: true,
      disabledReason: t('world:addMenu.fromVaultReason'),
    },
  ]
}
