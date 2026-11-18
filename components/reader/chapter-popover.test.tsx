// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChapterProgress } from '@/lib/chapters'
import { t } from '@/lib/i18n'

import { ChapterPopover, type ChapterPopoverProps } from './chapter-popover'

const tier = vi.hoisted(() => ({ value: 'phone' as 'phone' | 'tablet' | 'desktop' }))
vi.mock('@/hooks/use-tier', () => ({ useTier: () => tier.value }))

// The unit project can't load the overlays' RN-Web and gorhom chrome; the Sheet's onDismissed is
// the seam, captured from each render.
const sheet = vi.hoisted(() => ({ onDismissed: null as (() => void) | null }))
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => children,
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
vi.mock('@/components/ui/scroll-component', async () => {
  const { createContext } = await import('react')
  return {
    ScrollComponentContext: createContext(null),
    ContextScrollView: ({ children }: { children: ReactNode }) => children,
  }
})
vi.mock('@/components/ui/text', () => ({
  Text: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/compounds/reason-button', () => ({
  ReasonButton: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode
    onPress?: () => void
    disabled?: boolean
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}))
vi.mock('@/components/compounds/chapter-progress-bar', () => ({ ChapterProgressBar: () => null }))
vi.mock('./chapter-chip', () => ({ ChapterChip: () => null }))
vi.mock('./sheet-list-lock', async () => {
  const { createContext } = await import('react')
  return { PinnedEndContext: createContext(null), useEndLockedScrollHandlers: () => ({}) }
})
vi.mock('@gorhom/bottom-sheet', () => ({
  SCROLLABLE_STATUS: { UNLOCKED: 1 },
  useBottomSheetInternal: () => ({ animatedScrollableStatus: { get: () => 0 } }),
}))
vi.mock('react-native-gesture-handler', () => ({ ScrollView: () => null }))
vi.mock('react-native-reanimated', () => ({
  useAnimatedReaction: () => {},
  useSharedValue: (value: number) => ({ value }),
}))
vi.mock('react-native-worklets', () => ({
  runOnUISync: (run: () => void) => run(),
  scheduleOnRN: (run: () => void) => run(),
}))

const PROGRESS: ChapterProgress = {
  tokens: 900,
  threshold: 1000,
  percent: 90,
  tone: 'warning',
  canClose: true,
  startEntryId: 'entry_59',
}

const onCloseChapter = vi.fn<() => void>()

function popover(): ReactNode {
  const props: ChapterPopoverProps = {
    closed: [],
    sinceLabel: null,
    progress: PROGRESS,
    readyToClose: false,
    onJumpToChapter: () => {},
    onCloseChapter,
    onManageChapters: () => {},
  }
  return <ChapterPopover {...props} />
}

function pressCloseChapter(): void {
  fireEvent.click(screen.getByRole('button', { name: t('chapters:popover.closeManually') }))
}

beforeEach(() => {
  tier.value = 'phone'
  sheet.onDismissed = null
  onCloseChapter.mockReset()
})
afterEach(cleanup)

// The Sheet's own unmount guard skips onDismissed, so a tier flip mid-exit would drop the close.
describe('ChapterPopover — a close requested from the phone Sheet', () => {
  it('runs once when the tier leaves phone before the Sheet dismissed', () => {
    const { rerender } = render(popover())
    pressCloseChapter()
    expect(onCloseChapter).not.toHaveBeenCalled()
    tier.value = 'desktop'
    rerender(popover())
    expect(onCloseChapter).toHaveBeenCalledOnce()
    tier.value = 'phone'
    rerender(popover())
    tier.value = 'desktop'
    rerender(popover())
    expect(onCloseChapter).toHaveBeenCalledOnce()
  })

  it('runs once on the dismissal, and not again on a later tier change', () => {
    const { rerender } = render(popover())
    pressCloseChapter()
    act(() => sheet.onDismissed?.())
    expect(onCloseChapter).toHaveBeenCalledOnce()
    tier.value = 'desktop'
    rerender(popover())
    expect(onCloseChapter).toHaveBeenCalledOnce()
  })

  it('runs nothing on a tier change with no close pending', () => {
    const { rerender } = render(popover())
    tier.value = 'desktop'
    rerender(popover())
    expect(onCloseChapter).not.toHaveBeenCalled()
  })

  it('runs nothing when the popover unmounts with the close pending', () => {
    const { unmount } = render(popover())
    pressCloseChapter()
    unmount()
    expect(onCloseChapter).not.toHaveBeenCalled()
  })
})
