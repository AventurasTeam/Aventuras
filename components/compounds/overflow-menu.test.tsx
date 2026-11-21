// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OverflowMenu } from './overflow-menu'
import type { OverflowMenuEntry } from './overflow-menu-entry'

const tier = vi.hoisted(() => ({ value: 'phone' as 'phone' | 'tablet' | 'desktop' }))
vi.mock('@/hooks/use-tier', () => ({ useTier: () => tier.value }))

// The unit project can't load the overlays' RN-Web and gorhom chrome; the Sheet's onOpenChange and
// onDismissed are the seam, captured from each render.
const sheet = vi.hoisted(() => ({
  open: null as boolean | null,
  onOpenChange: null as ((open: boolean) => void) | null,
  onDismissed: null as (() => void) | null,
}))
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => {
    sheet.open = open ?? null
    sheet.onOpenChange = onOpenChange ?? null
    return children
  },
  SheetTrigger: () => null,
  SheetContent: ({ children, onDismissed }: { children: ReactNode; onDismissed?: () => void }) => {
    sheet.onDismissed = onDismissed ?? null
    return children
  },
}))
vi.mock('@/components/ui/popover', () => ({
  Popover: () => null,
  PopoverTrigger: () => null,
  PopoverContent: () => null,
}))
vi.mock('@/components/ui/icon-action', () => ({ IconAction: () => null }))
vi.mock('lucide-react-native', () => ({ MoreHorizontal: null }))
vi.mock('@/components/ui/text', () => ({
  Text: ({ children }: { children: ReactNode }) => children,
}))

const onViewJson = vi.fn<() => void>()
const ENTRIES: OverflowMenuEntry[] = [
  { key: 'json', label: 'View as JSON', opensSheet: true, onPress: onViewJson },
]

const menu = () => <OverflowMenu label="More actions" entries={ENTRIES} />
const pick = () => fireEvent.click(screen.getByRole('menuitem', { name: 'View as JSON' }))

beforeEach(() => {
  tier.value = 'phone'
  sheet.open = null
  sheet.onOpenChange = null
  sheet.onDismissed = null
  onViewJson.mockReset()
})
afterEach(cleanup)

// The Sheet's own unmount guard skips onDismissed, so a tier flip mid-exit would drop the entry.
describe('OverflowMenu — an entry that opens a Sheet, picked from the phone Sheet', () => {
  it('runs once when the tier leaves phone before the Sheet dismissed', () => {
    const { rerender } = render(menu())
    pick()
    expect(onViewJson).not.toHaveBeenCalled()
    tier.value = 'desktop'
    rerender(menu())
    expect(onViewJson).toHaveBeenCalledOnce()
    tier.value = 'phone'
    rerender(menu())
    tier.value = 'desktop'
    rerender(menu())
    expect(onViewJson).toHaveBeenCalledOnce()
  })

  it('waits for the dismissal, then runs once', () => {
    const { rerender } = render(menu())
    pick()
    expect(sheet.open).toBe(false)
    expect(onViewJson).not.toHaveBeenCalled()
    act(() => sheet.onDismissed?.())
    expect(onViewJson).toHaveBeenCalledOnce()
    tier.value = 'desktop'
    rerender(menu())
    expect(onViewJson).toHaveBeenCalledOnce()
  })

  it('runs nothing once the Sheet reopened over the pending entry', () => {
    const { rerender } = render(menu())
    pick()
    act(() => sheet.onOpenChange?.(true))
    tier.value = 'desktop'
    rerender(menu())
    expect(onViewJson).not.toHaveBeenCalled()
  })

  it('runs nothing when the menu unmounts with the entry pending', () => {
    const { unmount } = render(menu())
    pick()
    unmount()
    expect(onViewJson).not.toHaveBeenCalled()
  })
})
