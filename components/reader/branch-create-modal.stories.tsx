import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'

import { BranchCreateModal, type BranchCreateModalProps } from './branch-create-modal'

// CI runs plays several times slower than local; every wait uses this.
const WAIT = { timeout: 5000 }
const TABLET = { viewport: { value: 'tablet' } }
const PHONE = { viewport: { value: 'phone390' } }

const COPY = {
  title: 'New branch',
  context: 'Branching from entry 47.',
  name: 'Name',
  cancel: 'Cancel',
  create: 'Create',
  close: 'Close',
  gate: 'Generation is in flight. Cancel to edit.',
  swap: 'Unavailable while the embedder switch finishes.',
  unfinishedRun:
    'The memory work after this entry never finished, so branch from an earlier entry.',
  entryGone: 'This entry is no longer on the branch.',
  failed: "Couldn't create the branch.",
}

function TierMark() {
  return <Text testID="tier">{useTier()}</Text>
}

async function waitForTier(tier: 'desktop' | 'tablet' | 'phone') {
  await waitFor(() => expect(screen.getByTestId('tier')).toHaveTextContent(tier), WAIT)
}

async function findModal(): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog', { name: COPY.title }, WAIT)
  await waitFor(() => expect(dialog).toBeVisible(), WAIT)
  return dialog
}

const nameField = (dialog: HTMLElement) =>
  within(dialog).getByRole('textbox', { name: COPY.name }) as HTMLInputElement
const button = (dialog: HTMLElement, name: string) => within(dialog).getByRole('button', { name })
/** The styled panel inside Radix's own role=dialog wrapper, which shrinks to its content. */
function panelWidth(dialog: HTMLElement): number {
  const panel = dialog.firstElementChild
  if (panel == null) throw new Error("the modal's panel is not rendered")
  return panel.getBoundingClientRect().width
}

/** About 360 px, less the dialog's 16 px gutter each side where the viewport is narrower. */
const expectedPanelWidth = () => Math.min(360, window.innerWidth - 32)

const isDisabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true'

/** The host as it presses: pending from the press on. */
function PendsOnCreate(props: BranchCreateModalProps) {
  const [pending, setPending] = useState(false)
  return (
    <BranchCreateModal
      {...props}
      pending={pending}
      onCreate={(name) => {
        props.onCreate(name)
        setPending(true)
      }}
    />
  )
}

/** The host as a refusal lands: pending ends and the refusal's line shows. */
function RefusesOnCreate({ line, ...props }: BranchCreateModalProps & { line: string }) {
  const [message, setMessage] = useState<string | null>(null)
  return (
    <BranchCreateModal
      {...props}
      message={message}
      onCreate={(name) => {
        props.onCreate(name)
        setMessage(line)
      }}
    />
  )
}

/** F2 starts or ends a swap, as the hook recomputes the props each render; a press meets the gate. */
function SwapToggles(props: BranchCreateModalProps) {
  const [swapping, setSwapping] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') setSwapping((on) => !on)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return (
    <BranchCreateModal
      {...props}
      message={message}
      createBlockedReason={swapping ? t('reader:actions.blockedWhileSwapping') : undefined}
      onCreate={(name) => {
        props.onCreate(name)
        setMessage(t('generationGate.inFlight'))
      }}
    />
  )
}

const meta: Meta<typeof BranchCreateModal> = {
  title: 'Compounds/Reader/BranchCreateModal',
  component: BranchCreateModal,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    open: true,
    entryPosition: 47,
    pending: false,
    message: null,
    onCreate: fn(),
    onCancel: fn(),
  },
  decorators: [
    (Story) => (
      <>
        <TierMark />
        <Story />
      </>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>
type PlayContext = Parameters<NonNullable<Story['play']>>[0]

/** branch-navigator.md → Branch creation — modal: the enable rule and Enter. */
async function shapePlay({ args }: PlayContext) {
  const dialog = await findModal()
  await expect(dialog).toHaveAccessibleDescription(COPY.context)
  expect(Math.abs(panelWidth(dialog) - expectedPanelWidth())).toBeLessThan(2)
  const field = nameField(dialog)
  await waitFor(() => expect(field).toHaveFocus(), WAIT)
  const create = button(dialog, COPY.create)
  expect(isDisabled(create)).toBe(true)
  await userEvent.type(field, '   ')
  expect(isDisabled(create)).toBe(true)
  await userEvent.keyboard('{Enter}')
  expect(args.onCreate).not.toHaveBeenCalled()
  await userEvent.clear(field)
  await userEvent.type(field, 'Side quest')
  await waitFor(() => expect(isDisabled(create)).toBe(false), WAIT)
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(args.onCreate).toHaveBeenCalledTimes(1), WAIT)
  expect(args.onCreate).toHaveBeenCalledWith('Side quest')
  expect(args.onCancel).not.toHaveBeenCalled()
}

/** `Cancel`, Esc and `×` each cancel; none creates. */
async function cancelPlay({ args }: PlayContext) {
  const dialog = await findModal()
  const onCancel = args.onCancel as ReturnType<typeof fn>
  await userEvent.click(button(dialog, COPY.cancel))
  await waitFor(() => expect(onCancel).toHaveBeenCalled(), WAIT)
  onCancel.mockClear()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(onCancel).toHaveBeenCalled(), WAIT)
  onCancel.mockClear()
  await userEvent.click(button(dialog, COPY.close))
  await waitFor(() => expect(onCancel).toHaveBeenCalled(), WAIT)
  expect(args.onCreate).not.toHaveBeenCalled()
}

