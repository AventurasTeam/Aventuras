// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { cloneElement, createContext, isValidElement, useContext, useState } from 'react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { StorySettings } from '@/lib/db'
import { t } from '@/lib/i18n'

import {
  StorySettingsSaveSessionProvider,
  useStorySettingsSaveSession,
  useStorySettingsSection,
  type SaveSessionApi,
} from './save-session'
import { StorySettingsLeaveDialog, StorySettingsSaveBar } from './save-session-chrome'

// These four ship un-transpiled JSX or pull in react-native's raw Flow-syntax
// entry once Vitest's node environment externalizes them — neither glyph nor
// spinner is ever asserted on here, so they're stubbed rather than fought.
vi.mock('@/components/ui/spinner', () => ({ Spinner: () => null }))
vi.mock('lucide-react-native', () => ({ AlertTriangle: () => null }))
vi.mock('nativewind', () => ({ cssInterop: () => {} }))
vi.mock('@rn-primitives/slot', () => ({ Slot: () => null }))

// Same externalization wall as above, but the open-gating and Cancel wiring
// below it ARE under test, so this stands in for just enough of Radix's
// AlertDialog to exercise UnsavedChangesDialog's real handleOpenChange path.
vi.mock('@/components/ui/alert-dialog', () => {
  const AlertDialogContext = createContext<{ onOpenChange: (next: boolean) => void } | null>(null)

  function AlertDialog({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean
    onOpenChange: (next: boolean) => void
    children: React.ReactNode
  }) {
    return (
      <AlertDialogContext.Provider value={{ onOpenChange }}>
        {open ? children : null}
      </AlertDialogContext.Provider>
    )
  }
  function AlertDialogContent({ children }: { children: React.ReactNode }) {
    return <div role="alertdialog">{children}</div>
  }
  function AlertDialogHeader({ children }: { children: React.ReactNode }) {
    return <>{children}</>
  }
  function AlertDialogFooter({ children }: { children: React.ReactNode }) {
    return <>{children}</>
  }
  function AlertDialogTitle({ children }: { children: React.ReactNode }) {
    return <h2>{children}</h2>
  }
  function AlertDialogDescription({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }
  function AlertDialogCancel({ children }: { children: React.ReactNode }) {
    const ctx = useContext(AlertDialogContext)
    if (!isValidElement(children)) return <>{children}</>
    const child = children as React.ReactElement<{ onPress?: () => void }>
    return cloneElement(child, {
      onPress: () => {
        child.props.onPress?.()
        ctx?.onOpenChange(false)
      },
    })
  }
  return {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogCancel,
  }
})

afterEach(cleanup)

let setFixture: (next: { dirtyFields: string[]; invalidReason?: string }) => void

function FixtureSection() {
  const [state, setState] = useState<{ dirtyFields: string[]; invalidReason?: string }>({
    dirtyFields: [],
  })
  setFixture = setState
  useStorySettingsSection({
    id: 'fixture',
    tab: 'generation',
    dirtyFields: state.dirtyFields,
    invalidReason: state.invalidReason,
    getPatch: (): Partial<StorySettings> => ({ suggestionCount: 5 }),
    reset: () => setState({ dirtyFields: [] }),
  })
  return null
}

function Capture({ held }: { held: { current: SaveSessionApi | null } }) {
  held.current = useStorySettingsSaveSession()
  return null
}

function renderSurface(
  onCommit: Mock<() => Promise<unknown>> = vi.fn().mockResolvedValue(undefined),
) {
  const held: { current: SaveSessionApi | null } = { current: null }
  render(
    <StorySettingsSaveSessionProvider onCommit={onCommit}>
      <FixtureSection />
      <StorySettingsSaveBar enabled />
      <StorySettingsLeaveDialog />
      <Capture held={held} />
    </StorySettingsSaveSessionProvider>,
  )
  return { onCommit, api: () => held.current! }
}

const saveLabel = t('saveBar.save')
const discardLabel = t('saveBar.discard')
const cancelLabel = t('cancel')

describe('StorySettingsSaveBar', () => {
  it('stays unmounted while the session is clean', () => {
    renderSurface()
    expect(screen.queryByText(discardLabel)).toBeNull()
  })

  it('mounts once a section reports dirty fields', () => {
    renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion count'] }))
    expect(screen.getByText(discardLabel)).toBeTruthy()
    expect(screen.getByText(/suggestion count/)).toBeTruthy()
  })

  it('surfaces the invalid reason and disables the save button', async () => {
    const { onCommit } = renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion categories'], invalidReason: 'dup labels' }))

    expect(screen.getByLabelText('dup labels')).toBeTruthy()
    const saveButton = screen.getByText(new RegExp(`^${saveLabel}`)).closest('button')
    expect(saveButton?.getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      saveButton!.click()
    })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits through the session when valid', async () => {
    const { onCommit } = renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion count'] }))

    await act(async () => {
      screen.getByText(new RegExp(`^${saveLabel}`)).click()
    })
    expect(onCommit).toHaveBeenCalledWith({ suggestionCount: 5 })
  })
})

