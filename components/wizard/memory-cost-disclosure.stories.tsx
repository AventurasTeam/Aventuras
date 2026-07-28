import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, userEvent } from 'storybook/test'

import { wizardStore } from '@/lib/stores'

import { MemoryCostDisclosure } from './memory-cost-disclosure'

const MATRYOSHKA_CAPS = { matryoshkaSupported: true, matryoshkaDims: [512, 1024, 2048] }

const meta: Meta<typeof MemoryCostDisclosure> = {
  title: 'Compounds/Wizard/MemoryCostDisclosure',
  component: MemoryCostDisclosure,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View className="w-[560px] rounded-md bg-bg-base p-6">
        <Story />
      </View>
    ),
  ],
  beforeEach: () => {
    wizardStore.reset()
  },
}

export default meta
type Story = StoryObj<typeof MemoryCostDisclosure>

// Local backend hides the lever entirely (bundled small model isn't worth
// truncating), so nothing renders.
export const HiddenForLocalBackend: Story = {
  render: () => <MemoryCostDisclosure embeddingBackend="local" capabilities={MATRYOSHKA_CAPS} />,
  play: async () => {
    expect(screen.queryByTestId('memory-cost-disclosure')).not.toBeInTheDocument()
  },
}

// A non-Matryoshka provider model also hides it.
export const HiddenWithoutMatryoshka: Story = {
  render: () => <MemoryCostDisclosure embeddingBackend="provider" capabilities={undefined} />,
  play: async () => {
    expect(screen.queryByTestId('memory-cost-disclosure')).not.toBeInTheDocument()
  },
}

export const CollapsedByDefault: Story = {
  render: () => <MemoryCostDisclosure embeddingBackend="provider" capabilities={MATRYOSHKA_CAPS} />,
  play: async () => {
    expect(await screen.findByTestId('memory-cost-disclosure')).toBeInTheDocument()
    expect(screen.getByText(/Memory cost \(advanced\)/)).toBeInTheDocument()
    // Body copy stays hidden until the header is toggled open.
    expect(screen.queryByText(/Provider model supports Matryoshka/)).not.toBeInTheDocument()
  },
}

export const ExpandedWithLadder: Story = {
  render: () => <MemoryCostDisclosure embeddingBackend="provider" capabilities={MATRYOSHKA_CAPS} />,
  play: async () => {
    await userEvent.click(screen.getByRole('button'))
    expect(await screen.findByText(/Provider model supports Matryoshka/)).toBeInTheDocument()
    expect(screen.getByText('512 dim')).toBeInTheDocument()
    expect(screen.getByText('1024 dim')).toBeInTheDocument()
    expect(screen.getByText('2048 dim')).toBeInTheDocument()
    expect(screen.getByText('Native dim')).toBeInTheDocument()
    // The platform suggestion annotates exactly one row (native on desktop,
    // a curated dim on mobile) — either way the tag renders once.
    expect(screen.getByText('← suggested')).toBeInTheDocument()
    // Per-row storage preview uses the canon "~{size} / 30 ch" format
    // (512 dim × 4 bytes × 2250 rows ≈ 5 MB).
    expect(screen.getByText('~5 MB / 30 ch')).toBeInTheDocument()
  },
}

// Regression: a dim already chosen this session (touched) must not be stomped
// by the platform pre-selection when the disclosure (re)mounts on step nav.
export const RespectsTouchedSelection: Story = {
  beforeEach: () => {
    wizardStore.reset()
    // Simulate an explicit earlier pick that differs from the platform
    // suggestion the effect would otherwise apply.
    wizardStore.setEffectiveDim(512)
  },
  render: () => <MemoryCostDisclosure embeddingBackend="provider" capabilities={MATRYOSHKA_CAPS} />,
  play: async () => {
    await screen.findByTestId('memory-cost-disclosure')
    // Mount ran the pre-selection effect; the touched gate kept the pick intact.
    expect(wizardStore.getWizard().state.effectiveDim).toBe(512)
    expect(await screen.findByText(/512 dim/)).toBeInTheDocument()
  },
}

// Emptying the custom field leaves an unparseable draft while the store keeps the
// last valid dim. If that dim is on the ladder, a step-nav remount renders the
// ladder pick and no custom input — so the flag must not survive to block Finish
// over an error message that is nowhere on screen.
export const InvalidDraftClearedOnRemount: Story = {
  beforeEach: () => {
    wizardStore.reset()
    wizardStore.setEffectiveDim(512)
    wizardStore.setCustomDimInvalid(true)
  },
  render: () => <MemoryCostDisclosure embeddingBackend="provider" capabilities={MATRYOSHKA_CAPS} />,
  play: async () => {
    await screen.findByTestId('memory-cost-disclosure')
    expect(wizardStore.getWizard().state.effectiveDim).toBe(512)
    expect(screen.queryByTestId('memory-cost-custom')).not.toBeInTheDocument()
    expect(wizardStore.getWizard().customDimInvalid).toBe(false)
  },
}

export const CustomInputError: Story = {
  render: () => <MemoryCostDisclosure embeddingBackend="provider" capabilities={MATRYOSHKA_CAPS} />,
  play: async () => {
    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(await screen.findByText('Custom…'))
    // Canon quality-cliff caveat rides alongside the custom input.
    expect(
      await screen.findByText(/Custom dims not on the model's curated ladder/),
    ).toBeInTheDocument()
    const input = await screen.findByTestId('memory-cost-custom')
    await userEvent.type(input, '12.5')
    expect(await screen.findByText('Enter a positive whole number.')).toBeInTheDocument()
    // The store keeps the last valid dim (never a fractional one).
    expect(wizardStore.getWizard().state.effectiveDim).not.toBe(12.5)
  },
}
