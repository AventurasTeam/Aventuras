import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { ActionsMenu, type ActionGroup } from './actions-menu'
import { ImporterMenu, type ImporterMenuOption } from './importer-menu'

const meta: Meta<typeof ImporterMenu> = {
  title: 'Compounds/ImporterMenu',
  component: ImporterMenu,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ImporterMenu>

const ENTITY_OPTIONS: ImporterMenuOption[] = [
  { key: 'blank', label: 'Blank', onPress: fn() },
  { key: 'json', label: 'From JSON file…', onPress: fn() },
  {
    key: 'vault',
    label: 'From Vault…',
    disabled: true,
    disabledReason: 'Vault library coming later.',
  },
]

const CALENDAR_OPTIONS: ImporterMenuOption[] = [
  {
    key: 'clone',
    label: 'Clone built-in…',
    description: 'Start from Earth, Imperial Japan, or another preset.',
    onPress: fn(),
  },
  {
    key: 'json',
    label: 'From JSON file…',
    description: 'Upload an .avts file with a calendar envelope.',
    onPress: fn(),
  },
  {
    key: 'scratch',
    label: 'From scratch',
    description: 'Build leap rules and era sets manually.',
    disabled: true,
    disabledReason: 'Deferred to L3 — clone an existing calendar for now.',
  },
]

/**
 * Per-row entity import menu — the canonical shape on World / Plot
 * panes' `+ New X ▾` affordance.
 */
export const PerRowEntity: Story = {
  args: {
    label: '+ New character',
    options: ENTITY_OPTIONS,
  },
}

/**
 * Calendar add menu — three-option variant with sub-line
 * descriptions per option, matching the Vault calendars surface.
 */
export const CalendarAdd: Story = {
  args: {
    label: '+ Add calendar',
    options: CALENDAR_OPTIONS,
  },
}

/**
 * Two-option case — story-list import surface only ever offers
 * `From JSON file…` plus a deferred `From Vault…` placeholder. Menu
 * still renders sensibly with two items.
 */
export const TwoOptions: Story = {
  args: {
    label: 'Import story',
    options: [
      { key: 'json', label: 'From JSON file…', onPress: fn() },
      {
        key: 'vault',
        label: 'From Vault…',
        disabled: true,
        disabledReason: 'Vault library coming later.',
      },
    ],
  },
}

/**
 * Trigger disabled — entire affordance gated, e.g. while the story
 * is in a write-locked state. Menu can't open.
 */
export const TriggerDisabled: Story = {
  args: {
    label: '+ New character',
    options: ENTITY_OPTIONS,
    disabled: true,
  },
}

/**
 * Secondary variant — when the affordance is one of several actions
 * in a row and shouldn't claim the primary slot.
 */
export const SecondaryVariant: Story = {
  args: {
    label: 'Import story',
    options: [
      { key: 'json', label: 'From JSON file…', onPress: fn() },
      {
        key: 'vault',
        label: 'From Vault…',
        disabled: true,
        disabledReason: 'Vault library coming later.',
      },
    ],
    variant: 'secondary',
  },
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-4 p-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md border border-border bg-bg-base p-4"
        >
          <Text variant="muted" size="xs" className="mb-2">
            {t.name}
          </Text>
          <ImporterMenu label="+ New character" options={ENTITY_OPTIONS} />
        </View>
      ))}
    </View>
  ),
}

export const OpensOnTriggerClick: Story = {
  // Uncontrolled (no `open` prop) — pins that a real click still reports exactly once.
  args: { label: '+ New character', options: ENTITY_OPTIONS, onOpenChange: fn() },
  play: async ({ args }) => {
    const trigger = screen.getByRole('button', { name: /\+ New character/ })
    await userEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Blank' })).toBeInTheDocument())
    expect(args.onOpenChange).toHaveBeenCalledTimes(1)
    expect(args.onOpenChange).toHaveBeenNthCalledWith(1, true)
  },
}

