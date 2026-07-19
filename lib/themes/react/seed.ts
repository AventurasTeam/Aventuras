import { themes as registryThemes } from '../core/registry'
import type { Theme } from '../types'

export function pickInitialTheme(prefersDark: boolean): Theme {
  if (prefersDark) {
    const firstDark = registryThemes.find((t) => t.mode === 'dark')
    if (firstDark) return firstDark
  }
  return registryThemes[0]
}

/**
 * `'system'` (the schema default), absent, and unknown ids seed from the OS
 * scheme; a concrete registry id is a user pick and always wins over the OS.
 */
export function resolveInitialTheme(
  initialThemeId: string | undefined,
  prefersDark: boolean,
): Theme {
  if (initialThemeId && initialThemeId !== 'system') {
    const explicit = registryThemes.find((t) => t.id === initialThemeId)
    if (explicit) return explicit
  }
  return pickInitialTheme(prefersDark)
}