describe('StorySettingsLeaveDialog', () => {
  it('stays closed with no pending leave', () => {
    renderSurface()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('opens when a leave is requested against a dirty session', () => {
    const { api } = renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion count'] }))
    const proceed = vi.fn()

    act(() => api().requestLeave(proceed))

    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(proceed).not.toHaveBeenCalled()
  })

  it("lets a clean session's leave proceed immediately, without opening the dialog", () => {
    const { api } = renderSurface()
    const proceed = vi.fn()

    act(() => api().requestLeave(proceed))

    expect(proceed).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('cancel keeps the session and does not proceed', async () => {
    const { api } = renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion count'] }))
    const proceed = vi.fn()
    act(() => api().requestLeave(proceed))
    const dialog = screen.getByRole('alertdialog')

    await act(async () => {
      within(dialog).getByText(cancelLabel).click()
    })

    expect(proceed).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // The session is still dirty — cancel didn't discard it.
    expect(screen.getByText(discardLabel)).toBeTruthy()
  })

  it('discard resets the section and lets the leave proceed', async () => {
    const { api, onCommit } = renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion count'] }))
    const proceed = vi.fn()
    act(() => api().requestLeave(proceed))
    const dialog = screen.getByRole('alertdialog')

    await act(async () => {
      within(dialog).getByText(discardLabel).click()
    })

    expect(onCommit).not.toHaveBeenCalled()
    expect(proceed).toHaveBeenCalledTimes(1)
    // The section reset, so the surface is clean again: no save bar left.
    expect(screen.queryByText(discardLabel)).toBeNull()
  })

  it('save commits through the session and lets the leave proceed', async () => {
    const { api, onCommit } = renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion count'] }))
    const proceed = vi.fn()
    act(() => api().requestLeave(proceed))
    const dialog = screen.getByRole('alertdialog')

    await act(async () => {
      within(dialog).getByText(saveLabel).click()
    })

    expect(onCommit).toHaveBeenCalledWith({ suggestionCount: 5 })
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  it('disables save and renders the reason while the section is invalid', () => {
    const { api } = renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion categories'], invalidReason: 'dup labels' }))
    act(() => api().requestLeave(vi.fn()))
    const dialog = screen.getByRole('alertdialog')

    const saveButton = within(dialog).getByText(saveLabel).closest('button')
    expect(saveButton?.getAttribute('aria-disabled')).toBe('true')
    expect(within(dialog).getByText('dup labels')).toBeTruthy()
  })

  it('still lets discard clear an invalid session and proceed', async () => {
    const { api, onCommit } = renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion categories'], invalidReason: 'dup labels' }))
    const proceed = vi.fn()
    act(() => api().requestLeave(proceed))
    const dialog = screen.getByRole('alertdialog')

    await act(async () => {
      within(dialog).getByText(discardLabel).click()
    })

    expect(onCommit).not.toHaveBeenCalled()
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(discardLabel)).toBeNull()
  })

  it('still lets cancel dismiss an invalid session without discarding', async () => {
    const { api, onCommit } = renderSurface()
    act(() => setFixture({ dirtyFields: ['suggestion categories'], invalidReason: 'dup labels' }))
    const proceed = vi.fn()
    act(() => api().requestLeave(proceed))
    const dialog = screen.getByRole('alertdialog')

    await act(async () => {
      within(dialog).getByText(cancelLabel).click()
    })

    expect(onCommit).not.toHaveBeenCalled()
    expect(proceed).not.toHaveBeenCalled()
    // Still dirty and still invalid — cancel didn't touch the draft.
    expect(screen.getByLabelText('dup labels')).toBeTruthy()
  })
})
