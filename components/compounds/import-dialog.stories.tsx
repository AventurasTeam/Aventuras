import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

import { ImportDialog } from './import-dialog'
import type { ImportState } from './import-dialog-pipeline'

// Stand-in schemas. Real consumer schemas (CalendarSystemSchema,
// StoryImportSchema, EntityImportSchema, …) land with their owning domain
// implementations; the dialog is generic over TPayload so any zod schema works.
const CalendarStubSchema = z.object({
  units: z.array(z.object({ name: z.string().min(1), length: z.number().positive() })),
  eras: z.array(z.string()).min(1),
})

const StoryStubSchema = z.object({
  title: z.string().min(1),
  branches: z.array(z.object({ id: z.string(), name: z.string() })),
})

function ControlledDialog<TPayload>({
  initialOpen,
  initialState,
  format,
  title,
  payloadKey,
  schema,
  onValidated = (payload) => {
    console.log('[import-dialog story] validated:', payload)
  },
}: {
  initialOpen: boolean
  initialState?: ImportState
  format: `aventuras-${string}`
  title: string
  payloadKey: string
  schema: z.ZodType<TPayload>
  onValidated?: (payload: TPayload) => void
}) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <View className="p-4">
      <Button variant="secondary" onPress={() => setOpen(true)}>
        <Text>Open import dialog</Text>
      </Button>
      <ImportDialog<TPayload>
        open={open}
        onOpenChange={setOpen}
        format={format}
        supportedMajor={1}
        payloadKey={payloadKey}
        schema={schema}
        title={title}
        onValidated={onValidated}
        _initialState={initialState}
      />
    </View>
  )
}

const meta: Meta<typeof ImportDialog> = {
  title: 'Compounds/ImportDialog',
  component: ImportDialog,
  parameters: { layout: 'centered' },
}

export default meta

type Story = StoryObj<typeof ImportDialog>

// CI runs story plays several times slower than local; the default 1s find timeout flakes there.
const WAIT = { timeout: 5000 }

function findDialog() {
  return screen.findByRole('dialog', { name: 'Import calendar' }, WAIT)
}

// Idle — calendar import; default open.
export const IdleCalendar: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      format="aventuras-calendar"
      title="Import calendar"
      payloadKey="calendar"
      schema={CalendarStubSchema}
    />
  ),
  play: async () => {
    const dialog = await findDialog()
    await waitFor(() => {
      expect(
        within(dialog).getByRole('button', { name: t('common:importDialog.chooseFile') }),
      ).toBeVisible()
      expect(
        within(dialog).getByRole('button', { name: t('common:importDialog.fromClipboard') }),
      ).toBeVisible()
      expect(within(dialog).getByText(t('common:importDialog.hint'))).toBeVisible()
      expect(within(dialog).getByRole('button', { name: t('common:cancel') })).toBeVisible()
    }, WAIT)
  },
}

// Idle — story import; title-copy variation.
export const IdleStory: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      format="aventuras-story"
      title="Import story"
      payloadKey="story"
      schema={StoryStubSchema}
    />
  ),
}

// Idle — phone viewport check.
// Resize the Storybook canvas to < 640px and verify button text doesn't
// truncate. The tier-dependent details-scroll branch (phone expands inline,
// desktop/tablet uses bounded scroll) only changes useTier()'s return when
// the actual window dimension crosses the boundary.
export const IdleCalendar_Phone: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      format="aventuras-calendar"
      title="Import calendar"
      payloadKey="calendar"
      schema={CalendarStubSchema}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Same as IdleCalendar — resize the Storybook canvas to phone width (< 640px) to verify button text + footer survive the narrower container.',
      },
    },
  },
}

// Reading — forced via test seam; spinner on file button, both disabled.
export const Reading: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      initialState={{ kind: 'reading', source: 'file' }}
      format="aventuras-calendar"
      title="Import calendar"
      payloadKey="calendar"
      schema={CalendarStubSchema}
    />
  ),
}

// Meta-error: file isn't an Aventuras envelope.
export const MetaError_NotAventuras: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      initialState={{ kind: 'meta-error', copy: t('common:importDialog.meta.notAventuras') }}
      format="aventuras-calendar"
      title="Import calendar"
      payloadKey="calendar"
      schema={CalendarStubSchema}
    />
  ),
  // A forced error survives mount but not a close and reopen.
  play: async () => {
    const dialog = await findDialog()
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toBeVisible()
    }, WAIT)
    await userEvent.click(within(dialog).getByRole('button', { name: t('common:cancel') }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    }, WAIT)
    await userEvent.click(screen.getByRole('button', { name: 'Open import dialog' }))
    const reopened = await findDialog()
    await waitFor(() => {
      expect(
        within(reopened).getByRole('button', { name: t('common:importDialog.chooseFile') }),
      ).toBeVisible()
    }, WAIT)
    expect(within(reopened).queryByRole('alert')).toBeNull()
  },
}

// Meta-error: wrong kind — Story envelope into a Calendar dialog.
export const MetaError_WrongKind: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      initialState={{
        kind: 'meta-error',
        copy: t('common:importDialog.meta.wrongKind', {
          got: 'aventuras-story',
          expected: 'aventuras-calendar',
        }),
      }}
      format="aventuras-calendar"
      title="Import calendar"
      payloadKey="calendar"
      schema={CalendarStubSchema}
    />
  ),
}

