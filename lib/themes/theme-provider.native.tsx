import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { View, useColorScheme } from 'react-native'
import { vars } from 'nativewind'
import { themes as registryThemes } from './registry'
import { ThemeContext, type ThemeContextValue } from './theme-context'
import type { Theme } from './types'

function pickInitialTheme(prefersDark: boolean): Theme {
  if (prefersDark) {
    const firstDark = registryThemes.find((t) => t.mode === 'dark')
    if (firstDark) return firstDark
  }
  return registryThemes[0]
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const colorScheme = useColorScheme()
  const [activeId, setActiveId] = useState<string>(
    () => pickInitialTheme(colorScheme === 'dark').id,
  )
  const setTheme = useCallback((id: string) => {
    if (registryThemes.some((t) => t.id === id)) setActiveId(id)
  }, [])
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
      <View style={[{ flex: 1 }, themeVars]}>{children}</View>
    </ThemeContext.Provider>
  )
}
