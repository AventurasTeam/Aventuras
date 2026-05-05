import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { SwitchRow } from './switch-row'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof SwitchRow> = {
  title: 'Compounds/SwitchRow',
  component: SwitchRow,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof SwitchRow>

const noop = () => {}

export const Default: Story = {
  args: {
    label: 'Enable feature',
    hint: 'Tap anywhere on the row to toggle.',
    checked: false,
    onCheckedChange: noop,
  },
  render: (args) => (
    <View style={{ width: 360 }}>
      <SwitchRow {...args} />
    </View>
  ),
}

export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = React.useState(false)
    return (
      <View style={{ width: 360 }}>
        <SwitchRow
          label="Enable feature"
          hint="Tap the label, hint, or switch — whole row toggles."
          checked={checked}
          onCheckedChange={setChecked}
        />
      </View>
    )
  },
}

export const NoHint: Story = {
  render: () => {
    const [checked, setChecked] = React.useState(true)
    return (
      <View style={{ width: 360 }}>
        <SwitchRow label="Enable feature" checked={checked} onCheckedChange={setChecked} />
      </View>
    )
  },
}

export const Disabled: Story = {
  render: () => (
    <View style={{ width: 360 }} className="gap-2">
      <SwitchRow
        label="Enabled, off"
        hint="Whole row toggles."
        checked={false}
        onCheckedChange={noop}
      />
      <SwitchRow
        label="Disabled, off"
        hint="Row presses are blocked."
        checked={false}
        onCheckedChange={noop}
        disabled
      />
      <SwitchRow
        label="Disabled, on"
        hint="Row presses are blocked."
        checked={true}
        onCheckedChange={noop}
        disabled
      />
    </View>
  ),
}

export const WithLeading: Story = {
  render: () => {
    const [ck, setCk] = React.useState(false)
    return (
      <View style={{ width: 360 }}>
        <SwitchRow
          leading={
            <Text size="sm" className={ck ? 'text-fg-primary' : 'text-fg-muted'}>
              ⊙
            </Text>
          }
          label="common_knowledge"
          hint={ck ? 'on — awareness rows are skipped' : 'bool · awareness skip'}
          checked={ck}
          onCheckedChange={setCk}
        />
      </View>
    )
  },
}

export const SettingsList: Story = {
  render: () => {
    const [showHints, setShowHints] = React.useState(true)
    const [autoSave, setAutoSave] = React.useState(true)
    const [previewLastChapter, setPreviewLastChapter] = React.useState(false)
    return (
      <View style={{ width: 480 }} className="gap-1 rounded-lg border border-border bg-bg-base p-2">
        <SwitchRow
          label="Show hints"
          hint="Surface contextual tips on hover or focus."
          checked={showHints}
          onCheckedChange={setShowHints}
        />
        <SwitchRow
          label="Auto-save drafts"
          hint="Periodic save while writing — recoverable if the app crashes."
          checked={autoSave}
          onCheckedChange={setAutoSave}
        />
        <SwitchRow
          label="Preview last chapter on open"
          hint="Default jumps to the most recent entry instead of the start."
          checked={previewLastChapter}
          onCheckedChange={setPreviewLastChapter}
        />
      </View>
    )
  },
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => {
        return (
          <View
            key={t.id}
            // @ts-expect-error — dataSet is RN-Web only.
            dataSet={{ theme: t.id }}
            className="rounded-md bg-bg-base p-2"
            style={{ width: 360 }}
          >
            <Text variant="muted" size="sm" className="mb-2 px-row-x-md">
              {t.name}
            </Text>
            <SwitchRow
              label="Enabled, off"
              hint="Tap-target spans the full row."
              checked={false}
              onCheckedChange={noop}
            />
            <SwitchRow
              label="Enabled, on"
              hint="Tap-target spans the full row."
              checked={true}
              onCheckedChange={noop}
            />
          </View>
        )
      })}
    </View>
  ),
}
