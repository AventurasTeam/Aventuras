import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'

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
  const value = useMemo<ThemeContextValue>(() => {
    const theme = registryThemes.find((t) => t.id === activeId) ?? registryThemes[0]
    return { theme, setTheme, themes: registryThemes }
  }, [activeId, setTheme])
  // The provider is the single writer of data-theme + .dark on <html>; DOM
  // application must not depend on any useTheme consumer mounting, or screens
  // without one render on the :root fallback instead of the active theme.
  const { theme } = value
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', theme.id)
    document.documentElement.classList.toggle('dark', theme.mode === 'dark')
  }, [theme.id, theme.mode])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
