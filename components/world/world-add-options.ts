import type { ImporterMenuOption } from '@/components/compounds/importer-menu'
import { t } from '@/lib/i18n'

type AddGate = { disabled?: boolean; disabledReason?: string }

/** world.md → Per-row import: Blank and From JSON share the in-flight gate. */
export function worldAddOptions(
  { onBlank, onJson }: { onBlank: () => void; onJson: () => void },
  gate: AddGate,
): ImporterMenuOption[] {
  return [
    {
      key: 'blank',
      label: t('world:addMenu.blank'),
      disabled: gate.disabled,
      disabledReason: gate.disabledReason,
      onPress: onBlank,
    },
    {
      key: 'json',
      label: t('world:addMenu.fromJson'),
      disabled: gate.disabled,
      disabledReason: gate.disabledReason,
      onPress: onJson,
    },
    {
      key: 'vault',
      label: t('world:addMenu.fromVault'),
      disabled: true,
      disabledReason: t('world:addMenu.fromVaultReason'),
    },
  ]
}