/** A refusal or a failure: its line above the buttons, the name kept, `Create` live for a retry. */
function refusedPlay(line: string) {
  return async ({ args }: PlayContext) => {
    const dialog = await findModal()
    const field = nameField(dialog)
    const openWidth = panelWidth(dialog)
    await userEvent.type(field, 'Side quest')
    await userEvent.click(button(dialog, COPY.create))
    const alert = await within(dialog).findByRole('alert', {}, WAIT)
    expect(alert).toHaveTextContent(line)
    const create = button(dialog, COPY.create)
    expect(alert.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      create.getBoundingClientRect().top,
    )
    expect(field).toHaveValue('Side quest')
    expect(panelWidth(dialog)).toBeCloseTo(openWidth, 0)
    expect(isDisabled(create)).toBe(false)
    expect(args.onCreate).toHaveBeenCalledTimes(1)
    expect(args.onCreate).toHaveBeenCalledWith('Side quest')
    expect(args.onCancel).not.toHaveBeenCalled()
  }
}

/** Opens empty with the input focused and `Create` disabled, about 360 px wide. */
export const Empty: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    const dialog = await findModal()
    await expect(dialog).toHaveAccessibleDescription(COPY.context)
    const field = nameField(dialog)
    await waitFor(() => expect(field).toHaveFocus(), WAIT)
    expect(field).toHaveValue('')
    const create = button(dialog, COPY.create)
    expect(isDisabled(create)).toBe(true)
    expect(within(dialog).queryByRole('alert')).toBeNull()
    // Content-sized, the panel opens near 257 px and widens when a longer line appears.
    expect(panelWidth(dialog)).toBeGreaterThan(340)
    expect(panelWidth(dialog)).toBeLessThanOrEqual(360.5)
    await userEvent.click(create, { pointerEventsCheck: 0 })
    expect(args.onCreate).not.toHaveBeenCalled()
  },
}

/** A name enables `Create`, which sends it as typed: the action trims it. */
export const Typed: Story = {
  play: async ({ args }) => {
    const dialog = await findModal()
    const create = button(dialog, COPY.create)
    await userEvent.type(nameField(dialog), '  Side  quest ')
    await waitFor(() => expect(isDisabled(create)).toBe(false), WAIT)
    await userEvent.click(create)
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onCreate).toHaveBeenCalledWith('  Side  quest ')
  },
}

export const WhitespaceOnly: Story = {
  play: async ({ args }) => {
    const dialog = await findModal()
    await userEvent.type(nameField(dialog), '   ')
    const create = button(dialog, COPY.create)
    expect(isDisabled(create)).toBe(true)
    await userEvent.keyboard('{Enter}')
    await userEvent.click(create, { pointerEventsCheck: 0 })
    expect(args.onCreate).not.toHaveBeenCalled()
  },
}

