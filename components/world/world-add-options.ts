import type { ImporterMenuOption } from '@/components/compounds/importer-menu'
import { t } from '@/lib/i18n'
import type { WorldCategory } from '@/lib/list-modules'

export function worldAddOptions(category: WorldCategory): ImporterMenuOption[] {
  return [
    {
      key: 'blank',
      label: t('world:addMenu.blank'),
      disabled: true,
      disabledReason:
        category === 'lore'
          ? t('world:addMenu.blankLoreReason')
          : t('world:addMenu.blankEntityReason'),
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