export const EnabledOptionFires: Story = {
  args: {
    label: '+ New character',
    options: [
      { key: 'blank', label: 'Blank', onPress: fn() },
      { key: 'json', label: 'From JSON file…', onPress: fn() },
    ],
  },
  play: async ({ args }) => {
    const trigger = screen.getByRole('button', { name: /\+ New character/ })
    await userEvent.click(trigger)
    const blank = await screen.findByRole('menuitem', { name: 'Blank' })
    await userEvent.click(blank)
    await waitFor(() => expect(args.options[0].onPress).toHaveBeenCalled())
  },
}

export const DisabledOptionDoesNotFire: Story = {
  args: { label: '+ New character', options: ENTITY_OPTIONS },
  play: async () => {
    const trigger = screen.getByRole('button', { name: /\+ New character/ })
    await userEvent.click(trigger)
    const vaultItem = await screen.findByRole('menuitem', { name: /Vault library coming later/ })
    expect(vaultItem).toHaveAttribute('aria-disabled', 'true')
    // Don't try to click — the inline `pointerEvents: 'none'` style
    // makes userEvent refuse anyway. The aria-disabled assertion is
    // what guarantees the action can't fire.
  },
}

/**
 * Icon trigger — bare `[+]`; `label` doubles as the accessible name and, via
 * `ReasonTooltip`, the hover tooltip. Opens like the button trigger, aligned to its end edge.
 */
export const IconTrigger: Story = {
  args: { label: 'New character', options: ENTITY_OPTIONS, trigger: 'icon' },
  play: async () => {
    expect(screen.getByTitle('New character')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New character' }))
    expect(await screen.findByRole('menuitem', { name: 'Blank' })).toBeInTheDocument()
    expect(document.querySelector('[data-align="end"]')).not.toBeNull()
  },
}

function ControlledHarness() {
  const [open, setOpen] = useState(false)
  return (
    <View className="flex-col gap-3">
      <View className="flex-row items-center gap-3">
        <Button variant="secondary" onPress={() => setOpen(true)}>
          <Text>Open from outside</Text>
        </Button>
        <Button variant="secondary" onPress={() => setOpen(false)}>
          <Text>Close from outside</Text>
        </Button>
        <ImporterMenu
          label="New lore"
          options={ENTITY_OPTIONS}
          trigger="icon"
          open={open}
          onOpenChange={setOpen}
        />
      </View>
      <Text testID="controlled-open-state">{open ? 'open' : 'closed'}</Text>
    </View>
  )
}

/**
 * Flipping `open` externally must round-trip through `onOpenChange` for both
 * an outside close and a self-initiated pick, not just echo stale state.
 */
export const ControlledOpen: Story = {
  render: () => <ControlledHarness />,
  play: async () => {
    const openButton = screen.getByRole('button', { name: 'Open from outside' })
    const closeButton = screen.getByRole('button', { name: 'Close from outside' })

    await userEvent.click(openButton)
    await screen.findByRole('menuitem', { name: 'Blank' })
    await waitFor(() =>
      expect(screen.getByTestId('controlled-open-state')).toHaveTextContent('open'),
    )

    await userEvent.click(closeButton)
    await waitFor(() =>
      expect(screen.getByTestId('controlled-open-state')).toHaveTextContent('closed'),
    )
    expect(screen.queryByRole('menuitem', { name: 'Blank' })).not.toBeInTheDocument()

    await userEvent.click(openButton)
    const blank = await screen.findByRole('menuitem', { name: 'Blank' })

    await userEvent.click(blank)
    await waitFor(() =>
      expect(screen.getByTestId('controlled-open-state')).toHaveTextContent('closed'),
    )
    expect(screen.queryByRole('menuitem', { name: 'Blank' })).not.toBeInTheDocument()

    await userEvent.click(openButton)
    expect(await screen.findByRole('menuitem', { name: 'Blank' })).toBeInTheDocument()
  },
}

function ParentClosesWithoutInteractionHarness() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => setOpen(false), 250)
    return () => clearTimeout(timer)
  }, [open])
  return (
    <View className="flex-col gap-3">
      <Button variant="secondary" onPress={() => setOpen(true)}>
        <Text>Open from outside</Text>
      </Button>
      <ImporterMenu
        label="New lore"
        options={ENTITY_OPTIONS}
        trigger="icon"
        open={open}
        onOpenChange={setOpen}
      />
      <Text testID="parent-close-state">{open ? 'open' : 'closed'}</Text>
    </View>
  )
}

