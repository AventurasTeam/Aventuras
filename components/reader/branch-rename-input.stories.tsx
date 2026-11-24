import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'

import { BranchRenameInput, type BranchRenameInputProps } from './branch-rename-input'

const TABLET = { viewport: { value: 'tablet' } }
const PHONE = { viewport: { value: 'mobile1' } }
// CI runs plays several times slower than local.
const ANIMATION = { timeout: 3000 }

function TierMark() {
  return <Text testID="tier">{useTier()}</Text>
}

async function waitForTier(tier: 'desktop' | 'tablet' | 'phone') {
  await waitFor(() => expect(screen.getByTestId('tier')).toHaveTextContent(tier))
}

/** Stands in for the navigator row: the input while renaming, the stored name once `onDone` runs.
 * F2 toggles the input from the document, as the navigator closing does: no blur runs. */
function RowHarness(props: BranchRenameInputProps) {
  const [editing, setEditing] = useState(true)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') setEditing((value) => !value)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return (
    <View className="w-80 gap-3 p-4">
      <TierMark />
      {editing ? (
        <BranchRenameInput
          {...props}
          onDone={() => {
            props.onDone()
            setEditing(false)
          }}
        />
      ) : (
        <Text testID="stored-name">{props.name}</Text>
      )}
      <Pressable accessibilityRole="button" aria-label="Elsewhere" className="p-2">
        <Text>Elsewhere</Text>
      </Pressable>
    </View>
  )
}

const rowPressed = fn()
// RN-Web never calls onPress for a key released on an <input>; a propagated keydown still
// starts a press.
const rowPressStarted = fn()

/** The input inside a pressable, as a row body would hold it: no key may press the row. */
function InPressableHarness(props: BranchRenameInputProps) {
  return (
    <View className="w-80 gap-3 p-4">
      <TierMark />
      <Pressable
        accessibilityRole="button"
        aria-label="Row"
        onPress={rowPressed}
        onPressIn={rowPressStarted}
        className="p-2"
      >
        <BranchRenameInput {...props} />
      </Pressable>
    </View>
  )
}

// gorhom's container fills this stage, so a detent is a share of the stage's height.
function SheetHarness(props: BranchRenameInputProps) {
  const { height } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  return (
    <View style={{ height, padding: 16, gap: 8, alignItems: 'flex-start' }}>
      <TierMark />
      <Pressable accessibilityRole="button" aria-label="Open sheet" onPress={() => setOpen(true)}>
        <Text>Open sheet</Text>
      </Pressable>
      <Sheet open={open} onOpenChange={setOpen} ariaLabel="Branches">
        <SheetContent size="short">
          {editing ? (
            <BranchRenameInput
              {...props}
              onDone={() => {
                props.onDone()
                setEditing(false)
              }}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              aria-label="Rename"
              onPress={() => setEditing(true)}
            >
              <Text>{props.name}</Text>
            </Pressable>
          )}
        </SheetContent>
      </Sheet>
    </View>
  )
}

const sheet = () => screen.getByRole('dialog', { name: 'Branches' })

// gorhom's content keeps rising after it turns visible; a press below the window makes the
// browser scroll the container and lift the Sheet.
async function waitForSheetSettled() {
  let last = Number.NaN
  let still = 0
  await waitFor(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const top = sheet().getBoundingClientRect().top
    still = Math.abs(top - last) < 0.5 ? still + 1 : 0
    last = top
    expect(still).toBeGreaterThanOrEqual(5)
  }, ANIMATION)
}

/** The field once it holds focus with its text selected: typing then replaces the name. */
async function renameField() {
  const field = (await screen.findByRole('textbox', { name: 'Branch name' })) as HTMLInputElement
  // selectTextOnFocus selects a tick after focus; typing before it would append.
  await waitFor(() => {
    expect(field).toHaveFocus()
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(field.value.length)
  })
  return field
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const meta: Meta<typeof BranchRenameInput> = {
  title: 'Compounds/Reader/BranchRenameInput',
  component: BranchRenameInput,
  parameters: { layout: 'fullscreen' },
  args: { name: 'The road not taken', onSave: fn(() => Promise.resolve()), onDone: fn() },
  render: (args) => <RowHarness {...args} />,
}

export default meta
type Story = StoryObj<typeof BranchRenameInput>

export const OpensPrefilledAndSelected: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    const field = await renameField()
    await expect(field).toHaveValue('The road not taken')
    expect(field.selectionEnd).toBe(18)
    await expect(field).not.toHaveClass('border-danger')
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}

export const EnterSavesTrimmed: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await renameField()
    await userEvent.keyboard('  The  trap  {Enter}')
    await waitFor(() => expect(args.onDone).toHaveBeenCalledTimes(1))
    await expect(args.onSave).toHaveBeenCalledTimes(1)
    // Ends only: the inner spaces are the user's.
    await expect(args.onSave).toHaveBeenCalledWith('The  trap')
    await expect(screen.queryByRole('textbox', { name: 'Branch name' })).toBeNull()
  },
}

export const BlurSaves: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await renameField()
    await userEvent.keyboard('The trap')
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
    await waitFor(() => expect(args.onDone).toHaveBeenCalledTimes(1))
    await expect(args.onSave).toHaveBeenCalledTimes(1)
    await expect(args.onSave).toHaveBeenCalledWith('The trap')
  },
}

