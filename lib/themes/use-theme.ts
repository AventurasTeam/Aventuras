import { useContext, useEffect } from 'react'
import { ThemeContext, type ThemeContextValue } from './theme-context'

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme: ThemeProvider missing')
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', ctx.theme.id)
    document.documentElement.classList.toggle('dark', ctx.theme.mode === 'dark')
  }, [ctx.theme.id, ctx.theme.mode])
  return ctx
}
