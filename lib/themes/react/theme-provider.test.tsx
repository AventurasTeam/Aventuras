// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react'
import { type ReactNode } from 'react'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import { resolveInitialTheme } from './seed'
import { ThemeProvider } from './theme-provider'
import { useTheme } from './use-theme'
import { themes } from '../core/registry'

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
})

const darkTheme = themes.find((t) => t.mode === 'dark')!
const lightTheme = themes.find((t) => t.mode === 'light')!

describe('resolveInitialTheme', () => {
  it("seeds from the OS scheme for 'system'", () => {
    expect(resolveInitialTheme('system', false)).toBe(themes[0])
    expect(resolveInitialTheme('system', true).mode).toBe('dark')
  })

  it('seeds from the OS scheme when no id is given', () => {
    expect(resolveInitialTheme(undefined, false)).toBe(themes[0])
    expect(resolveInitialTheme(undefined, true).mode).toBe('dark')
  })

  it('a concrete registry id wins over the OS scheme', () => {
    expect(resolveInitialTheme(lightTheme.id, true)).toBe(lightTheme)
    expect(resolveInitialTheme(darkTheme.id, false)).toBe(darkTheme)
  })

  it('falls back to the OS scheme for an unknown id', () => {
    expect(resolveInitialTheme('no-such-theme', false)).toBe(themes[0])
    expect(resolveInitialTheme('no-such-theme', true).mode).toBe('dark')
  })
})

describe('ThemeProvider — web', () => {
  it('applies data-theme and .dark at mount with no useTheme consumer', () => {
    render(<ThemeProvider initialThemeId={darkTheme.id}>{null}</ThemeProvider>)
    expect(document.documentElement.getAttribute('data-theme')).toBe(darkTheme.id)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('sets data-theme on documentElement to active theme id', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    expect(document.documentElement.getAttribute('data-theme')).toBe(result.current.theme.id)
  })

  it('toggles .dark class when active theme mode is dark', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    act(() => result.current.setTheme(darkTheme.id))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes .dark class when active theme mode is light', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider })
    act(() => result.current.setTheme(lightTheme.id))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('fires onThemeChange on an accepted pick, not for the mount seed', () => {
    const onThemeChange = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider initialThemeId="system" onThemeChange={onThemeChange}>
        {children}
      </ThemeProvider>
    )
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(onThemeChange).not.toHaveBeenCalled()
    act(() => result.current.setTheme(darkTheme.id))
    expect(onThemeChange).toHaveBeenCalledExactlyOnceWith(darkTheme.id)
  })

  it('ignores an unknown id in setTheme and does not persist it', () => {
    const onThemeChange = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider onThemeChange={onThemeChange}>{children}</ThemeProvider>
    )
    const { result } = renderHook(() => useTheme(), { wrapper })
    const before = result.current.theme.id
    act(() => result.current.setTheme('no-such-theme'))
    expect(result.current.theme.id).toBe(before)
    expect(onThemeChange).not.toHaveBeenCalled()
  })
})
