import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
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
  const value = useMemo<ThemeContextValue>(() => {
    const theme = registryThemes.find((t) => t.id === activeId) ?? registryThemes[0]
    return { theme, setTheme, themes: registryThemes }
  }, [activeId, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
