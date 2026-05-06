import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

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
  args: { label: '+ New character', options: ENTITY_OPTIONS },
  play: async () => {
    const trigger = screen.getByRole('button', { name: /\+ New character/ })
    await userEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Blank' })).toBeInTheDocument())
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
