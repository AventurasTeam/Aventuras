import { useContext } from 'react'
import { ThemeContext, type ThemeContextValue } from './theme-context'

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme: ThemeProvider missing')
  return ctx
}
