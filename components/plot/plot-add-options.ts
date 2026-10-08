import type { ImporterMenuOption } from '@/components/compounds/importer-menu'
import { t } from '@/lib/i18n'

type AddGate = { disabled?: boolean; disabledReason?: string }

/** import-dialog.md → Host gating during in-flight generation: Blank and From JSON share it. */
export function plotAddOptions(
  { onBlank, onJson }: { onBlank: () => void; onJson: () => void },
  gate: AddGate,
): ImporterMenuOption[] {
  return [
    {
      key: 'blank',
      label: t('plot:addMenu.blank'),
      disabled: gate.disabled,
      disabledReason: gate.disabledReason,
      onPress: onBlank,
    },
    {
      key: 'json',
      label: t('plot:addMenu.fromJson'),
      disabled: gate.disabled,
      disabledReason: gate.disabledReason,
      onPress: onJson,
    },
    {
      key: 'vault',
      label: t('plot:addMenu.fromVault'),
      disabled: true,
      disabledReason: t('plot:addMenu.fromVaultReason'),
    },
  ]
}
