import type { ImporterMenuOption } from '@/components/compounds/importer-menu'
import { t } from '@/lib/i18n'
import type { WorldCategory } from '@/lib/list-modules'

type BlankGate = { disabled?: boolean; disabledReason?: string }

export function worldAddOptions(
  category: WorldCategory,
  onBlank: () => void,
  blank: BlankGate,
): ImporterMenuOption[] {
  return [
    category === 'lore'
      ? {
          key: 'blank',
          label: t('world:addMenu.blank'),
          disabled: true,
          disabledReason: t('world:addMenu.blankLoreReason'),
        }
      : {
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
