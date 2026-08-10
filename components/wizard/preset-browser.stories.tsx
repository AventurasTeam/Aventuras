import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { GENRE_PRESETS, TONE_PRESETS, type WizardPreset } from '@/lib/wizard'

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
    await userEvent.click(screen.getByRole('button', { name: 'Browse genre presets' }))
    expect(await screen.findByText(GENRE_PRESETS[0].displayName)).toBeInTheDocument()
  },
}

export const AllPresetsRenderNameAndTagline: Story = {
  render: () => <Demo presets={GENRE_PRESETS} ariaLabel="Browse genre presets" onPick={fn()} />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Browse genre presets' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Browse genre presets' }))
    const noir = GENRE_PRESETS.find((preset) => preset.id === 'noir')
    if (noir == null) throw new Error('expected a "noir" fixture in GENRE_PRESETS')

    await userEvent.click(await screen.findByText(noir.displayName))
    await waitFor(() => expect(pickMock).toHaveBeenCalledWith(noir))
    expect(await screen.findByText('Picked: Noir')).toBeInTheDocument()
    // The overlay closed — a sibling row's chrome is gone from the DOM.
    expect(screen.queryByText('Space opera')).not.toBeInTheDocument()
  },
}

const genrePickMock = fn()
const tonePickMock = fn()
export const TwoInstancesAreAddressableByDistinctNames: Story = {
  render: () => (
    <View className="w-[640px] flex-row gap-6 rounded-md bg-bg-base p-6">
      <Demo presets={GENRE_PRESETS} ariaLabel="Browse genre presets" onPick={genrePickMock} />
      <Demo presets={TONE_PRESETS} ariaLabel="Browse tone presets" onPick={tonePickMock} />
    </View>
  ),
  play: async () => {
    // Two triggers side by side (Step 3 renders one per field): a
    // screen-reader user must be able to tell which field a pick will
    // overwrite, so each needs a distinct accessible name. getByRole throws
    // on an ambiguous match, so a shared name fails right here.
    const genreTrigger = screen.getByRole('button', { name: 'Browse genre presets' })
    const toneTrigger = screen.getByRole('button', { name: 'Browse tone presets' })

    await userEvent.click(genreTrigger)
    expect(await screen.findByText(GENRE_PRESETS[0].displayName)).toBeInTheDocument()
    // Only the genre catalog opened — the tone trigger's own list stayed shut.
    expect(screen.queryByText(TONE_PRESETS[0].displayName)).not.toBeInTheDocument()

    await userEvent.click(await screen.findByText(GENRE_PRESETS[0].displayName))
    await waitFor(() => expect(genrePickMock).toHaveBeenCalledWith(GENRE_PRESETS[0]))

    await userEvent.click(toneTrigger)
    await userEvent.click(await screen.findByText(TONE_PRESETS[0].displayName))
    await waitFor(() => expect(tonePickMock).toHaveBeenCalledWith(TONE_PRESETS[0]))
  },
}

const searchPickMock = fn()
export const SearchFiltersToMatchesOnNameAndTagline: Story = {
  render: () => (
    <Demo presets={GENRE_PRESETS} ariaLabel="Browse genre presets" onPick={searchPickMock} />
  ),
  play: async () => {
    const noir = GENRE_PRESETS.find((preset) => preset.id === 'noir')
    const spaceOpera = GENRE_PRESETS.find((preset) => preset.id === 'space-opera')
    if (noir == null || spaceOpera == null) {
      throw new Error('expected "noir" and "space-opera" fixtures in GENRE_PRESETS')
    }

    await userEvent.click(screen.getByRole('button', { name: 'Browse genre presets' }))
    const search = await screen.findByPlaceholderText('Search presets')

    await userEvent.type(search, 'noir')
    await waitFor(() => expect(screen.queryByText(spaceOpera.displayName)).not.toBeInTheDocument())
    expect(screen.getByText(noir.displayName)).toBeInTheDocument()

    // Case-insensitive, and the tagline is searched too — not just displayName.
    await userEvent.clear(search)
    await userEvent.type(search, noir.tagline.slice(0, 8).toUpperCase())
    await waitFor(() => expect(screen.getByText(noir.displayName)).toBeInTheDocument())

    // A filtered row still commits the preset it names.
    await userEvent.click(screen.getByText(noir.displayName))
    await waitFor(() => expect(searchPickMock).toHaveBeenCalledWith(noir))
  },
}

export const SearchWithNoMatchesShowsEmptyState: Story = {
  render: () => <Demo presets={GENRE_PRESETS} ariaLabel="Browse genre presets" onPick={fn()} />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Browse genre presets' }))
    const search = await screen.findByPlaceholderText('Search presets')
    await userEvent.type(search, 'zzzznotapreset')

    await waitFor(() =>
      expect(screen.queryByText(GENRE_PRESETS[0].displayName)).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/No matches/)).toBeInTheDocument()
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
