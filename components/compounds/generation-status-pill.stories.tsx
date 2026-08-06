import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { themes } from '@/lib/themes'

import { GenerationStatusPill, type ErrorState } from './generation-status-pill'

const onCancel = () => {
  console.log('[story] cancel')
}
const onErrorTap = (code: ErrorState['code']) => {
  console.log('[story] error tap:', code)
}

// Assigned by the stories that assert routing, so their play can reach the spy
// the render created.
let tapSpy: ReturnType<typeof fn>

const meta: Meta<typeof GenerationStatusPill> = {
  title: 'Compounds/GenerationStatusPill',
  component: GenerationStatusPill,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof GenerationStatusPill>

export const Hidden: Story = {
  render: () => (
    <View className="gap-2">
      <Text variant="muted" size="sm">
        Both activePhase and error are undefined — the pill returns null and renders nothing.
      </Text>
      <View className="rounded-md border border-border bg-bg-sunken px-3 py-2">
        <GenerationStatusPill onCancel={onCancel} onErrorTap={onErrorTap} />
      </View>
    </View>
  ),
}

export const ActiveReasoning: Story = {
  render: () => (
    <GenerationStatusPill activePhase="reasoning" onCancel={onCancel} onErrorTap={onErrorTap} />
  ),
}

export const ActiveRecallingMemory: Story = {
  render: () => (
    <GenerationStatusPill
      activePhase="recalling-memory"
      onCancel={onCancel}
      onErrorTap={onErrorTap}
    />
  ),
}

export const ActiveGeneratingNarrative: Story = {
  render: () => (
    <GenerationStatusPill
      activePhase="generating-narrative"
      onCancel={onCancel}
      onErrorTap={onErrorTap}
    />
  ),
}

export const ActiveClassifying: Story = {
  render: () => (
    <GenerationStatusPill activePhase="classifying" onCancel={onCancel} onErrorTap={onErrorTap} />
  ),
}

// `onCancel` is passed and deliberately has no effect: the background pass is
// cancel-less, so the tag carries no popover trigger.
export const ActiveUpdatingMemory: Story = {
  render: () => (
    <GenerationStatusPill
      activePhase="updating-memory"
      onCancel={onCancel}
      onErrorTap={onErrorTap}
    />
  ),
}

export const ActiveClosingChapter: Story = {
  render: () => (
    <GenerationStatusPill
      activePhase="closing-chapter"
      onCancel={onCancel}
      onErrorTap={onErrorTap}
    />
  ),
}

export const ActiveRefreshingSuggestions: Story = {
  render: () => (
    <GenerationStatusPill
      activePhase="refreshing-suggestions"
      onCancel={onCancel}
      onErrorTap={onErrorTap}
    />
  ),
}

export const ErrorEmbedder: Story = {
  render: () => {
    const tap = fn()
    tapSpy = tap
    return (
      <GenerationStatusPill
        error={{ code: 'memory-incomplete', pendingRows: 142 }}
        onCancel={onCancel}
        onErrorTap={tap}
      />
    )
  },
  play: async () => {
    const pill = await screen.findByText(
      t('chrome.generationStatusPill.error.memoryIncomplete', { count: 142 }),
    )
    await userEvent.click(pill)
    // The pill's whole job past display is routing to the resolution panel.
    expect(tapSpy).toHaveBeenCalledWith('memory-incomplete')
  },
}

// Staging CLEARS embedding_stale row by row, so a half-finished swap drives the
// stale count toward zero — this code exists because the story most in need of a
// signal is the one least able to raise the count-driven one.
export const ErrorSwapPaused: Story = {
  render: () => {
    const tap = fn()
    tapSpy = tap
    return (
      <GenerationStatusPill error={{ code: 'swap-paused' }} onCancel={onCancel} onErrorTap={tap} />
    )
  },
  play: async () => {
    const pill = await screen.findByText(t('chrome.generationStatusPill.error.swapPaused'))
    await userEvent.click(pill)
    expect(tapSpy).toHaveBeenCalledWith('swap-paused')
  },
}

export const ErrorClassifier: Story = {
  render: () => (
    <GenerationStatusPill
      error={{ code: 'classifier-offline' }}
      onCancel={onCancel}
      onErrorTap={onErrorTap}
    />
  ),
}

export const ActivePlusError: Story = {
  render: () => (
    <View className="gap-2">
      <Text variant="muted" size="sm">
        Both inputs set and the phase is blocking — activePhase wins, since it also carries the only
        way to cancel the run.
      </Text>
      <GenerationStatusPill
        activePhase="generating-narrative"
        error={{ code: 'memory-incomplete', pendingRows: 3 }}
        onCancel={onCancel}
        onErrorTap={onErrorTap}
      />
    </View>
  ),
}

export const BackgroundPhasePlusError: Story = {
  render: () => {
    const tap = fn()
    tapSpy = tap
    return (
      <View className="gap-2">
        <Text variant="muted" size="sm">
          Both inputs set and the phase is non-blocking — the error wins. `swap-paused` needs a
          decision, so a cadence-driven pass must not blank it.
        </Text>
        <GenerationStatusPill
          activePhase="updating-memory"
          error={{ code: 'swap-paused' }}
          onCancel={onCancel}
          onErrorTap={tap}
        />
      </View>
    )
  },
  play: async () => {
    const pill = await screen.findByText(t('chrome.generationStatusPill.error.swapPaused'))
    await userEvent.click(pill)
    // Still routes: yielding the slot has to yield the affordance with it.
    expect(tapSpy).toHaveBeenCalledWith('swap-paused')
  },
}

export const PhonePopover: Story = {
  render: () => (
    <View style={{ width: 360 }} className="gap-2 rounded-md bg-bg-base p-4">
      <Text variant="muted" size="sm">
        360 px wrapper is a layout context only — `useTier()` reads window dimensions, so the pill
        renders icon-only when the Storybook window itself is &lt; 640 px wide. Resize the browser
        to verify the phone collapse.
      </Text>
      <GenerationStatusPill activePhase="reasoning" onCancel={onCancel} onErrorTap={onErrorTap} />
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="flex-row items-center gap-3 rounded-md bg-bg-base p-4"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" style={{ width: 80 }}>
            {t.name}
          </Text>
          <GenerationStatusPill
            activePhase="generating-narrative"
            onCancel={onCancel}
            onErrorTap={onErrorTap}
          />
        </View>
      ))}
    </View>
  ),
}
