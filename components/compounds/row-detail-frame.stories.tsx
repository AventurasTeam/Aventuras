import { zodResolver } from '@hookform/resolvers/zod'
import { NavigationContext } from '@react-navigation/native'
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, spyOn, userEvent, waitFor } from 'storybook/test'
import { z } from 'zod'

import { TabsContent } from '@/components/ui/tabs'
import { Text } from '@/components/ui/text'
import { useRowSaveSession } from '@/hooks/use-row-save-session'
import type { AvtsFile } from '@/lib/avts'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toastStore, type ToastItem } from '@/lib/toast'

import { watchDownloads } from './download-probe'
import { RowDetailFrame } from './row-detail-frame'

// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 5000 }

type Row = { id: string; title: string }
type Draft = { title: string }
type Tab = 'overview'

const FIRST: Row = { id: 'row_first', title: 'First row' }
const SECOND: Row = { id: 'row_second', title: 'Second row' }
const TABS = [{ value: 'overview', label: 'Overview' }] as const
const resolver = zodResolver(z.object({ title: z.string() }))

type HarnessProps = {
  /** Null is create mode. */
  row: Row | null
  exportFile: () => AvtsFile
  blocked?: boolean
  blockedReason?: string
}

/** Capture-phase F2 (the open JSON sheet holds focus) switches to SECOND, as a list-row pick. */
function Harness({ row: initialRow, exportFile, blocked = false, blockedReason }: HarnessProps) {
  const [row, setRow] = useState(initialRow)
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') setRow(SECOND)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const values = useMemo<Draft>(() => ({ title: row?.title ?? '' }), [row])
  const session = useRowSaveSession<Draft>({
    rowKey: row?.id ?? 'create:1',
    values,
    resolver,
    fieldLabel: (field) => field,
    issueText: (message) => message,
    failureText: () => 'Save failed.',
    commit: async () => ({ status: 'ok' }),
  })

  return (
    <View style={{ width: 860, maxWidth: '100%', height: 480 }} className="border border-border">
      <RowDetailFrame
        session={session}
        nameField="title"
        savedName={values.title}
        namePlaceholder="Untitled"
        menuLabel="More actions"
        menuEntries={({ onViewJson, onExport }) => [
          { key: 'export', label: 'Export row as JSON', onPress: onExport },
          { key: 'json', label: 'View raw JSON', onPress: onViewJson },
        ]}
        tab={tab}
        onTabChange={setTab}
        tabs={TABS}
        tabSelectLabel="Section"
        committed={row == null ? null : { id: row.id, name: row.title, json: row, exportFile }}
        blocked={blocked}
        blockedReason={blockedReason}
        hotkeysEnabled
      >
        <TabsContent value="overview">
          <Text>{row?.title ?? 'New row'}</Text>
        </TabsContent>
      </RowDetailFrame>
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/RowDetailFrame',
  component: Harness,
  parameters: { layout: 'padded' },
  args: {
    row: FIRST,
    exportFile: fn((): AvtsFile => ({ fileName: 'row-first-row.avts', contents: '{}' })),
  },
}
export default meta
type Story = StoryObj<typeof Harness>

async function openMenuEntry(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, WAIT))
  const entry = await screen.findByRole('menuitem', { name }, WAIT)
  // The popover fades in; the role query can outrace opacity settling.
  await waitFor(() => expect(entry).toBeVisible(), WAIT)
  await userEvent.click(entry)
}

