import { t } from '@/lib/i18n'

import type { ImporterMenuOption } from './importer-menu'

type AddGate = { disabled?: boolean; disabledReason?: string }

/**
 * A World or Plot list's `[+]` options, worded from that surface's `addMenu` copy.
 * import-dialog.md → Host gating during in-flight generation: Blank and From JSON share the gate.
 */
export function rowAddOptions(
  surface: 'world' | 'plot',
  { onBlank, onJson }: { onBlank: () => void; onJson: () => void },
  gate: AddGate,
): ImporterMenuOption[] {
  return [
    {
      key: 'blank',
      label: t(`${surface}:addMenu.blank`),
      disabled: gate.disabled,
      disabledReason: gate.disabledReason,
      onPress: onBlank,
    },
    {
      key: 'json',
      label: t(`${surface}:addMenu.fromJson`),
      disabled: gate.disabled,
      disabledReason: gate.disabledReason,
      onPress: onJson,
    },
  ]
}
