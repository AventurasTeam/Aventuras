import type { InjectionMode } from '@/lib/db'
import { t } from '@/lib/i18n'

/** Which row kind's wording a mode's explanation takes. */
export type InjectionHelp = 'entity' | 'lore' | 'thread'

const INJECTION_HELP: Record<InjectionHelp, (mode: InjectionMode) => string> = {
  entity: (mode) => t(`world:fields.injection.${mode}Help`),
  lore: (mode) => t(`world:lore.injection.${mode}Help`),
  thread: (mode) => t(`plot:fields.injection.${mode}Help`),
}

/**
 * The Settings select's explanation of a mode, which the Overview chip's tooltip repeats
 * (world.md → Overview), so the two can't drift.
 */
export function injectionHelpText(help: InjectionHelp, mode: InjectionMode): string {
  return INJECTION_HELP[help](mode)
}
