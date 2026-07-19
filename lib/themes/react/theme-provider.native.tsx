import { vars } from 'nativewind'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { View, useColorScheme } from 'react-native'

import { resolveInitialTheme } from './seed'
import { ThemeContext, type ThemeContextValue } from './theme-context'
import { themes as registryThemes } from '../core/registry'

type ThemeProviderProps = {
  children: ReactNode
  /** Persisted theme id. `'system'`, absent, or unknown → seed from the OS scheme. */
  initialThemeId?: string
  /**
   * Fires on every accepted `setTheme` — the persistence write-through hook.
   * Never fired for the mount seed, so an OS-derived seed can't overwrite a
   * persisted `'system'`.
   */
  onThemeChange?: (id: string) => void
}

export function ThemeProvider({ children, initialThemeId, onThemeChange }: ThemeProviderProps) {
  const colorScheme = useColorScheme()
  const [activeId, setActiveId] = useState<string>(
    () => resolveInitialTheme(initialThemeId, colorScheme === 'dark').id,
  )
  const setTheme = useCallback(
    (id: string) => {
      if (!registryThemes.some((t) => t.id === id)) return
      setActiveId(id)
      onThemeChange?.(id)
    },
    [onThemeChange],
  )
  const { theme, themeVars } = useMemo(() => {
    const t = registryThemes.find((x) => x.id === activeId) ?? registryThemes[0]
    return {
      theme: t,
      themeVars: vars({ ...t.colors, ...(t.fonts ?? {}) }),
    }
  }, [activeId])
  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, themes: registryThemes }),
    [theme, setTheme],
  )
  return (
    <ThemeContext.Provider value={value}>
      <View className="flex-1" style={themeVars}>
        {children}
      </View>
    </ThemeContext.Provider>
  )
}