/**
 * A parent-driven close with no click must resolve through the sync effect's
 * own `close()` call, not the primitive's (unreachable) outside-click dismissal.
 */
export const ParentClosesWithoutInteraction: Story = {
  render: () => <ParentClosesWithoutInteractionHarness />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Open from outside' }))
    await screen.findByRole('menuitem', { name: 'Blank' })

    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'Blank' })).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('parent-close-state')).toHaveTextContent('closed')
  },
}

function ActionsMenuOpensImporterHarness() {
  const [open, setOpen] = useState(false)
  const contextual: ActionGroup = {
    id: 'world-context',
    header: 'On this screen',
    entries: [{ id: 'add-entity', label: 'Add entity…', onActivate: () => setOpen(true) }],
  }
  return (
    <View className="flex-row items-center gap-3" style={{ minHeight: 280 }}>
      <ActionsMenu contextual={contextual} coreGroups={[]} />
      <ImporterMenu
        label="New entity"
        options={ENTITY_OPTIONS}
        trigger="icon"
        open={open}
        onOpenChange={setOpen}
      />
    </View>
  )
}

/**
 * Activating a contextual entry that opens this icon `ImporterMenu` must not let the closing
 * Actions popover steal focus back a tick later — covers mouse and keyboard-Enter activation.
 */
export const ActionsMenuEntryOpensImporter: Story = {
  render: () => <ActionsMenuOpensImporterHarness />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: /Actions/ }))
    const entry = await screen.findByRole('option', { name: 'Add entity…' })
    await userEvent.click(entry)

    const blank = await screen.findByRole('menuitem', { name: 'Blank' })
    expect(document.activeElement).toBe(blank)
    // Assert past onCloseAutoFocus's tick-after-unmount fire, not just at the activation instant.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('menuitem', { name: 'Blank' })).toBeInTheDocument()
    expect(document.activeElement).toBe(blank)

    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'Blank' })).not.toBeInTheDocument(),
    )

    await userEvent.keyboard('{Control>}k{/Control}')
    await screen.findByRole('option', { name: 'Add entity…' })
    await userEvent.keyboard('{ArrowDown}{Enter}')

    const blankAgain = await screen.findByRole('menuitem', { name: 'Blank' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('menuitem', { name: 'Blank' })).toBeInTheDocument()
    expect(document.activeElement).toBe(blankAgain)
  },
}

const onOpenChangeSpy = fn()

function OnOpenChangeSpyHarness() {
  const [open, setOpen] = useState(false)
  return (
    <ImporterMenu
      label="New entity"
      options={ENTITY_OPTIONS}
      trigger="icon"
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChangeSpy(next)
      }}
    />
  )
}

/**
 * The sync effect re-drives the primitive after every report it causes; unfiltered, a single
 * click or pick would echo `onOpenChange` twice. Pins the call count and argument per step.
 */
export const OnOpenChangeReportsOnlyRealChanges: Story = {
  render: () => <OnOpenChangeSpyHarness />,
  play: async () => {
    expect(onOpenChangeSpy).not.toHaveBeenCalled()

    const trigger = screen.getByRole('button', { name: 'New entity' })
    await userEvent.click(trigger)
    await screen.findByRole('menuitem', { name: 'Blank' })
    expect(onOpenChangeSpy).toHaveBeenCalledTimes(1)
    expect(onOpenChangeSpy).toHaveBeenNthCalledWith(1, true)

    await userEvent.click(screen.getByRole('menuitem', { name: 'Blank' }))
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'Blank' })).not.toBeInTheDocument(),
    )
    expect(onOpenChangeSpy).toHaveBeenCalledTimes(2)
    expect(onOpenChangeSpy).toHaveBeenNthCalledWith(2, false)
  },
}

