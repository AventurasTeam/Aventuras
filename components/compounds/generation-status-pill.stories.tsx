import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

import { GenerationStatusPill, type ErrorState } from './generation-status-pill'

const onCancel = () => {
  console.log('[story] cancel')
}
const onErrorTap = (code: ErrorState['code']) => {
  console.log('[story] error tap:', code)
}

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

export const ActiveClosingChapter: Story = {
  render: () => (
    <GenerationStatusPill
      activePhase="closing-chapter"
      onCancel={onCancel}
      onErrorTap={onErrorTap}
    />
  ),
}

export const ErrorEmbedder: Story = {
  render: () => (
    <GenerationStatusPill
      error={{ code: 'embedder-offline', pendingRows: 142 }}
      onCancel={onCancel}
      onErrorTap={onErrorTap}
    />
  ),
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
        Both inputs set — activePhase wins per principles.md → Affordance loci (active &gt; error
        &gt; hidden).
      </Text>
      <GenerationStatusPill
        activePhase="generating-narrative"
        error={{ code: 'embedder-offline', pendingRows: 3 }}
        onCancel={onCancel}
        onErrorTap={onErrorTap}
      />
    </View>
  ),
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
