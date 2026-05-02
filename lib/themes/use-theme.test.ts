// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'
import { themes } from './registry'
import { ThemeProvider } from './theme-provider'
import { useTheme } from './use-theme'

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
})

describe('useTheme — web', () => {
  it('sets data-theme on documentElement to active theme id', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    expect(document.documentElement.getAttribute('data-theme')).toBe(result.current.theme.id)
  })

  it('toggles .dark class when active theme mode is dark', () => {
    const dark = themes.find((t) => t.mode === 'dark')!
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    act(() => result.current.setTheme(dark.id))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes .dark class when active theme mode is light', () => {
    const light = themes.find((t) => t.mode === 'light')!
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    act(() => result.current.setTheme(light.id))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
