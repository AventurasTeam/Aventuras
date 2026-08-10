import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { GENRE_PRESETS, type WizardPreset } from '@/lib/wizard'

import { PresetBrowser } from './preset-browser'

// PresetBrowser is a pure list-and-pick surface — no async, no state beyond
// open/closed — so fixtures lean on the real GENRE_PRESETS catalog rather
// than a hand-authored stand-in, exercising the actual 10-row shape.

type DemoProps = {
  presets: readonly WizardPreset[]
  ariaLabel: string
  onPick: (preset: WizardPreset) => void
}

function Demo({ presets, ariaLabel, onPick }: DemoProps) {
  const [picked, setPicked] = useState('(none)')
  return (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <Text size="sm" variant="muted">
        Picked: {picked}
      </Text>
      <PresetBrowser
        presets={presets}
        ariaLabel={ariaLabel}
        onPick={(preset) => {
          setPicked(preset.displayName)
          onPick(preset)
        }}
      />
    </View>
  )
}

const meta: Meta<typeof PresetBrowser> = {
  title: 'Compounds/Wizard/PresetBrowser',
  component: PresetBrowser,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof PresetBrowser>

export const TriggerOpensOverlay: Story = {
  render: () => <Demo presets={GENRE_PRESETS} ariaLabel="Browse genre presets" onPick={fn()} />,
  play: async () => {
    expect(screen.queryByText(GENRE_PRESETS[0].displayName)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Browse presets' }))
    expect(await screen.findByText(GENRE_PRESETS[0].displayName)).toBeInTheDocument()
  },
}

export const AllPresetsRenderNameAndTagline: Story = {
  render: () => <Demo presets={GENRE_PRESETS} ariaLabel="Browse genre presets" onPick={fn()} />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Browse presets' }))
    await screen.findByText(GENRE_PRESETS[0].displayName)
    for (const preset of GENRE_PRESETS) {
      expect(screen.getByText(preset.displayName)).toBeInTheDocument()
      expect(screen.getByText(preset.tagline)).toBeInTheDocument()
    }
  },
}

const pickMock = fn()
export const PickingRowReportsExactPresetAndCloses: Story = {
  render: () => <Demo presets={GENRE_PRESETS} ariaLabel="Browse genre presets" onPick={pickMock} />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Browse presets' }))
    const noir = GENRE_PRESETS.find((preset) => preset.id === 'noir')
    if (noir == null) throw new Error('expected a "noir" fixture in GENRE_PRESETS')

    await userEvent.click(await screen.findByText(noir.displayName))
    await waitFor(() => expect(pickMock).toHaveBeenCalledWith(noir))
    expect(await screen.findByText('Picked: Noir')).toBeInTheDocument()
    // The overlay closed — a sibling row's chrome is gone from the DOM.
    expect(screen.queryByText('Space opera')).not.toBeInTheDocument()
  },
}

// useTier() reads the real browser window width, not a wrapper's — resize
// the Storybook preview below 640px to see the trigger open a bottom Sheet
// instead of a Popover (mirrors AiAssist's PhoneSheetNote).
export const PhoneSheetNote: Story = {
  render: () => (
    <View style={{ width: 360 }} className="gap-2 rounded-md bg-bg-base p-4">
      <Text variant="muted" size="sm">
        Resize the Storybook window itself below 640px to see the trigger open a bottom Sheet
        instead of a Popover.
      </Text>
      <Demo presets={GENRE_PRESETS} ariaLabel="Browse genre presets" onPick={fn()} />
    </View>
  ),
}