export const EnterConfirms: Story = {
  play: async ({ args }) => {
    const dialog = await findModal()
    await userEvent.type(nameField(dialog), 'Side quest{Enter}')
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onCreate).toHaveBeenCalledWith('Side quest')
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

export const CancelEscAndClose: Story = {
  play: async (context) => {
    await waitForTier('desktop')
    await cancelPlay(context)
  },
}

export const Tablet: Story = {
  globals: TABLET,
  play: async (context) => {
    await waitForTier('tablet')
    await shapePlay(context)
  },
}

export const TabletCancels: Story = {
  globals: TABLET,
  play: async (context) => {
    await waitForTier('tablet')
    await cancelPlay(context)
  },
}

export const Phone390: Story = {
  globals: PHONE,
  play: async (context) => {
    await waitForTier('phone')
    await shapePlay(context)
  },
}

export const Phone390Cancels: Story = {
  globals: PHONE,
  play: async (context) => {
    await waitForTier('phone')
    await cancelPlay(context)
  },
}

/** From the press to the navigation: every control disabled, nothing closes, a second Enter sends nothing. */
export const Pending: Story = {
  render: (args) => <PendsOnCreate {...args} />,
  play: async ({ args }) => {
    const dialog = await findModal()
    const field = nameField(dialog)
    await userEvent.type(field, 'Side quest')
    await userEvent.keyboard('{Enter}')
    const create = button(dialog, COPY.create)
    await waitFor(() => expect(create).toHaveAttribute('aria-busy', 'true'), WAIT)
    const controls = [create, button(dialog, COPY.cancel), button(dialog, COPY.close)]
    for (const control of controls) expect(isDisabled(control)).toBe(true)
    expect(field).toHaveAttribute('readonly')

    // Past user-event's pointer check, so only the disabled wiring and the close guard stop these.
    await userEvent.type(field, '{Enter}')
    for (const control of controls) await userEvent.click(control, { pointerEventsCheck: 0 })
    await userEvent.keyboard('{Escape}')
    expect(args.onCreate).toHaveBeenCalledTimes(1)
    expect(args.onCreate).toHaveBeenCalledWith('Side quest')
    expect(args.onCancel).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()
  },
}

/** A click on `Create` disables the button it focused; focus stays in the dialog. */
export const PendingFromClick: Story = {
  render: (args) => <PendsOnCreate {...args} />,
  play: async ({ args }) => {
    const dialog = await findModal()
    await userEvent.type(nameField(dialog), 'Side quest')
    const create = button(dialog, COPY.create)
    await userEvent.click(create)
    await waitFor(() => expect(create).toHaveAttribute('aria-busy', 'true'), WAIT)
    await waitFor(() => expect(create).not.toHaveFocus(), WAIT)
    expect(document.activeElement).not.toBe(document.body)
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(args.onCreate).toHaveBeenCalledTimes(1)
  },
}

export const RefusedGate: Story = {
  render: (args) => <RefusesOnCreate {...args} line={t('generationGate.inFlight')} />,
  play: refusedPlay(COPY.gate),
}

export const RefusedUnfinishedRun: Story = {
  render: (args) => <RefusesOnCreate {...args} line={t('reader:branches.create.unfinishedRun')} />,
  play: refusedPlay(COPY.unfinishedRun),
}

export const RefusedEntryGone: Story = {
  render: (args) => <RefusesOnCreate {...args} line={t('reader:branches.create.entryGone')} />,
  play: refusedPlay(COPY.entryGone),
}

export const Failed: Story = {
  render: (args) => <RefusesOnCreate {...args} line={t('reader:branches.create.failed')} />,
  play: refusedPlay(COPY.failed),
}

/** A pending swap is known before any press: its line shows on open and `Create` stays disabled. */
export const RefusedOnOpen: Story = {
  args: { createBlockedReason: t('reader:actions.blockedWhileSwapping') },
  play: async ({ args }) => {
    const dialog = await findModal()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(COPY.swap)
    await userEvent.type(nameField(dialog), 'Side quest')
    const create = button(dialog, COPY.create)
    expect(isDisabled(create)).toBe(true)
    await userEvent.keyboard('{Enter}')
    await userEvent.click(create, { pointerEventsCheck: 0 })
    expect(args.onCreate).not.toHaveBeenCalled()
  },
}

/** A swap ending re-enables `Create`; one starting after a refusal keeps the refusal's line. */
export const SwapEnds: Story = {
  render: (args) => <SwapToggles {...args} />,
  play: async ({ args }) => {
    const dialog = await findModal()
    const create = button(dialog, COPY.create)
    await userEvent.type(nameField(dialog), 'Side quest')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(COPY.swap)
    expect(isDisabled(create)).toBe(true)

    await userEvent.keyboard('{F2}')
    await waitFor(() => expect(isDisabled(create)).toBe(false), WAIT)
    expect(within(dialog).queryByRole('alert')).toBeNull()

    await userEvent.click(create)
    await waitFor(
      () => expect(within(dialog).getByRole('alert')).toHaveTextContent(COPY.gate),
      WAIT,
    )
    expect(args.onCreate).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{F2}')
    await waitFor(() => expect(isDisabled(create)).toBe(true), WAIT)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(COPY.gate)

    await userEvent.keyboard('{F2}')
    await waitFor(() => expect(isDisabled(create)).toBe(false), WAIT)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(COPY.gate)
  },
}