export const EscCancels: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await renameField()
    await userEvent.keyboard('The trap{Escape}')
    await expect(args.onDone).toHaveBeenCalledTimes(1)
    await expect(await screen.findByTestId('stored-name')).toHaveTextContent('The road not taken')
    await pause(50)
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** A capture listener on the document holds the event past the field; its verdict comes after. */
export const EscMarksTheKeyHandled: Story = {
  play: async () => {
    await waitForTier('desktop')
    await renameField()
    const seen: KeyboardEvent[] = []
    const record = (event: KeyboardEvent) => seen.push(event)
    document.addEventListener('keydown', record, true)
    try {
      await userEvent.keyboard('{Escape}')
    } finally {
      document.removeEventListener('keydown', record, true)
    }
    expect(seen).toHaveLength(1)
    expect(seen[0].defaultPrevented).toBe(true)
  },
}

export const UnchangedCommitSavesNothing: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await renameField()
    await userEvent.keyboard('{Enter}')
    await expect(args.onDone).toHaveBeenCalledTimes(1)
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}

export const EmptyIsRefused: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    const field = await renameField()
    await userEvent.keyboard('{Backspace}{Enter}')
    await expect(field).toHaveValue('')
    await expect(field).toHaveClass('border-danger')
    // Still the user's to fix: the refused Enter keeps the field focused.
    await expect(field).toHaveFocus()

    await userEvent.keyboard('   {Enter}')
    await expect(field).toHaveValue('   ')
    await expect(field).toHaveClass('border-danger')

    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
    await expect(field).toBeInTheDocument()
    await expect(field).toHaveClass('border-danger')
    await expect(args.onSave).not.toHaveBeenCalled()
    await expect(args.onDone).not.toHaveBeenCalled()

    await userEvent.click(field)
    await userEvent.keyboard('X')
    await waitFor(() => expect(field).not.toHaveClass('border-danger'))
  },
}

export const HeldWhileSaving: Story = {
  args: { onSave: fn() },
  play: async ({ args }) => {
    const pending: (() => void)[] = []
    ;(args.onSave as ReturnType<typeof fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pending.push(resolve)
        }),
    )
    await waitForTier('desktop')
    const field = await renameField()
    await userEvent.keyboard('The trap{Enter}')
    await expect(field).toHaveAttribute('readonly')
    // A second Enter and a blur while the write runs save nothing more.
    await userEvent.keyboard('{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
    await expect(args.onSave).toHaveBeenCalledTimes(1)
    await expect(args.onDone).not.toHaveBeenCalled()

    for (const resolve of pending) resolve()
    await waitFor(() => expect(args.onDone).toHaveBeenCalledTimes(1))
    await expect(screen.queryByRole('textbox', { name: 'Branch name' })).toBeNull()
  },
}

export const UnmountSavesAValidChange: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await renameField()
    await userEvent.keyboard('  The trap  ')
    await userEvent.keyboard('{F2}')
    await screen.findByTestId('stored-name')
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1))
    await expect(args.onSave).toHaveBeenCalledWith('The trap')
    // A commit would call onDone once its save settled; the unmount has nothing left to collapse,
    // so onDone staying uncalled shows the save came from the unmount.
    await pause(50)
    await expect(args.onDone).not.toHaveBeenCalled()
  },
}

export const UnmountDropsEmptyOrUnchanged: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await renameField()
    await userEvent.keyboard('{F2}')
    await screen.findByTestId('stored-name')

    await userEvent.keyboard('{F2}')
    await renameField()
    await userEvent.keyboard('{Backspace}')
    await userEvent.keyboard('{F2}')
    await screen.findByTestId('stored-name')

    await pause(50)
    await expect(args.onSave).not.toHaveBeenCalled()
    await expect(args.onDone).not.toHaveBeenCalled()
  },
}

export const KeysStayInTheInput: Story = {
  render: (args) => <InPressableHarness {...args} />,
  play: async ({ args }) => {
    rowPressed.mockClear()
    rowPressStarted.mockClear()
    await waitForTier('desktop')
    await renameField()
    await userEvent.keyboard('a b{Enter}')
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith('a b'))
    await expect(rowPressed).not.toHaveBeenCalled()
    await expect(rowPressStarted).not.toHaveBeenCalled()
  },
}

export const TabletEnterSaves: Story = {
  globals: TABLET,
  play: async ({ args }) => {
    await waitForTier('tablet')
    await renameField()
    await userEvent.keyboard('The trap{Enter}')
    await waitFor(() => expect(args.onDone).toHaveBeenCalledTimes(1))
    await expect(args.onSave).toHaveBeenCalledWith('The trap')
  },
}

/** The bottom Sheet's Escape listens on the document; a key the field handled never reaches it. */
export const PhoneSheetEscCancelsOnlyTheRename: Story = {
  globals: PHONE,
  render: (args) => <SheetHarness {...args} />,
  play: async ({ args }) => {
    await waitForTier('phone')
    await userEvent.click(screen.getByRole('button', { name: 'Open sheet' }))
    await waitForSheetSettled()
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await renameField()
    await userEvent.keyboard('The trap{Escape}')
    await expect(args.onDone).toHaveBeenCalledTimes(1)
    await expect(await screen.findByRole('button', { name: 'Rename' })).toBeVisible()
    await pause(300)
    await expect(sheet()).toBeVisible()
    await expect(args.onSave).not.toHaveBeenCalled()

    // With no field focused, Escape is the Sheet's again.
    await userEvent.keyboard('{Escape}')
    await waitFor(
      () => expect(screen.queryByRole('dialog', { name: 'Branches' })).toBeNull(),
      ANIMATION,
    )
  },
}
