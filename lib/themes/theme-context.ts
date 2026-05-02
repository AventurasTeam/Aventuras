import { createContext } from 'react'
import type { Theme } from './types'

export type ThemeContextValue = {
  theme: Theme
  setTheme: (id: string) => void
  themes: readonly Theme[]
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)