function ControlledOpenIgnoredWhileDisabledHarness() {
  const [open, setOpen] = useState(true)
  return (
    <View className="flex-col gap-3">
      <ImporterMenu
        label="New entity"
        options={ENTITY_OPTIONS}
        trigger="icon"
        disabled
        open={open}
        onOpenChange={setOpen}
      />
      <Text testID="disabled-open-state">{open ? 'open' : 'closed'}</Text>
    </View>
  )
}

/**
 * A controlled `open={true}` must not force the menu over a disabled trigger,
 * and the refusal must report back or the menu pops open once it re-enables.
 */
export const ControlledOpenIgnoredWhileDisabled: Story = {
  render: () => <ControlledOpenIgnoredWhileDisabledHarness />,
  play: async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.queryByRole('menuitem', { name: 'Blank' })).not.toBeInTheDocument()
    expect(screen.getByTestId('disabled-open-state')).toHaveTextContent('closed')
  },
}

const onOpenChangeRerenderSpy = fn()

function RerenderWithFreshCallbackHarness() {
  const [, forceRerender] = useState(0)
  return (
    <View className="flex-col gap-3">
      <Button variant="secondary" onPress={() => forceRerender((n) => n + 1)}>
        <Text>Re-render parent</Text>
      </Button>
      <ImporterMenu
        label="New entity"
        options={ENTITY_OPTIONS}
        trigger="icon"
        disabled
        open
        onOpenChange={(next) => onOpenChangeRerenderSpy(next)}
      />
    </View>
  )
}

/**
 * A parent re-rendering with a fresh inline `onOpenChange` (never memoized) must not re-drive
 * the disabled refusal each time — the sync effect is keyed on open/disabled only.
 */
export const RerenderWithFreshCallbackDoesNotReDriveRefusal: Story = {
  render: () => <RerenderWithFreshCallbackHarness />,
  play: async () => {
    await waitFor(() => expect(onOpenChangeRerenderSpy).toHaveBeenCalledTimes(1))

    const rerenderButton = screen.getByRole('button', { name: 'Re-render parent' })
    await userEvent.click(rerenderButton)
    await userEvent.click(rerenderButton)
    await userEvent.click(rerenderButton)

    expect(onOpenChangeRerenderSpy).toHaveBeenCalledTimes(1)
  },
}

function UncontrolledDisabledWhileOpenHarness() {
  const [disabled, setDisabled] = useState(false)
  return (
    <ImporterMenu
      label="New entity"
      options={ENTITY_OPTIONS}
      trigger="icon"
      disabled={disabled}
      // Observer only (no `open`): disables the menu a beat after it opens, with no outside click.
      onOpenChange={(next) => {
        if (next) setTimeout(() => setDisabled(true), 100)
      }}
    />
  )
}

/**
 * An uncontrolled menu that becomes disabled while open must close, or its items stay
 * actionable under a disabled trigger.
 */
export const UncontrolledMenuClosesWhenDisabled: Story = {
  render: () => <UncontrolledDisabledWhileOpenHarness />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'New entity' }))
    await screen.findByRole('menuitem', { name: 'Blank' })
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'Blank' })).not.toBeInTheDocument(),
    )
  },
}

const onDisabledWhileOpenSpy = fn()

function ControlledDisabledWhileOpenHarness() {
  const [open, setOpen] = useState(false)
  const [disabled, setDisabled] = useState(false)
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => setDisabled(true), 100)
    return () => clearTimeout(timer)
  }, [open])
  return (
    <View className="flex-col gap-3">
      <ImporterMenu
        label="New entity"
        options={ENTITY_OPTIONS}
        trigger="icon"
        disabled={disabled}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          onDisabledWhileOpenSpy(next)
        }}
      />
      <Text testID="disabled-while-open-state">{open ? 'open' : 'closed'}</Text>
    </View>
  )
}

/** A controlled menu disabled while open closes and reports that close exactly once. */
export const ControlledMenuReportsCloseOnceWhenDisabled: Story = {
  render: () => <ControlledDisabledWhileOpenHarness />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'New entity' }))
    await screen.findByRole('menuitem', { name: 'Blank' })
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'Blank' })).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('disabled-while-open-state')).toHaveTextContent('closed')
    expect(onDisabledWhileOpenSpy.mock.calls).toEqual([[true], [false]])
  },
}
