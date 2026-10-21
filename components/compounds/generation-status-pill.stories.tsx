import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

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
  play: async () => {
    const phase = t('chrome.generationStatusPill.phase.reasoning')
    await userEvent.click(screen.getByRole('button', { name: phase }))
    expect(await screen.findByRole('dialog', { name: phase })).toBeInTheDocument()
  },
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

// The pass holds the gate, so it owns a Cancel like any blocking phase.
export const ActiveUpdatingMemory: Story = {
  args: { activePhase: 'updating-memory', onCancel: fn(), onErrorTap: fn() },
  play: async ({ args }) => {
    await userEvent.click(
      screen.getByRole('button', { name: t('chrome.generationStatusPill.phase.updatingMemory') }),
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: t('chrome.generationStatusPill.cancelMemoryUpdate'),
      }),
    )
    await waitFor(() => expect(args.onCancel).toHaveBeenCalledTimes(1))
  },
}

// Send's deferred work: the pass runs first and the turn waits behind it.
export const ActiveUpdatingMemoryBeforeTurn: Story = {
  args: { activePhase: 'updating-memory', beforeTurn: true, onCancel: fn(), onErrorTap: fn() },
  play: async () => {
    const label = t('chrome.generationStatusPill.phase.updatingMemoryBeforeTurn')
    expect(await screen.findByRole('button', { name: label })).toBeInTheDocument()
    expect(screen.getByText(label)).toBeInTheDocument()
  },
}

export const BeforeTurnIgnoredOutsideMemory: Story = {
  args: { activePhase: 'generating-narrative', beforeTurn: true, onCancel: fn(), onErrorTap: fn() },
  play: async () => {
    expect(
      await screen.findByRole('button', {
        name: t('chrome.generationStatusPill.phase.generatingNarrative'),
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(t('chrome.generationStatusPill.phase.updatingMemoryBeforeTurn')),
    ).toBeNull()
  },
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

export const MemoryPhasePlusError: Story = {
  render: () => (
    <View className="gap-2">
      <Text variant="muted" size="sm">
        Both inputs set and the phase is the memory pass — it holds the gate and owns the Cancel, so
        it keeps the slot; `swap-paused` shows again when the pass ends.
      </Text>
      <GenerationStatusPill
        activePhase="updating-memory"
        error={{ code: 'swap-paused' }}
        onCancel={onCancel}
        onErrorTap={onErrorTap}
      />
    </View>
  ),
  play: async () => {
    expect(
      await screen.findByRole('button', {
        name: t('chrome.generationStatusPill.phase.updatingMemory'),
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(t('chrome.generationStatusPill.error.swapPaused'))).toBeNull()
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

// No onCancel, so the pill renders bare — no trigger to carry the name.
export const PhoneBareNamedByPhase: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: () => <GenerationStatusPill activePhase="updating-memory" onErrorTap={onErrorTap} />,
  play: async () => {
    const phase = t('chrome.generationStatusPill.phase.updatingMemory')
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: phase })).toBeInTheDocument(),
    )
  },
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