// Meta-error: newer-version envelope vs supportedMajor: 1.
export const MetaError_NewerVersion: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      initialState={{
        kind: 'meta-error',
        copy: t('common:importDialog.meta.newerVersion'),
      }}
      format="aventuras-calendar"
      title="Import calendar"
      payloadKey="calendar"
      schema={CalendarStubSchema}
    />
  ),
  play: async () => {
    const dialog = await findDialog()
    const alert = within(dialog).getByRole('alert')
    await waitFor(() => {
      expect(within(alert).getByText(t('common:importDialog.meta.newerVersion'))).toBeVisible()
    }, WAIT)
    // import-dialog.md → Accessibility: the ⚠ is visual emphasis only.
    expect(within(alert).getByText('⚠')).toHaveAttribute('aria-hidden', 'true')
  },
}

// Meta-error: clipboard returned an empty string.
export const MetaError_ClipboardEmpty: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      initialState={{ kind: 'meta-error', copy: t('common:importDialog.read.clipboardEmpty') }}
      format="aventuras-calendar"
      title="Import calendar"
      payloadKey="calendar"
      schema={CalendarStubSchema}
    />
  ),
}

const payloadIssues = [
  { path: 'calendar.units[0].name', message: 'Required.' },
  { path: 'calendar.units[2].length', message: 'Must be a positive number.' },
  { path: 'calendar.eras', message: 'Must contain at least one era.' },
] as const

// Payload-error collapsed — single-line summary with disclosure.
export const PayloadError_Collapsed: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      initialState={{ kind: 'payload-error', issues: payloadIssues }}
      format="aventuras-calendar"
      title="Import calendar"
      payloadKey="calendar"
      schema={CalendarStubSchema}
    />
  ),
  play: async () => {
    const dialog = await findDialog()
    const alert = within(dialog).getByRole('alert')
    await waitFor(() => {
      expect(
        within(alert).getByText(t('common:importDialog.invalidFormat', { count: 3 })),
      ).toBeVisible()
    }, WAIT)
    expect(within(alert).getByText('⚠')).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(
      within(alert).getByRole('button', { name: t('common:importDialog.showDetails') }),
    )
    const line = t('common:importDialog.issue', {
      path: 'calendar.units[0].name',
      message: 'Required.',
    })
    await waitFor(() => {
      expect(within(alert).getByText(`• ${line}`)).toBeVisible()
    }, WAIT)
    expect(
      within(alert).getByRole('button', { name: t('common:importDialog.hideDetails') }),
    ).toHaveAttribute('aria-expanded', 'true')
  },
}

// Payload-error expanded — defaults open by clicking the toggle in this story.
// The dialog's `detailsExpanded` state is internal, so the story exposes the
// expanded shape via a wrapper that flips the toggle on mount.
export const PayloadError_Expanded: Story = {
  render: () => {
    function Wrapper() {
      const [open, setOpen] = useState(true)
      return (
        <View className="p-4">
          <ImportDialog
            open={open}
            onOpenChange={setOpen}
            format="aventuras-calendar"
            supportedMajor={1}
            payloadKey="calendar"
            schema={CalendarStubSchema}
            title="Import calendar"
            onValidated={() => {}}
            _initialState={{
              kind: 'payload-error',
              // Many issues so the bounded-scroll path is exercised on
              // desktop / tablet (the list overflows the 200px max-height cap).
              issues: [
                ...payloadIssues,
                { path: 'calendar.units[3].name', message: 'Required.' },
                { path: 'calendar.units[4].length', message: 'Must be a positive number.' },
                { path: 'calendar.units[5].name', message: 'Required.' },
                { path: 'calendar.eras[0]', message: 'Must be a non-empty string.' },
                { path: 'calendar.eras[1]', message: 'Must be a non-empty string.' },
                { path: 'calendar.eras[2]', message: 'Must be a non-empty string.' },
                { path: 'calendar.eras[3]', message: 'Must be a non-empty string.' },
              ],
            }}
          />
        </View>
      )
    }
    return <Wrapper />
  },
  parameters: {
    docs: {
      description: {
        story:
          'Click `Show details` in the banner to open the issues list. On desktop / tablet the list scrolls inside a 200px cap; on phone the whole dialog body scrolls.',
      },
    },
  },
}

const closedDuringReadSpy = fn()

// Cancel while the clipboard read is pending: the late result must not reach the host.
export const ClosedDuringRead: Story = {
  render: () => (
    <ControlledDialog
      initialOpen
      format="aventuras-calendar"
      title="Import calendar"
      payloadKey="calendar"
      schema={CalendarStubSchema}
      onValidated={closedDuringReadSpy}
    />
  ),
  play: async () => {
    closedDuringReadSpy.mockClear()
    let resolveRead: (text: string) => void = () => {}
    const readText = fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve
        }),
    )
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
    try {
      const dialog = await findDialog()
      await userEvent.click(
        await within(dialog).findByRole('button', { name: t('common:importDialog.fromClipboard') }),
      )
      await waitFor(() => expect(readText).toHaveBeenCalled(), WAIT)
      await userEvent.click(within(dialog).getByRole('button', { name: t('common:cancel') }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull()
      }, WAIT)
      resolveRead(
        JSON.stringify({
          format: 'aventuras-calendar',
          formatVersion: '1.0',
          calendar: { units: [{ name: 'day', length: 1 }], eras: ['Age'] },
        }),
      )
      // Let the pipeline's settle handlers run before asserting nothing happened.
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(closedDuringReadSpy).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  },
}

// Closed — host wiring demo; user clicks Button to open.
export const Closed: Story = {
  render: () => (
    <ControlledDialog
      initialOpen={false}
      format="aventuras-story"
      title="Import story"
      payloadKey="story"
      schema={StoryStubSchema}
    />
  ),
}