/** data.md → Raw JSON viewer: switching rows closes the viewer instead of showing the next row. */
export const JsonViewerClosesOnRowSwitch: Story = {
  play: async () => {
    await openMenuEntry('View raw JSON')
    await expect(
      await screen.findByRole('button', { name: 'Close raw JSON viewer' }, WAIT),
    ).toBeVisible()
    await expect(screen.getByText(/"row_first"/)).toBeInTheDocument()

    // A flash of the next row's JSON is gone by the time the viewer reads as closed.
    let flashed = false
    const observer = new MutationObserver(() => {
      if (document.body.textContent?.includes('"row_second"')) flashed = true
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    await userEvent.keyboard('{F2}')
    await waitFor(
      () =>
        expect(
          screen.queryByRole('button', { name: 'Close raw JSON viewer' }),
        ).not.toBeInTheDocument(),
      WAIT,
    )
    observer.disconnect()
    // The switch landed: the head names the second row, and its JSON never showed.
    await expect(await screen.findByRole('button', { name: 'Edit Second row' }, WAIT)).toBeVisible()
    expect(flashed).toBe(false)
  },
}

/** Just the slice useIsRouteFocused reads, with blur and focus driven from a play. */
function stubNavigation() {
  const listeners = new Map<string, Set<() => void>>()
  let focused = true
  return {
    value: {
      isFocused: () => focused,
      addListener: (event: string, listener: () => void) => {
        const set = listeners.get(event) ?? new Set<() => void>()
        set.add(listener)
        listeners.set(event, set)
        return () => set.delete(listener)
      },
    },
    emit(event: 'focus' | 'blur') {
      focused = event === 'focus'
      listeners.get(event)?.forEach((listener) => listener())
    },
  }
}

const screenNavigation = stubNavigation()

/** Portaled, the viewer would paint over a pushed screen: blur closes it, and focus leaves it shut. */
export const JsonViewerClosesOnScreenBlur: Story = {
  render: (args) => (
    <NavigationContext.Provider value={screenNavigation.value as never}>
      <Harness {...args} />
    </NavigationContext.Provider>
  ),
  play: async () => {
    await openMenuEntry('View raw JSON')
    const close = () => screen.queryByRole('button', { name: 'Close raw JSON viewer' })
    await waitFor(() => expect(close()).toBeVisible(), WAIT)
    screenNavigation.emit('blur')
    await waitFor(() => expect(close()).not.toBeInTheDocument(), WAIT)
    screenNavigation.emit('focus')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(close()).not.toBeInTheDocument()
  },
}

/** A file that can't be built toasts the export failure. */
export const ExportFailureToasts: Story = {
  args: {
    exportFile: fn((): AvtsFile => {
      throw new Error('serializer failed')
    }),
  },
  beforeEach: () => {
    // A toast left by another story would satisfy the assertion below.
    toastStore.__reset()
  },
  play: async ({ args }) => {
    let toasts: ToastItem[] = []
    const stop = toastStore.subscribe((next) => {
      toasts = next
    })
    try {
      await openMenuEntry('Export row as JSON')
      await waitFor(
        () =>
          expect(toasts.map((item) => [item.severity, item.message])).toEqual([
            ['error', t('common:avts.exportFailed')],
          ]),
        WAIT,
      )
      await expect(args.exportFile).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  },
}

/** Create mode: no committed row, so the `⋯` is disabled; the name shows its placeholder. */
export const CreateModeDisablesTheMenu: Story = {
  args: { row: null },
  play: async () => {
    await expect(await screen.findByRole('button', { name: 'More actions' }, WAIT)).toBeDisabled()
    await expect(screen.getByRole('button', { name: 'Untitled' })).toBeVisible()
  },
}

/** A save hand-off that rejects logs the failure and toasts it. */
export const ExportRejectionToasts: Story = {
  beforeEach: () => {
    toastStore.__reset()
    const blob = spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('blob refused')
    })
    const log = spyOn(logger, 'error').mockImplementation(() => {})
    return () => {
      blob.mockRestore()
      log.mockRestore()
    }
  },
  play: async () => {
    let toasts: ToastItem[] = []
    const stop = toastStore.subscribe((next) => {
      toasts = next
    })
    try {
      await openMenuEntry('Export row as JSON')
      await waitFor(
        () =>
          expect(toasts.map((item) => [item.severity, item.message])).toEqual([
            ['error', t('common:avts.exportFailed')],
          ]),
        WAIT,
      )
      await expect(logger.error).toHaveBeenCalledWith('app.row_export_failed', {
        id: 'row_first',
        error: 'blob refused',
      })
    } finally {
      stop()
    }
  },
}

/** Export reads the committed row, so with unsaved edits a toast says the file holds the saved one. */
export const ExportWithUnsavedEditsSaysSo: Story = {
  beforeEach: () => {
    toastStore.__reset()
  },
  play: async () => {
    const watch = watchDownloads()
    try {
      await userEvent.click(await screen.findByRole('button', { name: 'Edit First row' }, WAIT))
      await userEvent.keyboard(' (draft){Enter}')
      await waitFor(() => expect(screen.getByTestId('save-bar')).toBeVisible(), WAIT)
      await openMenuEntry('Export row as JSON')
      await waitFor(() => expect(watch.downloads).toEqual(['row-first-row.avts']), WAIT)
      await waitFor(
        () => expect(watch.toasts()).toEqual([['info', t('common:avts.exportedSaved')]]),
        WAIT,
      )
    } finally {
      watch.stop()
    }
  },
}

/** A clean draft is the saved row, so its export says nothing. */
export const ExportWhileCleanStaysQuiet: Story = {
  beforeEach: () => {
    toastStore.__reset()
  },
  play: async () => {
    const watch = watchDownloads()
    try {
      await openMenuEntry('Export row as JSON')
      await waitFor(() => expect(watch.downloads).toEqual(['row-first-row.avts']), WAIT)
      // A notice would follow the hand-off within microtasks; one macrotask outlasts them.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(watch.toasts()).toEqual([])
    } finally {
      watch.stop()
    }
  },
}

/** world.md → Detail head structure: Export is read-only, so a blocked frame leaves it live. */
export const ExportStaysLiveWhileBlocked: Story = {
  args: { blocked: true, blockedReason: 'Generation is in flight. Cancel to edit.' },
  play: async () => {
    const watch = watchDownloads()
    try {
      await expect(await screen.findByRole('button', { name: 'More actions' }, WAIT)).toBeEnabled()
      // The gate reached the frame: the blocked name drops its edit button.
      await expect(screen.queryByRole('button', { name: 'Edit First row' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
      const entry = await screen.findByRole('menuitem', { name: 'Export row as JSON' }, WAIT)
      await waitFor(() => expect(entry).toBeVisible(), WAIT)
      await expect(entry).not.toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(entry)
      await waitFor(() => expect(watch.downloads).toEqual(['row-first-row.avts']), WAIT)
    } finally {
      watch.stop()
    }
  },
}
